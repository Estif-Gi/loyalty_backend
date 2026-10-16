const mongoose = require('mongoose');
const DiningCheck = require('../model/diningCheck');
const Order = require('../model/order');
const Restaurant = require('../model/restaurant');
const { ORDER_ERROR_CODES } = require('../constants/orders');
const { serializeDiningCheckForOwner } = require('../serializers/diningCheckSerializer');

/**
 * Returns paginated dining check history for restaurant owners.
 * Grouping unit is DiningCheck (ONE record per customer dining session bill).
 * 
 * Supports:
 * - Restaurant owners (must own the restaurant)
 * - Platform admins
 * 
 * Query parameters:
 * - restaurantId: ObjectId (required for owner unless resolved from owned list)
 * - page: number (default 1)
 * - limit: number (default 20, max 100)
 * - payment: 'paid' | 'unpaid'
 * - method: string (e.g. 'cash', 'telebirr')
 * - tableId: ObjectId
 * - customerId: ObjectId
 * - from: ISO date string
 * - to: ISO date string
 */
exports.getOwnerDiningChecksHistory = async (req, res) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
        message: 'Only restaurant owners or administrators can access financial history.'
      });
    }

    const restaurantId = req.query.restaurantId;

    if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_RESTAURANT_ID',
        message: 'Valid restaurantId query parameter is required.'
      });
    }

    // Strict ownership verification (Section 31)
    if (userRole === 'owner') {
      const ownedRestaurant = await Restaurant.findOne({
        _id: restaurantId,
        owner: userId
      }).select('_id');

      if (!ownedRestaurant) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. You do not own this restaurant.'
        });
      }
    }

    const query = { restaurant: restaurantId };
    const { payment, method, tableId, customerId, from, to } = req.query;

    // Payment boolean filter
    if (payment === 'paid') {
      query['payment.isPaid'] = true;
    } else if (payment === 'unpaid') {
      query['payment.isPaid'] = false;
    }

    // Payment method filter
    if (method) {
      query['payment.method'] = method.toLowerCase();
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

    // Customer filter
    if (customerId) {
      if (!mongoose.isValidObjectId(customerId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_CUSTOMER_ID',
          message: 'Invalid customerId format.'
        });
      }
      query.customer = customerId;
    }

    // Date range filter
    if (from || to) {
      query.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_FORMAT',
            message: 'Invalid "from" date format.'
          });
        }
        query.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_FORMAT',
            message: 'Invalid "to" date format.'
          });
        }
        query.createdAt.$lte = toDate;
      }
    }

    // Server-side pagination (Section 34)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, checks] = await Promise.all([
      DiningCheck.countDocuments(query),
      DiningCheck.find(query)
        .populate('table', 'name code')
        .populate('customer', 'name phone')
        .populate('payment.recordedBy', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    const checkIds = checks.map((c) => c._id);
    const orders = await Order.find({ diningCheck: { $in: checkIds } }).sort({ createdAt: 1 });

    const ordersByCheck = {};
    for (const ord of orders) {
      const cId = ord.diningCheck.toString();
      if (!ordersByCheck[cId]) {
        ordersByCheck[cId] = [];
      }
      ordersByCheck[cId].push(ord);
    }

    const serializedChecks = checks.map((c) =>
      serializeDiningCheckForOwner(c, ordersByCheck[c._id.toString()] || [])
    );

    const pages = Math.ceil(total / limit) || 1;

    res.json({
      success: true,
      data: {
        checks: serializedChecks,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      }
    });
  } catch (error) {
    console.error('🔥 Error in getOwnerDiningChecksHistory:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching dining checks history.'
    });
  }
};

/**
 * Returns full details of a single DiningCheck including full line items for each order.
 */
exports.getOwnerDiningCheckDetails = async (req, res) => {
  try {
    const { checkId } = req.params;
    const userRole = req.user?.role;
    const userId = req.user?.id;

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

    // Verify ownership
    if (userRole === 'owner') {
      const ownedRestaurant = await Restaurant.findOne({
        _id: check.restaurant,
        owner: userId
      }).select('_id');

      if (!ownedRestaurant) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.DINING_CHECK_ACCESS_DENIED,
          message: 'Not authorized. You do not own this restaurant.'
        });
      }
    } else if (userRole !== 'admin') {
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
        check: serializeDiningCheckForOwner(check, orders, { includeItems: true })
      }
    });
  } catch (error) {
    console.error('🔥 Error in getOwnerDiningCheckDetails:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error retrieving dining check details.'
    });
  }
};
