const mongoose = require('mongoose');
const Order = require('../model/order');
const Restaurant = require('../model/restaurant');
const { ORDER_ERROR_CODES, SYSTEM_STATES } = require('../constants/orders');
const { serializeOrderForEmployee } = require('../serializers/orderSerializer');

/**
 * Retrieves order history for a restaurant.
 * 
 * Supports:
 * - Owners of the restaurant
 * - Employees assigned to the restaurant
 * - Platform admins
 * 
 * Supported Query Parameters:
 * - status: 'history' (default: COMPLETED, CANCELLED), 'completed', 'cancelled', 'active', 'all', or specific state
 * - startDate: ISO date string for range filtering ($gte)
 * - endDate: ISO date string for range filtering ($lte)
 * - search: string to search in orderNumber or customerNotes
 * - tableId: filter by specific restaurant table ObjectId
 * - waiterId: filter by specific assigned waiter ObjectId
 * - page: integer (default 1)
 * - limit: integer (default 10, max 100)
 * - sort: 'desc' (default, newest-first) or 'asc' (oldest-first)
 */
exports.getRestaurantOrderHistory = async (req, res) => {
  try {
    const restaurantId = req.params.id || req.params.restaurantId || req.query.restaurantId || req.employee?.restaurantId;

    if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_RESTAURANT_ID',
        message: 'Invalid or missing restaurantId format.'
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Authorization checks
    if (userRole === 'owner') {
      const ownedRestaurant = await Restaurant.findOne({ _id: restaurantId, owner: userId });
      if (!ownedRestaurant) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
          message: 'Not authorized. You do not own this restaurant.'
        });
      }
    } else if (userRole === 'employee') {
      if (!req.employee || req.employee.restaurantId !== restaurantId.toString()) {
        return res.status(403).json({
          success: false,
          error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
          message: 'Not authorized. You are not assigned to this restaurant.'
        });
      }
    } else if (userRole === 'admin') {
      // Platform admin has universal access
    } else {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    const query = { restaurant: restaurantId };
    const { status, startDate, endDate, search, tableId, waiterId, sort } = req.query;

    // Status filter
    if (!status || status === 'history') {
      query.systemState = { $in: [SYSTEM_STATES.COMPLETED, SYSTEM_STATES.CANCELLED] };
    } else if (status === 'completed') {
      query.systemState = SYSTEM_STATES.COMPLETED;
    } else if (status === 'cancelled') {
      query.systemState = SYSTEM_STATES.CANCELLED;
    } else if (status === 'active') {
      query.systemState = { $in: [SYSTEM_STATES.OPEN, SYSTEM_STATES.IN_PROGRESS] };
    } else if (status !== 'all') {
      const upperStatus = status.toUpperCase();
      if (Object.values(SYSTEM_STATES).includes(upperStatus)) {
        query.systemState = upperStatus;
      }
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_FORMAT',
            message: 'Invalid startDate format.'
          });
        }
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_FORMAT',
            message: 'Invalid endDate format.'
          });
        }
        query.createdAt.$lte = end;
      }
    }

    // Search filter
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { orderNumber: regex },
        { customerNotes: regex }
      ];
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

    // Waiter filter
    if (waiterId) {
      if (!mongoose.isValidObjectId(waiterId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_WAITER_ID',
          message: 'Invalid waiterId format.'
        });
      }
      query['service.waiter'] = waiterId;
    }

    // Pagination & sorting
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const sortOrder = sort === 'asc' ? 1 : -1;

    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('table', 'name code')
        .populate('customer', 'name phone')
        .populate('service.waiter', 'name role')
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      success: true,
      data: {
        orders: orders.map((o) => serializeOrderForEmployee(o, req.employee || null)),
        pagination: {
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('🔥 Error in getRestaurantOrderHistory:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching restaurant order history.'
    });
  }
};
