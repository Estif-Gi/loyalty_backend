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

    const orders = await Order.find(query).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        orders: orders.map((o) => serializeOrderForCustomer(o))
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
    const order = await Order.findById(orderId);

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
