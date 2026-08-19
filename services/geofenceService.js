const { MAX_ACCEPTED_LOCATION_ACCURACY_METERS } = require('../constants/ordering');

/**
 * Validates coordinate ranges.
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {boolean}
 */
function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
    return false;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

/**
 * Calculates distance in meters between two lat/lng pairs using the Haversine formula.
 * @param {number} lat1 - Point 1 Latitude
 * @param {number} lng1 - Point 1 Longitude
 * @param {number} lat2 - Point 2 Latitude
 * @param {number} lng2 - Point 2 Longitude
 * @returns {number} Distance in meters
 */
function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Verifies if coordinates are close enough to a restaurant.
 * @param {object} params
 * @param {object} params.restaurant - Restaurant document containing orderingLocation
 * @param {number} params.latitude - Customer Latitude
 * @param {number} params.longitude - Customer Longitude
 * @param {number} params.accuracy - Geolocation reading accuracy in meters
 * @returns {object} Verification result: { isPresent: boolean, distanceMeters?: number, error?: string, details?: object }
 */
function verifyRestaurantPresence({ restaurant, latitude, longitude, accuracy }) {
  if (!restaurant.orderingLocation || !restaurant.orderingLocation.coordinates || restaurant.orderingLocation.coordinates.length !== 2) {
    return {
      isPresent: false,
      error: 'RESTAURANT_ORDERING_LOCATION_MISSING'
    };
  }

  // Radius-aware accuracy constraint: accuracy must be at most min(global_max, restaurant_radius)
  const maxAccuracy = Math.min(MAX_ACCEPTED_LOCATION_ACCURACY_METERS, restaurant.orderingRadiusMeters || 100);

  if (accuracy > maxAccuracy) {
    return {
      isPresent: false,
      error: 'LOCATION_ACCURACY_TOO_LOW',
      details: {
        accuracyMeters: accuracy,
        maximumAllowedAccuracyMeters: maxAccuracy
      }
    };
  }

  // coordinates are stored in [lng, lat] format in MongoDB GeoJSON
  const [restLng, restLat] = restaurant.orderingLocation.coordinates;
  const distance = calculateDistanceMeters(latitude, longitude, restLat, restLng);

  const radiusLimit = restaurant.orderingRadiusMeters || 100;

  if (distance > radiusLimit) {
    return {
      isPresent: false,
      distanceMeters: Math.round(distance),
      error: 'OUTSIDE_RESTAURANT_ORDERING_RADIUS',
      details: {
        distanceMeters: Math.round(distance),
        allowedRadiusMeters: radiusLimit,
        locationAccuracyMeters: accuracy
      }
    };
  }

  return {
    isPresent: true,
    distanceMeters: Math.round(distance)
  };
}

module.exports = {
  validateCoordinates,
  calculateDistanceMeters,
  verifyRestaurantPresence
};
