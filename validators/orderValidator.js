const mongoose = require('mongoose');
const { ORDER_ERROR_CODES } = require('../constants/orders');

/**
 * Validates request payload for creating an order.
 */
function validateCreateOrder(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    return res.status(400).json({
      success: false,
      error: ORDER_ERROR_CODES.INVALID_ORDER_QUANTITY,
      message: 'Idempotency-Key header is required.'
    });
  }

  const { orderSessionId, location, items } = req.body;

  if (!orderSessionId || !mongoose.isValidObjectId(orderSessionId)) {
    return res.status(400).json({
      success: false,
      error: ORDER_ERROR_CODES.ORDER_SESSION_INVALID,
      message: 'A valid orderSessionId is required.'
    });
  }

  if (!location || typeof location !== 'object') {
    return res.status(400).json({
      success: false,
      error: ORDER_ERROR_CODES.ORDER_LOCATION_VERIFICATION_FAILED,
      message: 'GPS location object containing latitude, longitude, and accuracy is required.'
    });
  }

  const { latitude, longitude, accuracy } = location;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    typeof accuracy !== 'number' ||
    isNaN(latitude) ||
    isNaN(longitude) ||
    isNaN(accuracy) ||
    !isFinite(latitude) ||
    !isFinite(longitude) ||
    !isFinite(accuracy)
  ) {
    return res.status(400).json({
      success: false,
      error: ORDER_ERROR_CODES.ORDER_LOCATION_VERIFICATION_FAILED,
      message: 'Invalid coordinate bounds or parameters.'
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: ORDER_ERROR_CODES.ORDER_MENU_EMPTY,
      message: 'Your cart cannot be empty. Please select at least one item.'
    });
  }

  for (const item of items) {
    if (!item.menuItemId || !mongoose.isValidObjectId(item.menuItemId)) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.MENU_ITEM_NOT_FOUND,
        message: `Invalid menuItemId format: ${item.menuItemId}`
      });
    }

    const { quantity } = item;
    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    ) {
      return res.status(400).json({
        success: false,
        error: ORDER_ERROR_CODES.INVALID_ORDER_QUANTITY,
        message: 'Item quantities must be integers between 1 and 50.'
      });
    }
  }

  next();
}

module.exports = {
  validateCreateOrder
};
