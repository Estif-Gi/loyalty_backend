/**
 * DiningCheck Serializers
 */

function formatCustomer(check) {
  const customerId = check.customer?._id || check.customer;
  return {
    id: customerId ? customerId.toString() : null,
    name: check.customerSnapshot?.name || check.customer?.name || '',
    phone: check.customerSnapshot?.phone || check.customer?.phone || ''
  };
}

function formatTable(check) {
  const tableId = check.table?._id || check.table;
  return {
    id: tableId ? tableId.toString() : null,
    name: check.tableSnapshot?.name || check.table?.name || '',
    code: check.tableSnapshot?.code || check.table?.code || ''
  };
}

function formatRecordedBy(recordedBy) {
  if (!recordedBy) return null;
  if (typeof recordedBy === 'object') {
    const id = recordedBy._id || recordedBy.id;
    return id ? id.toString() : recordedBy.toString();
  }
  return recordedBy.toString();
}

function formatOrderSummary(order, options = {}) {
  const { includeItems = false } = options;
  const orderId = order._id || order.id;

  const summary = {
    id: orderId ? orderId.toString() : null,
    orderNumber: order.orderNumber,
    total: order.pricing?.total || 0,
    currentStepKey: order.currentStepKey,
    systemState: order.systemState,
    createdAt: order.createdAt
  };

  if (includeItems && Array.isArray(order.items)) {
    summary.items = order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      notes: item.notes || ''
    }));
  }

  return summary;
}

/**
 * Serializes a DiningCheck for employee consumption.
 * 
 * @param {object} check - Mongoose DiningCheck document
 * @param {Array} [orders] - Array of Order documents belonging to this check
 * @param {object} [options]
 * @returns {object}
 */
function serializeDiningCheckForEmployee(check, orders = [], options = {}) {
  if (!check) return null;

  const checkId = check._id || check.id;
  const formattedOrders = (orders || []).map((o) => formatOrderSummary(o, options));

  return {
    id: checkId ? checkId.toString() : null,
    customer: formatCustomer(check),
    table: formatTable(check),
    orders: formattedOrders,
    orderCount: formattedOrders.length,
    totals: {
      subtotal: check.totals?.subtotal || 0,
      discount: check.totals?.discount || 0,
      tax: check.totals?.tax || 0,
      serviceCharge: check.totals?.serviceCharge || 0,
      total: check.totals?.total || 0,
      currency: check.totals?.currency || 'ETB'
    },
    payment: {
      isPaid: Boolean(check.payment?.isPaid),
      method: check.payment?.method || null,
      proofUrl: check.payment?.proofUrl || null,
      paidAt: check.payment?.paidAt || null,
      recordedBy: formatRecordedBy(check.payment?.recordedBy)
    },
    openedAt: check.openedAt,
    createdAt: check.createdAt,
    updatedAt: check.updatedAt
  };
}

/**
 * Serializes a DiningCheck for owner history & console views.
 * 
 * @param {object} check - Mongoose DiningCheck document
 * @param {Array} [orders] - Array of Order documents belonging to this check
 * @param {object} [options]
 * @returns {object}
 */
function serializeDiningCheckForOwner(check, orders = [], options = {}) {
  if (!check) return null;

  const checkId = check._id || check.id;
  const formattedOrders = (orders || []).map((o) => formatOrderSummary(o, options));

  return {
    id: checkId ? checkId.toString() : null,
    customer: formatCustomer(check),
    table: formatTable(check),
    orders: formattedOrders,
    orderCount: formattedOrders.length,
    totals: {
      subtotal: check.totals?.subtotal || 0,
      discount: check.totals?.discount || 0,
      tax: check.totals?.tax || 0,
      serviceCharge: check.totals?.serviceCharge || 0,
      total: check.totals?.total || 0,
      currency: check.totals?.currency || 'ETB'
    },
    payment: {
      isPaid: Boolean(check.payment?.isPaid),
      method: check.payment?.method || null,
      proofUrl: check.payment?.proofUrl || null,
      paidAt: check.payment?.paidAt || null,
      recordedBy: formatRecordedBy(check.payment?.recordedBy)
    },
    openedAt: check.openedAt,
    createdAt: check.createdAt,
    updatedAt: check.updatedAt
  };
}

/**
 * Serializes a DiningCheck for customer bill view.
 * 
 * @param {object} check - Mongoose DiningCheck document
 * @param {Array} [orders] - Array of Order documents belonging to this check
 * @returns {object}
 */
function serializeDiningCheckForCustomer(check, orders = []) {
  if (!check) return null;

  const checkId = check._id || check.id;
  const formattedOrders = (orders || []).map((o) => formatOrderSummary(o, { includeItems: true }));

  return {
    id: checkId ? checkId.toString() : null,
    table: formatTable(check),
    orders: formattedOrders,
    orderCount: formattedOrders.length,
    totals: {
      subtotal: check.totals?.subtotal || 0,
      discount: check.totals?.discount || 0,
      tax: check.totals?.tax || 0,
      serviceCharge: check.totals?.serviceCharge || 0,
      total: check.totals?.total || 0,
      currency: check.totals?.currency || 'ETB'
    },
    payment: {
      isPaid: Boolean(check.payment?.isPaid),
      method: check.payment?.method || null,
      paidAt: check.payment?.paidAt || null
    },
    openedAt: check.openedAt,
    createdAt: check.createdAt
  };
}

module.exports = {
  serializeDiningCheckForEmployee,
  serializeDiningCheckForOwner,
  serializeDiningCheckForCustomer,
  formatOrderSummary
};
