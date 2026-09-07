const crypto = require('crypto');
const { getIo } = require('../sockets/ioInstance');
const {
  serializeOrderForCustomer,
  serializeOrderForEmployee
} = require('../serializers/orderSerializer');

/**
 * Creates a standard event envelope.
 * 
 * @param {string} type - Event type (e.g. 'order:created', 'order:updated', 'order:cancelled', 'orders:invalidate')
 * @param {object} data - Event payload data
 * @returns {object} Standard envelope
 */
function createEventEnvelope(type, data) {
  return {
    eventId: crypto.randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    data
  };
}

/**
 * Helper to extract string ID from an ObjectId or populated document.
 */
function toIdString(entity) {
  if (!entity) return null;
  if (typeof entity === 'string') return entity;
  if (entity._id) return entity._id.toString();
  if (entity.id) return entity.id.toString();
  return entity.toString();
}

/**
 * Emits realtime events when a new order is created and committed to MongoDB.
 * 
 * 1. Emits 'order:created' to assigned waiter room: employee:<waiterId>
 * 2. Emits 'order:created' to customer room: customer:<customerId>
 * 3. Emits 'orders:invalidate' to restaurant room: restaurant:<restaurantId>
 * 
 * @param {object} order - Mongoose order document
 */
function emitOrderCreated(order) {
  try {
    const io = getIo();
    if (!io) return;

    const orderId = toIdString(order);
    const customerId = toIdString(order.customer);
    const waiterId = toIdString(order.service?.waiter);
    const restaurantId = toIdString(order.restaurant);

    // 1. Assigned Waiter gets direct new-order notification with employee order DTO
    if (waiterId) {
      const waiterPayload = createEventEnvelope('order:created', {
        order: serializeOrderForEmployee(order)
      });
      io.to(`employee:${waiterId}`).emit('order:created', waiterPayload);
    }

    // 2. Customer gets order creation event for device/tab synchronization
    if (customerId) {
      const customerPayload = createEventEnvelope('order:created', {
        order: serializeOrderForCustomer(order)
      });
      io.to(`customer:${customerId}`).emit('order:created', customerPayload);
    }

    // 3. Restaurant staff receives a lightweight invalidation signal (no full order data)
    if (restaurantId) {
      const invalidatePayload = createEventEnvelope('orders:invalidate', {
        orderId,
        reason: 'created'
      });
      io.to(`restaurant:${restaurantId}`).emit('orders:invalidate', invalidatePayload);
    }
  } catch (err) {
    console.error('Realtime order event failed:', {
      orderId: toIdString(order),
      eventType: 'order:created',
      error: err.message
    });
  }
}

/**
 * Emits realtime events when an order is updated (e.g. placed -> served, served -> completed).
 * 
 * 1. Emits 'order:updated' to customer room: customer:<customerId>
 * 2. Emits 'order:updated' to assigned waiter room: employee:<waiterId>
 * 3. Emits 'orders:invalidate' to restaurant room: restaurant:<restaurantId>
 * 
 * @param {object} order - Updated mongoose order document
 * @param {object} [metadata]
 * @param {string} [metadata.previousStepKey] - The workflow step key prior to this transition
 */
function emitOrderUpdated(order, metadata = {}) {
  try {
    const io = getIo();
    if (!io) return;

    const orderId = toIdString(order);
    const customerId = toIdString(order.customer);
    const waiterId = toIdString(order.service?.waiter);
    const restaurantId = toIdString(order.restaurant);

    const updateData = {
      orderId,
      orderNumber: order.orderNumber,
      previousStepKey: metadata.previousStepKey || null,
      currentStepKey: order.currentStepKey,
      systemState: order.systemState,
      updatedAt: (order.updatedAt || new Date()).toISOString()
    };

    const updateEnvelope = createEventEnvelope('order:updated', updateData);

    // 1. Notify Customer
    if (customerId) {
      io.to(`customer:${customerId}`).emit('order:updated', updateEnvelope);
    }

    // 2. Notify Assigned Waiter
    if (waiterId) {
      io.to(`employee:${waiterId}`).emit('order:updated', updateEnvelope);
    }

    // 3. Notify Restaurant (invalidation signal)
    if (restaurantId) {
      const invalidatePayload = createEventEnvelope('orders:invalidate', {
        orderId,
        reason: 'updated'
      });
      io.to(`restaurant:${restaurantId}`).emit('orders:invalidate', invalidatePayload);
    }
  } catch (err) {
    console.error('Realtime order event failed:', {
      orderId: toIdString(order),
      eventType: 'order:updated',
      error: err.message
    });
  }
}

/**
 * Emits realtime events when an order is cancelled.
 * 
 * 1. Emits 'order:cancelled' to customer room: customer:<customerId>
 * 2. Emits 'order:cancelled' to assigned waiter room: employee:<waiterId>
 * 3. Emits 'orders:invalidate' to restaurant room: restaurant:<restaurantId>
 * 
 * @param {object} order - Cancelled mongoose order document
 * @param {object} [metadata]
 * @param {string} [metadata.reason] - Reason for cancellation
 */
function emitOrderCancelled(order, metadata = {}) {
  try {
    const io = getIo();
    if (!io) return;

    const orderId = toIdString(order);
    const customerId = toIdString(order.customer);
    const waiterId = toIdString(order.service?.waiter);
    const restaurantId = toIdString(order.restaurant);

    const reason = metadata.reason || order.cancellation?.reason || 'Cancelled by staff override';

    const cancelData = {
      orderId,
      orderNumber: order.orderNumber,
      currentStepKey: order.currentStepKey,
      systemState: order.systemState,
      reason
    };

    const cancelEnvelope = createEventEnvelope('order:cancelled', cancelData);

    // 1. Notify Customer
    if (customerId) {
      io.to(`customer:${customerId}`).emit('order:cancelled', cancelEnvelope);
    }

    // 2. Notify Assigned Waiter
    if (waiterId) {
      io.to(`employee:${waiterId}`).emit('order:cancelled', cancelEnvelope);
    }

    // 3. Notify Restaurant (invalidation signal)
    if (restaurantId) {
      const invalidatePayload = createEventEnvelope('orders:invalidate', {
        orderId,
        reason: 'cancelled'
      });
      io.to(`restaurant:${restaurantId}`).emit('orders:invalidate', invalidatePayload);
    }
  } catch (err) {
    console.error('Realtime order event failed:', {
      orderId: toIdString(order),
      eventType: 'order:cancelled',
      error: err.message
    });
  }
}

module.exports = {
  createEventEnvelope,
  emitOrderCreated,
  emitOrderUpdated,
  emitOrderCancelled
};
