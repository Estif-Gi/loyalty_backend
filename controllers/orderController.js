const mongoose = require('mongoose');
const Order = require('../model/order');
const { createOrder } = require('../services/orderService');
const { ORDER_ERROR_CODES, SYSTEM_STATES } = require('../constants/orders');
const { serializeOrderForCustomer } = require('../serializers/orderSerializer');
const { emitOrderCreated } = require('../services/orderRealtimeService');

exports.placeOrder = async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Only customer accounts can place orders.'
      });
    }

    const customerId = req.user.id;
    const idempotencyKey = req.headers['idempotency-key'];
    const { orderSessionId, location, items, customerNotes } = req.body;

    const { order, created } = await createOrder({
      customerId,
      orderSessionId,
      location,
      items,
      customerNotes,
      idempotencyKey
    });

    if (created) {
      const populatedOrder = await Order.findById(order._id)
        .populate('table', 'name code')
        .populate('service.waiter', 'name role');
      emitOrderCreated(populatedOrder || order);
    }

    res.status(201).json({
      success: true,
      data: {
        order: serializeOrderForCustomer(order)
      }
    });
  } catch (error) {
    if (error.error && error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.error,
        message: error.message,
        details: error.details
      });
    }
    console.error('🔥 Error in placeOrder:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error placing order.'
    });
  }
};

exports.getOrderHistory = async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    const customerId = req.user.id;
    const {
      status,
      restaurantId,
      startDate,
      endDate,
      sort = 'desc'
    } = req.query;

    const query = { customer: customerId };

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
    // If status === 'all', no systemState filter is applied

    // Restaurant filter
    if (restaurantId) {
      if (!mongoose.isValidObjectId(restaurantId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_RESTAURANT_ID',
          message: 'Invalid restaurantId format.'
        });
      }
      query.restaurant = restaurantId;
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

    // Pagination
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
        .populate('restaurant', 'name location logoURL phone')
        .populate('table', 'name code')
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      success: true,
      data: {
        orders: orders.map((o) => serializeOrderForCustomer(o, { includeTimeline: false })),
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
    console.error('🔥 Error in getOrderHistory:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching order history.'
    });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    const customerId = req.user.id;
    const { status } = req.query; // 'active' or 'history'

    const query = { customer: customerId };

    if (status === 'active') {
      query.systemState = { $in: [SYSTEM_STATES.OPEN, SYSTEM_STATES.IN_PROGRESS] };
    } else if (status === 'history') {
      query.systemState = { $in: [SYSTEM_STATES.COMPLETED, SYSTEM_STATES.CANCELLED] };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('restaurant', 'name location logoURL phone')
      .populate('table', 'name code');

    res.json({
      success: true,
      data: {
        orders: orders.map((o) => serializeOrderForCustomer(o, { includeTimeline: false }))
      }
    });
  } catch (error) {
    console.error('🔥 Error in getMyOrders:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error fetching orders.'
    });
  }
};

exports.getCustomerOrder = async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied.'
      });
    }

    const { orderId } = req.params;

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_NOT_FOUND,
        message: 'Order not found.'
      });
    }

    const order = await Order.findById(orderId)
      .populate('restaurant', 'name location logoURL phone')
      .populate('table', 'name code');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_NOT_FOUND,
        message: 'Order not found.'
      });
    }

    // Verify ownership
    if (order.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: ORDER_ERROR_CODES.ORDER_ACCESS_DENIED,
        message: 'Access denied. You do not own this order.'
      });
    }

    res.json({
      success: true,
      data: {
        order: serializeOrderForCustomer(order)
      }
    });
  } catch (error) {
    console.error('🔥 Error in getCustomerOrder:', error);
    res.status(500).json({
      success: false,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'Server error retrieving order.'
    });
  }
};
