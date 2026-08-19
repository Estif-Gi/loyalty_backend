const OrderSession = require('../model/orderSession');
const Restaurant = require('../model/restaurant');
const RestaurantTable = require('../model/restaurantTable');
const RestaurantQrCode = require('../model/restaurantQrCode');
const { DEFAULT_ORDER_SESSION_MINUTES } = require('../constants/ordering');

/**
 * Resolves active, non-expired sessions.
 * @param {string} customerId 
 * @param {string} restaurantId 
 * @param {string} tableId 
 * @returns {Promise<object|null>} Active session document or null
 */
async function getExistingActiveSession(customerId, restaurantId, tableId) {
  // Query active, non-expired session
  return await OrderSession.findOne({
    customer: customerId,
    restaurant: restaurantId,
    table: tableId,
    status: 'active',
    expiresAt: { $gt: new Date() }
  });
}

/**
 * Enforces session conflict rules.
 * Customer may have only one active restaurant OrderSession at a time.
 * Sessions for other restaurants are cancelled.
 * @param {string} customerId 
 * @param {string} currentRestaurantId 
 */
async function enforceSingleActiveSession(customerId, currentRestaurantId) {
  // Cancel active sessions belonging to other restaurants
  await OrderSession.updateMany(
    {
      customer: customerId,
      restaurant: { $ne: currentRestaurantId },
      status: 'active'
    },
    {
      $set: { status: 'cancelled' }
    }
  );
}

/**
 * Refreshes an existing active session.
 * @param {object} session - Mongoose session document
 * @param {object} locationDetails - Accuracy, distance
 * @returns {Promise<object>} Refreshed session document
 */
async function refreshSession(session, locationDetails) {
  const durationMinutes = DEFAULT_ORDER_SESSION_MINUTES;
  const newExpiration = new Date(Date.now() + durationMinutes * 60 * 1000);

  session.locationVerification = {
    accuracyMeters: locationDetails.accuracy,
    distanceMeters: locationDetails.distanceMeters,
    verifiedAt: new Date()
  };
  session.expiresAt = newExpiration;
  session.lastVerifiedAt = new Date();
  
  return await session.save();
}

/**
 * Validates an active OrderSession for ordering purposes.
 * Evaluates expiration, customer ownership, table deactivations, QR revocation status, and restaurant ordering status.
 * @param {string} sessionId 
 * @param {string} customerId 
 * @returns {Promise<{isValid: boolean, error?: string, message?: string, session?: object}>}
 */
async function validateOrderSessionForOrdering(sessionId, customerId) {
  const session = await OrderSession.findById(sessionId);
  if (!session) {
    return { isValid: false, error: 'ORDER_SESSION_NOT_FOUND', message: 'Ordering session not found.' };
  }

  // Verify ownership
  if (session.customer.toString() !== customerId.toString()) {
    return { isValid: false, error: 'ORDER_SESSION_NOT_OWNED', message: 'Access denied. You do not own this ordering session.' };
  }

  // Verify session status
  if (session.status !== 'active') {
    return { isValid: false, error: 'ORDER_SESSION_INACTIVE', message: `Ordering session is inactive (${session.status}).` };
  }

  // Verify session expiration (ruling out TTL delay)
  if (session.expiresAt <= new Date()) {
    session.status = 'expired';
    await session.save();
    return { isValid: false, error: 'ORDER_SESSION_EXPIRED', message: 'Ordering session has expired.' };
  }

  // Revalidate Restaurant
  const restaurant = await Restaurant.findById(session.restaurant);
  if (!restaurant) {
    return { isValid: false, error: 'RESTAURANT_NOT_FOUND', message: 'Associated restaurant not found.' };
  }

  if (!restaurant.orderingEnabled) {
    return { isValid: false, error: 'RESTAURANT_ORDERING_DISABLED', message: 'Ordering is currently disabled for this restaurant.' };
  }

  // Revalidate Table
  const table = await RestaurantTable.findById(session.table);
  if (!table) {
    return { isValid: false, error: 'TABLE_NOT_FOUND', message: 'Associated table not found.' };
  }

  if (!table.isActive) {
    return { isValid: false, error: 'TABLE_INACTIVE', message: 'Associated table is inactive.' };
  }

  // Revalidate QR Code (trust rules: rotation allows, revocation invalidates)
  const qrCode = await RestaurantQrCode.findById(session.qrCode);
  if (!qrCode) {
    return { isValid: false, error: 'QR_CODE_NOT_FOUND', message: 'Associated QR code not found.' };
  }

  if (!qrCode.isActive && qrCode.revokedAt !== null) {
    return { isValid: false, error: 'QR_CODE_REVOKED', message: 'The QR code associated with this session has been revoked.' };
  }

  return { isValid: true, session, restaurant, table };
}

module.exports = {
  getExistingActiveSession,
  enforceSingleActiveSession,
  refreshSession,
  validateOrderSessionForOrdering
};
