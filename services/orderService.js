const Order = require('../model/order');
const Restaurant = require('../model/restaurant');
const RestaurantTable = require('../model/restaurantTable');
const RestaurantQrCode = require('../model/restaurantQrCode');
const OrderSession = require('../model/orderSession');
const Employee = require('../model/employee');
const { validateOrderSessionForOrdering } = require('./orderSessionService');
const { verifyRestaurantPresence } = require('./geofenceService');
const { verifyAndCalculatePricing } = require('./orderPricingService');
const { ORDER_ERROR_CODES, SYSTEM_STATES } = require('../constants/orders');

/**
 * Generates the next sequential order number for a restaurant.
 * Example format: ORD-101, ORD-102.
 * 
 * @param {string} restaurantId 
 * @returns {Promise<string>} e.g. 'ORD-101'
 */
async function getNextOrderNumber(restaurantId) {
  const latestOrder = await Order.findOne({ restaurant: restaurantId }).sort({ createdAt: -1 });
  let nextSeq = 101;
  if (latestOrder && latestOrder.orderNumber) {
    const match = latestOrder.orderNumber.match(/ORD-(\d+)/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }
  return `ORD-${nextSeq}`;
}

/**
 * Creates a new order. Enforces OrderSession validation, fresh location check,
 * pricing snapshot, workflow snapshotting, and unique orderNumber sequences.
 * 
 * @param {object} params
 * @param {string} params.customerId
 * @param {string} params.orderSessionId
 * @param {object} params.location - { latitude, longitude, accuracy }
 * @param {Array} params.items - Client-submitted cart items
 * @param {string} params.customerNotes
 * @param {string} params.idempotencyKey
 * @returns {Promise<object>} The created order document
 */
async function createOrder({
  customerId,
  orderSessionId,
  location,
  items,
  customerNotes,
  idempotencyKey
}) {
  // 1. Check Idempotency first (Section 25)
  const existingOrder = await Order.findOne({ idempotencyKey });
  if (existingOrder) {
    return existingOrder;
  }

  // 2. Validate OrderSession (Section 6)
  const sessionCheck = await validateOrderSessionForOrdering(orderSessionId, customerId);
  if (!sessionCheck.isValid) {
    throw {
      status: sessionCheck.error === 'ORDER_SESSION_NOT_OWNED' ? 403 : 400,
      error: ORDER_ERROR_CODES.ORDER_SESSION_INVALID,
      message: sessionCheck.message,
      details: { innerError: sessionCheck.error }
    };
  }

  const { session, restaurant, table } = sessionCheck;

  // 3. Resolve and validate Waiter Assignment (Sections 9, 10, 11)
  if (!table.assignedWaiter) {
    throw {
      status: 409,
      error: 'TABLE_WAITER_NOT_ASSIGNED',
      message: 'This table does not currently have an assigned waiter. Please ask restaurant staff for assistance.'
    };
  }

  const waiter = await Employee.findOne({
    _id: table.assignedWaiter,
    restaurant: restaurant._id,
    role: 'waiter',
    isActive: true
  });

  if (!waiter) {
    throw {
      status: 409,
      error: 'TABLE_WAITER_UNAVAILABLE',
      message: 'The waiter assigned to this table is currently unavailable. Restaurant staff must assign another waiter before ordering can continue.'
    };
  }

  // 4. Verify Fresh Location (Section 7)
  const { latitude, longitude, accuracy } = location;
  const presence = verifyRestaurantPresence({
    restaurant,
    latitude,
    longitude,
    accuracy
  });

  if (!presence.isPresent) {
    throw {
      status: 403,
      error: ORDER_ERROR_CODES.ORDER_LOCATION_VERIFICATION_FAILED,
      message: 'Your fresh location reading could not be verified at the restaurant.',
      details: {
        distanceMeters: presence.distanceMeters,
        allowedRadiusMeters: restaurant.orderingRadiusMeters || 100
      }
    };
  }

  // 5. Verify Pricing and load snapshots (Section 9 & 10)
  const pricingResult = await verifyAndCalculatePricing(restaurant._id, items);

  // 6. Snapshot workflow configuration (Section 16)
  const activeWorkflowSteps = restaurant.orderWorkflow.filter((s) => s.enabled);
  const workflowSnapshot = {
    version: restaurant.orderWorkflowVersion || 1,
    steps: activeWorkflowSteps.map((s) => ({
      key: s.key,
      label: s.label,
      systemState: s.systemState,
      responsibleRole: s.responsibleRole,
      visibleToRoles: s.visibleToRoles,
      actionRoles: s.actionRoles,
      actionLabel: s.actionLabel,
      order: s.order,
      enabled: s.enabled,
      required: s.required,
      autoAdvance: s.autoAdvance || false
    }))
  };

  // First enabled step keys initialization (Section 17)
  const sortedSteps = workflowSnapshot.steps.sort((a, b) => a.order - b.order);
  const firstStep = sortedSteps[0];
  if (!firstStep || firstStep.key !== 'placed') {
    throw {
      status: 500,
      error: ORDER_ERROR_CODES.SERVER_ERROR,
      message: 'The restaurant workflow is misconfigured. Placed must be enabled.'
    };
  }

  // Determine current step key & timeline entries based on autoAdvance (Section 20 & 21)
  let currentStepKey = firstStep.key;
  let systemState = firstStep.systemState;
  const timeline = [
    {
      stepKey: firstStep.key,
      systemState: firstStep.systemState,
      actorType: 'customer',
      actorId: customerId,
      action: 'order_created',
      note: 'Order successfully created via table check-in.'
    }
  ];

  if (firstStep.autoAdvance && sortedSteps.length > 1) {
    const nextStep = sortedSteps[1];
    currentStepKey = nextStep.key;
    systemState = nextStep.systemState;
    timeline.push({
      stepKey: nextStep.key,
      systemState: nextStep.systemState,
      actorType: 'system',
      actorId: restaurant._id,
      action: 'auto_started_preparation',
      note: 'Order automatically transitioned to preparation.'
    });
  }

  // 7. Assemble Order
  const order = new Order({
    customer: customerId,
    restaurant: restaurant._id,
    table: table._id,
    orderSession: session._id,
    items: pricingResult.items,
    pricing: pricingResult.pricing,
    workflow: workflowSnapshot,
    currentStepKey,
    systemState,
    service: {
      waiter: waiter._id,
      assignedAt: new Date(),
      assignmentSource: 'table',
      servedAt: null
    },
    customerNotes: customerNotes || '',
    idempotencyKey,
    timeline
  });

  // 7. Save order with atomic duplicate orderNumber collision retry up to 5 times (Section 4)
  let attempts = 0;
  while (attempts < 5) {
    try {
      order.orderNumber = await getNextOrderNumber(restaurant._id);
      return await order.save();
    } catch (error) {
      if (error.code === 11000) {
        if (error.message.includes('orderNumber')) {
          attempts++;
        } else if (error.message.includes('idempotencyKey')) {
          const existing = await Order.findOne({ idempotencyKey });
          if (existing) {
            return existing;
          }
          throw error;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  throw {
    status: 409,
    error: ORDER_ERROR_CODES.ORDER_STATE_CHANGED,
    message: 'Could not generate a unique order number after multiple attempts. Please try again.'
  };
}

module.exports = {
  createOrder
};
