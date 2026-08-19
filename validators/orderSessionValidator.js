const { validateCoordinates } = require('../services/geofenceService');

/**
 * Validates request payload for creating a new OrderSession.
 */
function validateCreateSession(req, res, next) {
  const { qrToken, location } = req.body;

  if (!qrToken || typeof qrToken !== 'string' || !qrToken.trim()) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_QR_TOKEN',
      message: 'A valid raw QR token is required to start ordering.'
    });
  }

  if (!location || typeof location !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_LOCATION_PAYLOAD',
      message: 'Customer geolocation accuracy and coordinates payload is required.'
    });
  }

  const { latitude, longitude, accuracy } = location;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CUSTOMER_COORDINATES',
      message: 'Customer latitude and longitude coordinates are required.'
    });
  }

  if (!validateCoordinates(latitude, longitude)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CUSTOMER_COORDINATES',
      message: 'Customer latitude and longitude are invalid.',
      details: { latitude, longitude }
    });
  }

  if (accuracy === undefined || typeof accuracy !== 'number' || isNaN(accuracy) || accuracy < 0) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_LOCATION_ACCURACY',
      message: 'Location accuracy reading in meters is required and must be a valid positive number.'
    });
  }

  next();
}

/**
 * Validates coordinate updates for session location verification.
 */
function validateVerifyLocation(req, res, next) {
  const { latitude, longitude, accuracy } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CUSTOMER_COORDINATES',
      message: 'Customer latitude and longitude coordinates are required.'
    });
  }

  if (!validateCoordinates(latitude, longitude)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CUSTOMER_COORDINATES',
      message: 'Customer latitude and longitude are invalid.',
      details: { latitude, longitude }
    });
  }

  if (accuracy === undefined || typeof accuracy !== 'number' || isNaN(accuracy) || accuracy < 0) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_LOCATION_ACCURACY',
      message: 'Location accuracy reading in meters is required and must be a valid positive number.'
    });
  }

  next();
}

module.exports = {
  validateCreateSession,
  validateVerifyLocation
};
