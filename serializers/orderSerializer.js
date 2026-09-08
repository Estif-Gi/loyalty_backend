const { SYSTEM_STATES } = require('../constants/orders');
const { getNextWorkflowStep, canRoleAdvanceWorkflowStep } = require('../utils/workflow');

/**
 * Safely formats table reference for DTOs.
 */
function formatTable(table) {
  if (!table) return null;
  if (typeof table === 'object' && (table.name !== undefined || table.code !== undefined)) {
    const tableId = table._id || table.id;
    return {
      id: tableId ? tableId.toString() : undefined,
      _id: tableId,
      name: table.name,
      code: table.code
    };
  }
  return table;
}

/**
 * Safely formats restaurant reference for DTOs.
 */
function formatRestaurant(restaurant) {
  if (!restaurant) return null;
  if (typeof restaurant === 'object') {
    if (restaurant.name !== undefined || restaurant.location !== undefined) {
      const restaurantId = restaurant._id || restaurant.id;
      return {
        id: restaurantId ? restaurantId.toString() : undefined,
        _id: restaurantId,
        name: restaurant.name,
        location: restaurant.location,
        logoURL: restaurant.logoURL,
        phone: restaurant.phone
      };
    }
    return restaurant._id || restaurant;
  }
  return restaurant;
}

/**
 * Serializes an order document safely for customer responses (protecting privacy).
 * 
 * @param {object} order - Mongoose order document
 * @returns {object} Projected customer order object
 */
function serializeOrderForCustomer(order, options = {}) {
  if (!order) return null;
  const { includeTimeline = true } = options;

  const result = {
    id: order._id || order.id,
    orderNumber: order.orderNumber,
    restaurant: formatRestaurant(order.restaurant),
    table: formatTable(order.table),
    items: (order.items || []).map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      notes: item.notes || ''
    })),
    pricing: {
      subtotal: order.pricing?.subtotal || 0,
      discount: order.pricing?.discount || 0,
      tax: order.pricing?.tax || 0,
      serviceCharge: order.pricing?.serviceCharge || 0,
      total: order.pricing?.total || 0,
      currency: order.pricing?.currency || 'ETB'
    },
    currentStepKey: order.currentStepKey,
    systemState: order.systemState,
    customerNotes: order.customerNotes || '',
    service: {
      waiter: order.service?.waiter?._id || order.service?.waiter || null,
      claimedAt: order.service?.claimedAt || null,
      assignedAt: order.service?.assignedAt || null,
      assignmentSource: order.service?.assignmentSource || 'table',
      servedAt: order.service?.servedAt || null
    },
    payment: {
      status: order.payment?.status,
      method: order.payment?.method,
      paidAt: order.payment?.paidAt || null
    },
    cancellation: order.cancellation?.cancelledAt
      ? {
          reason: order.cancellation.reason,
          cancelledAt: order.cancellation.cancelledAt
        }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };

  if (includeTimeline && Array.isArray(order.timeline) && order.timeline.length > 0) {
    result.timeline = order.timeline.map((entry) => ({
      stepKey: entry.stepKey,
      systemState: entry.systemState,
      actorType: entry.actorType,
      action: entry.action,
      note: entry.note || '',
      createdAt: entry.createdAt
    }));
  }

  return result;
}

/**
 * Serializes order document for staff queue & waiter realtime updates (including operational metadata).
 * 
 * @param {object} order - Mongoose order document
 * @param {object|null} employee - Employee context for computing available actions
 * @returns {object} Projected employee order object
 */
function serializeOrderForEmployee(order, employee = null) {
  if (!order) return null;

  let currentStep = null;
  let availableAction = null;

  if (order.workflow && Array.isArray(order.workflow.steps)) {
    const stepConfig = order.workflow.steps.find((s) => s.key === order.currentStepKey);
    if (stepConfig) {
      currentStep = {
        key: stepConfig.key,
        label: stepConfig.label,
        actionLabel: stepConfig.actionLabel
      };

      if (employee) {
        const nextStep = getNextWorkflowStep(order.workflow.steps, order.currentStepKey);
        if (nextStep) {
          const isRoleAllowed = canRoleAdvanceWorkflowStep({
            employeeRole: employee.role,
            employeePermissions: employee.permissions || [],
            workflowStep: stepConfig,
            nextStepKey: nextStep.key
          });

          let isAssignedWaiter = true;
          if (employee.role === 'waiter' && order.service && order.service.waiter) {
            const waiterId = order.service.waiter._id 
              ? order.service.waiter._id.toString() 
              : order.service.waiter.toString();
            if (waiterId !== employee.id) {
              isAssignedWaiter = false;
            }
          }

          if (isRoleAllowed && isAssignedWaiter && order.systemState !== SYSTEM_STATES.CANCELLED && order.systemState !== SYSTEM_STATES.COMPLETED) {
            availableAction = {
              canAdvance: true,
              label: stepConfig.actionLabel || (nextStep.key === 'served' ? 'Mark Served' : 'Complete Order')
            };
          }
        }
      }
    }
  }

  let tableObj = formatTable(order.table);
  if (order.table && (!tableObj || typeof tableObj !== 'object' || !tableObj.id)) {
    const tid = order.table._id || order.table.id || order.table;
    tableObj = {
      id: tid ? tid.toString() : undefined,
      _id: tid,
      name: order.table?.name,
      code: order.table?.code
    };
  }

  return {
    id: order._id || order.id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    table: tableObj,
    items: (order.items || []).map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      notes: item.notes || ''
    })),
    pricing: {
      subtotal: order.pricing?.subtotal || 0,
      discount: order.pricing?.discount || 0,
      tax: order.pricing?.tax || 0,
      serviceCharge: order.pricing?.serviceCharge || 0,
      total: order.pricing?.total || 0,
      currency: order.pricing?.currency || 'ETB'
    },
    currentStepKey: order.currentStepKey,
    systemState: order.systemState,
    currentStep,
    availableAction,
    kitchen: order.kitchen,
    service: order.service,
    payment: order.payment,
    timeline: order.timeline,
    customerNotes: order.customerNotes || '',
    cancellation: order.cancellation?.cancelledAt ? order.cancellation : null,
    workflow: order.workflow,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

/**
 * Returns a lightweight realtime summary of an order.
 * 
 * @param {object} order 
 * @returns {object}
 */
function serializeOrderRealtimeSummary(order) {
  if (!order) return null;
  return {
    orderId: (order._id || order.id).toString(),
    orderNumber: order.orderNumber,
    currentStepKey: order.currentStepKey,
    systemState: order.systemState,
    updatedAt: order.updatedAt
  };
}

module.exports = {
  serializeOrderForCustomer,
  serializeOrderForEmployee,
  serializeOrderRealtimeSummary
};
