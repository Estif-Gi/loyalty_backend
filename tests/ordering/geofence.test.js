const { validateCoordinates, calculateDistanceMeters, verifyRestaurantPresence } = require('../../services/geofenceService');

describe('Geofence Coordinate Ranges & Accuracy Checks', () => {
  test('Coordinate validation bounds check', () => {
    expect(validateCoordinates(9.0123, 38.7654)).toBe(true);
    expect(validateCoordinates(-91, 38.7654)).toBe(false);
    expect(validateCoordinates(9.0123, 181)).toBe(false);
    expect(validateCoordinates(NaN, 38.7654)).toBe(false);
    expect(validateCoordinates(Infinity, 38.7654)).toBe(false);
  });

  test('Haversine distance outputs realistic ranges', () => {
    // Meba Cafe area
    const lat1 = 9.0200;
    const lng1 = 38.7500;
    
    // ~110m away
    const lat2 = 9.0205;
    const lng2 = 38.7508;

    const dist = calculateDistanceMeters(lat1, lng1, lat2, lng2);
    expect(dist).toBeGreaterThan(90);
    expect(dist).toBeLessThan(130);
  });

  test('Reject poor GPS accuracy according to radius-aware policy', () => {
    // Case 1: Restaurant radius is 50m. GPS reports 60m accuracy -> Rejected (max accuracy is min(150, 50) = 50m)
    const restaurant50 = {
      orderingLocation: { coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 50
    };

    const res50 = verifyRestaurantPresence({
      restaurant: restaurant50,
      latitude: 9.0201,
      longitude: 38.7501,
      accuracy: 60
    });
    expect(res50.isPresent).toBe(false);
    expect(res50.error).toBe('LOCATION_ACCURACY_TOO_LOW');

    // Case 2: Restaurant radius is 100m. GPS reports 80m accuracy -> Approved (max accuracy is min(150, 100) = 100m)
    const restaurant100 = {
      orderingLocation: { coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100
    };

    const res100 = verifyRestaurantPresence({
      restaurant: restaurant100,
      latitude: 9.0201,
      longitude: 38.7501,
      accuracy: 80
    });
    expect(res100.isPresent).toBe(true);
  });

  test('Reject customer when mathematically outside restaurant radius limit', () => {
    const restaurant = {
      orderingLocation: { coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100
    };

    // Far coordinates (~1.1 km away)
    const res = verifyRestaurantPresence({
      restaurant,
      latitude: 9.0300,
      longitude: 38.7500,
      accuracy: 10
    });
    expect(res.isPresent).toBe(false);
    expect(res.error).toBe('OUTSIDE_RESTAURANT_ORDERING_RADIUS');
  });
});
