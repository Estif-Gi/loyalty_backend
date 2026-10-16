const mongoose = require('mongoose');
const DiningCheck = require('../model/diningCheck');
const Order = require('../model/order');
const User = require('../model/users');
const RestaurantTable = require('../model/restaurantTable');
const { SYSTEM_STATES, PAYMENT_METHODS, ORDER_ERROR_CODES } = require('../constants/orders');
const {
  emitDiningCheckUpdated,
  emitDiningCheckPaymentUpdated,
  emitDiningChecksInvalidated
} = require('./orderRealtimeService');

/**
 * Finds or atomically creates a DiningCheck for a given OrderSession.
 * Enforces one check per OrderSession with safe handling of concurrent requests.
 * 
 * @param {object} params
 * @param {object|string} params.session - OrderSession document or session object
 * @param {object|string} params.restaurant - Restaurant document or ID
 * @param {object|string} params.table - Table document or ID
 * @param {object|string} params.customer - User document or ID
 * @returns {Promise<object>} The found or newly created DiningCheck document
 */
async function findOrCreateDiningCheck({ session, restaurant, table, customer }) {
  const sessionId = session._id || session;
  const restaurantId = restaurant._id || restaurant;
  const tableId = table._id || table;
  const customerId = customer._id || customer;

  // 1. Check if already exists
  const existingCheck = await DiningCheck.findOne({ orderSession: sessionId });
  if (existingCheck) {
    return existingCheck;
  }

  // 2. Resolve Customer Snapshot details if not provided
  let customerName = customer?.name || '';
  let customerPhone = customer?.phone || '';
  if (!customerName && customerId) {
    const userDoc = await User.findById(customerId).select('name phone');
    if (userDoc) {
      customerName = userDoc.name || '';
      customerPhone = userDoc.phone || '';
    }
  }

  // 3. Resolve Table Snapshot details if not provided
  let tableName = table?.name || '';
  let tableCode = table?.code || '';
  if ((!tableName || !tableCode) && tableId) {
    const tableDoc = await RestaurantTable.findById(tableId).select('name code');
    if (tableDoc) {
      tableName = tableDoc.name || '';
      tableCode = tableDoc.code || '';
    }
  }

  // 4. Atomic upsert to safely prevent concurrency races
  try {
    const check = await DiningCheck.findOneAndUpdate(
      { orderSession: sessionId },
      {
        $setOnInsert: {
          restaurant: restaurantId,
          customer: customerId,
          table: tableId,
          orderSession: sessionId,
          customerSnapshot: {
            name: customerName,
            phone: customerPhone
          },
          tableSnapshot: {
            name: tableName,
            code: tableCode
          },
          totals: {
            subtotal: 0,
            discount: 0,
            tax: 0,
            serviceCharge: 0,
            total: 0,
            currency: 'ETB'
          },
          payment: {
            isPaid: false,
            method: null,
            proofUrl: null,
            proofPublicId: null,
            recordedBy: null,
            paidAt: null
          },
          openedAt: new Date()
        }
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true
      }
    );
    return check;
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key race condition caught by unique orderSession index
      const existingAfterRace = await DiningCheck.findOne({ orderSession: sessionId });
      if (existingAfterRace) {
        return existingAfterRace;
      }
    }
    throw error;
  }
}

/**
 * Authoritatively calculates and updates the total for a DiningCheck from its non-cancelled Orders.
 * 
 * @param {string|mongoose.Types.ObjectId} checkId
 * @returns {Promise<object>} The updated DiningCheck document
 */
async function recalculateDiningCheckTotals(checkId) {
  const check = await DiningCheck.findById(checkId);
  if (!check) {
    throw {
      status: 404,
      error: ORDER_ERROR_CODES.DINING_CHECK_NOT_FOUND,
      message: 'Dining check not found.'
    };
  }

  // Fetch all non-cancelled orders belonging to this dining check
  const activeOrders = await Order.find({
    diningCheck: checkId,
    systemState: { $ne: SYSTEM_STATES.CANCELLED }
  });

  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let serviceCharge = 0;
  let total = 0;
  let currency = check.totals?.currency || 'ETB';

  for (const ord of activeOrders) {
    if (ord.pricing) {
      subtotal += Number(ord.pricing.subtotal) || 0;
      discount += Number(ord.pricing.discount) || 0;
      tax += Number(ord.pricing.tax) || 0;
      serviceCharge += Number(ord.pricing.serviceCharge) || 0;
      total += Number(ord.pricing.total) || 0;
      if (ord.pricing.currency) {
        currency = ord.pricing.currency;
      }
    }
  }

  // Round to 2 decimal places to avoid IEEE 754 precision issues
  subtotal = Math.round(subtotal * 100) / 100;
  discount = Math.round(discount * 100) / 100;
  tax = Math.round(tax * 100) / 100;
  serviceCharge = Math.round(serviceCharge * 100) / 100;
  total = Math.round(total * 100) / 100;

  const updatedCheck = await DiningCheck.findByIdAndUpdate(
    checkId,
    {
      $set: {
        totals: {
          subtotal,
          discount,
          tax,
          serviceCharge,
          total,
          currency
        }
      }
    },
    { returnDocument: 'after' }
  );

  return updatedCheck;
}

/**
 * Returns all orders belonging to a DiningCheck.
 * 
 * @param {string|mongoose.Types.ObjectId} checkId
 * @returns {Promise<Array>} Array of Order documents
 */
async function getOrdersForDiningCheck(checkId) {
  return Order.find({ diningCheck: checkId }).sort({ createdAt: 1 });
}

module.exports = {
  findOrCreateDiningCheck,
  recalculateDiningCheckTotals,
  getOrdersForDiningCheck
};
