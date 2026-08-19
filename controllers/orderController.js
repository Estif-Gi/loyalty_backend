const Order = require('../model/order');
const { createOrder } = require('../services/orderService');
const { ORDER_ERROR_CODES, SYSTEM_STATES } = require('../constants/orders');

/**
 * Serializes an order document safely for customer responses (protecting privacy).
 * 
 * @param {object} order - Mongoose order document
 * @returns {object} Projected order object
 */
function serializeOrderForCustomer(order) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    restaurant: order.restaurant,
    table: order.table,
    items: order.items.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      notes: item.notes
    })),
    pricing: {
      subtotal: order.pricing.subtotal,
      discount: order.pricing.discount,
      tax: order.pricing.tax,
      serviceCharge: order.pricing.serviceCharge,
      total: order.pricing.total,
      currency: order.pricing.currency
    },
    currentStepKey: order.currentStepKey,
    systemState: order.systemState,
    customerNotes: order.customerNotes,
    timeline: order.timeline.map((entry) => ({
      stepKey: entry.stepKey,
      systemState: entry.systemState,
      actorType: entry.actorType,
      action: entry.action,
      note: entry.note,
      createdAt: entry.createdAt
    })),
    service: {
      waiter: order.service.waiter,
      claimedAt: order.service.claimedAt,
      assignedAt: order.service.assignedAt,
      assignmentSource: order.service.assignmentSource,
      servedAt: order.service.servedAt
    },
    payment: {
      status: order.payment.status,
      method: order.payment.method,
      paidAt: order.payment.paidAt
    },
    cancellation: order.cancellation.cancelledAt
      ? {
          reason: order.cancellation.reason,
          cancelledAt: order.cancellation.cancelledAt
        }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

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

    const order = await createOrder({
      customerId,
      orderSessionId,
      location,
      items,
      customerNotes,
      idempotencyKey
    });

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
