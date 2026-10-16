const mongoose = require('mongoose');
const DiningCheck = require('../model/diningCheck');
const Order = require('../model/order');
const Restaurant = require('../model/restaurant');
const RestaurantTable = require('../model/restaurantTable');
const { ORDER_ERROR_CODES, SYSTEM_STATES, PAYMENT_METHODS } = require('../constants/orders');
const { serializeDiningCheckForEmployee } = require('../serializers/diningCheckSerializer');
const { recalculateDiningCheckTotals } = require('../services/diningCheckService');
const {
  emitDiningCheckPaymentUpdated,
  emitDiningChecksInvalidated
} = require('../services/orderRealtimeService');

/**
 * Lists DiningChecks for employees/owners.
 * 
 * Supports:
 * - Restaurant owners
 * - Employees assigned to the restaurant (cashiers, waiters)
 * - Platform admins
 * 
 * Query filters:
 * - payment: 'unpaid' | 'paid'
 * - tableId: ObjectId
 */
exports.getEmployeeDiningChecks = async (req, res) => {
  try {
    const query = {};
    const { payment, tableId } = req.query;

    if (req.user.role === 'owner') {
      const filterId = req.query.restaurantId;
      if (filterId) {
        if (!mongoose.isValidObjectId(filterId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid restaurant ID format.'
          });
        }
        const ownedRestaurant = await Restaurant.findOne({ _id: filterId, owner: req.user.id });
        if (!ownedRestaurant) {
          return res.status(403).json({
            success: false,
            error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
            message: 'Not authorized. You do not own this restaurant.'
          });
        }
        query.restaurant = filterId;
      } else {
        const ownedRestaurants = await Restaurant.find({ owner: req.user.id });
        if (!ownedRestaurants || ownedRestaurants.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'No restaurants found for this owner.'
          });
        }
        query.restaurant = { $in: ownedRestaurants.map((r) => r._id) };
      }
    } else if (req.user.role === 'employee' && req.employee) {
      query.restaurant = req.employee.restaurantId;

      // If waiter, restrict to checks on tables assigned to this waiter
      if (req.employee.role === 'waiter') {
        const assignedTables = await RestaurantTable.find({
          restaurant: req.employee.restaurantId,
          assignedWaiter: req.employee.id
        }).select('_id');
        const assignedTableIds = assignedTables.map((t) => t._id);
        query.table = { $in: assignedTableIds };
      }
    } else if (req.user.role === 'admin') {
      if (req.query.restaurantId) {
        query.restaurant = req.query.restaurantId;
      }
    } else {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    // Payment status filter
    if (payment === 'unpaid') {
      query['payment.isPaid'] = false;
    } else if (payment === 'paid') {
      query['payment.isPaid'] = true;
    }

    // Table filter
    if (tableId) {
      if (!mongoose.isValidObjectId(tableId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TABLE_ID',
          message: 'Invalid tableId format.'
        });
      }
      query.table = tableId;
    }

    const checks = await DiningCheck.find(query)
      .populate('table', 'name code')
      .populate('customer', 'name phone')
      .populate('payment.recordedBy', 'name role')
      .sort({ createdAt: -1 });

    const checkIds = checks.map((c) => c._id);
    const orders = await Order.find({ diningCheck: { $in: checkIds } }).sort({ createdAt: 1 });

    // Group orders by diningCheck ID
    const ordersByCheck = {};
    for (const ord of orders) {
      const cId = ord.diningCheck.toString();
      if (!ordersByCheck[cId]) {
        ordersByCheck[cId] = [];
      }
      ordersByCheck[cId].push(ord);
    }

    const serializedChecks = checks.map((c) =>
      serializeDiningCheckForEmployee(c, ordersByCheck[c._id.toString()] || [])
    );

    res.json({
      success: true,
      data: {
        checks: serializedChecks
      }
    });
  } catch (error) {
    console.error('🔥 Error in getEmployeeDiningChecks:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching dining checks.'
    });
  }
};

/**
 * Fetches a single DiningCheck by ID with all its orders.
 */
exports.getEmployeeDiningCheckById = async (req, res) => {
  try {
    const { checkId } = req.params;

    if (!checkId || !mongoose.isValidObjectId(checkId)) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_NOT_FOUND,
        message: 'Invalid dining check ID format.'
      });
    }

    const check = await DiningCheck.findById(checkId)
      .populate('table', 'name code')
      .populate('customer', 'name phone')
      .populate('payment.recordedBy', 'name role');

    if (!check) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_NOT_FOUND,
        message: 'Dining check not found.'
      });
    }

    // Authorization verification
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (userRole === 'admin') {
      // Platform admin has universal access
    } else if (userRole === 'owner') {
      const ownedRestaurant = await Restaurant.findOne({ _id: check.restaurant, owner: userId }).select('_id');
      if (!ownedRestaurant) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. You do not own this restaurant.'
        });
      }
    } else if (userRole === 'employee') {
      if (!req.employee || req.employee.restaurantId !== check.restaurant.toString()) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. This check belongs to another restaurant.'
        });
      }

      if (req.employee.role === 'waiter') {
        const tableDoc = await RestaurantTable.findById(check.table);
        if (tableDoc && tableDoc.assignedWaiter && tableDoc.assignedWaiter.toString() !== req.employee.id) {
          return res.status(403).json({
            success: false,
            error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
            message: 'This check is assigned to another waiter.'
          });
        }
      }
    } else {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    const orders = await Order.find({ diningCheck: check._id }).sort({ createdAt: 1 });

    res.json({
      success: true,
      data: {
        check: serializeDiningCheckForEmployee(check, orders)
      }
    });
  } catch (error) {
    console.error('🔥 Error in getEmployeeDiningCheckById:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error retrieving dining check.'
    });
  }
};

/**
 * Marks a DiningCheck as paid.
 * 
 * Validates:
 * 1. Authenticated Employee or Owner
 * 2. Restaurant isolation
 * 3. orders:payment permission
 * 4. Recalculates totals from Orders
 * 5. Requires at least one non-cancelled Order
 * 6. Validates payment method
 * 7. Rejects already paid checks with 409
 * 8. Records payment proof if supplied
 * 9. Sets isPaid=true, server paidAt, recordedBy
 * 10. Emits realtime Socket.IO events
 */
exports.updateDiningCheckPayment = async (req, res) => {
  try {
    const { checkId } = req.params;
    const { method = PAYMENT_METHODS.CASH } = req.body || {};

    if (!checkId || !mongoose.isValidObjectId(checkId)) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_NOT_FOUND,
        message: 'Invalid dining check ID format.'
      });
    }

    const check = await DiningCheck.findById(checkId);
    if (!check) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_NOT_FOUND,
        message: 'Dining check not found.'
      });
    }

    const userRole = req.user?.role;
    const userId = req.user?.id;

    // Authorization verification
    if (userRole === 'admin') {
      // Platform admin has universal access
    } else if (userRole === 'owner') {
      const ownedRestaurant = await Restaurant.findOne({ _id: check.restaurant, owner: userId }).select('_id');
      if (!ownedRestaurant) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. You do not own this restaurant.'
        });
      }
    } else if (userRole === 'employee') {
      if (!req.employee || req.employee.restaurantId !== check.restaurant.toString()) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. This check belongs to another restaurant.'
        });
      }

      if (!req.employee.permissions || !req.employee.permissions.includes('orders:payment')) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.ORDER_PAYMENT_PERMISSION_DENIED,
          message: 'Your role does not have permission to process payments.'
        });
      }

      if (req.employee.role === 'waiter') {
        const tableDoc = await RestaurantTable.findById(check.table);
        if (tableDoc && tableDoc.assignedWaiter && tableDoc.assignedWaiter.toString() !== req.employee.id) {
          return res.status(403).json({
            success: false,
            error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
            message: 'This check is assigned to another waiter.'
          });
        }
      }
    } else {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    // Idempotency check: Already paid (Section 14 & 23)
    if (check.payment && check.payment.isPaid) {
      const orders = await Order.find({ diningCheck: check._id }).sort({ createdAt: 1 });
      return res.status(409).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_ALREADY_PAID,
        message: 'This dining check has already been paid.',
        data: {
          check: serializeDiningCheckForEmployee(check, orders)
        }
      });
    }

    // Authoritative server-side recalculation of totals from non-cancelled orders (Section 16 & 17)
    const updatedCheck = await recalculateDiningCheckTotals(check._id);

    const activeOrders = await Order.find({
      diningCheck: check._id,
      systemState: { $ne: SYSTEM_STATES.CANCELLED }
    });

    if (!activeOrders || activeOrders.length === 0) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_EMPTY,
        message: 'Cannot process payment for a dining check with no active orders.'
      });
    }

    // Validate payment method
    const validMethods = Object.values(PAYMENT_METHODS);
    const normalizedMethod = typeof method === 'string' ? method.toLowerCase() : '';
    if (!validMethods.includes(normalizedMethod)) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.INVALID_PAYMENT_METHOD,
        message: `Invalid payment method '${method}'. Allowed methods: ${validMethods.join(', ')}.`
      });
    }

    // Payment proof resolution
    const uploadedProofUrl = req.file?.path || req.file?.secure_url;
    const bodyProofUrl = req.body?.proofUrl || req.body?.proof || req.body?.receiptUrl;
    const proofUrl = uploadedProofUrl || bodyProofUrl || null;
    const proofPublicId = req.file?.filename || req.file?.public_id || null;

    const recordedBy = req.employee ? req.employee.id : userId;

    // Apply payment update
    updatedCheck.payment = {
      isPaid: true,
      method: normalizedMethod,
      proofUrl,
      proofPublicId,
      recordedBy,
      paidAt: new Date()
    };

    await updatedCheck.save();

    await updatedCheck.populate('table', 'name code');
    await updatedCheck.populate('customer', 'name phone');
    await updatedCheck.populate('payment.recordedBy', 'name role');

    // Emit realtime events (Section 39 & 40)
    emitDiningCheckPaymentUpdated(updatedCheck);
    emitDiningChecksInvalidated(updatedCheck.restaurant);

    const allOrders = await Order.find({ diningCheck: check._id }).sort({ createdAt: 1 });

    res.json({
      success: true,
      message: 'Payment recorded successfully.',
      data: {
        check: serializeDiningCheckForEmployee(updatedCheck, allOrders)
      }
    });
  } catch (error) {
    console.error('🔥 Error in updateDiningCheckPayment:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error processing dining check payment.'
    });
  }
};
