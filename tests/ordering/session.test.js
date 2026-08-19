const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const RestaurantTable = require('../../model/restaurantTable');
const RestaurantQrCode = require('../../model/restaurantQrCode');
const OrderSession = require('../../model/orderSession');
const { hashToken } = require('../../services/qrCodeService');
const { validateOrderSessionForOrdering } = require('../../services/orderSessionService');

describe('OrderSession Integration and Hardening', () => {
  let customerToken, customerUser;
  let ownerToken, ownerUser;
  let restaurant, table, qrCode;
  const rawQrToken = 'raw_super_secure_token_123';
  beforeEach(async () => {
    await OrderSession.syncIndexes();
    customerUser = await User.create({
      name: 'Customer test',
      phone: '+251900000001',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    // 2. Create Owner
    ownerUser = await User.create({
      name: 'Owner test',
      phone: '+251900000002',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // 3. Create Restaurant
    restaurant = await Restaurant.create({
      name: 'Test Hardened Cafe',
      phone: '+251911111111',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: {
        type: 'Point',
        coordinates: [38.7500, 9.0200] // [lng, lat]
      },
      orderingRadiusMeters: 100
    });

    // 4. Create Table
    table = await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Table 9',
      code: 'T9',
      isActive: true
    });

    // 5. Create active QR Code
    qrCode = await RestaurantQrCode.create({
      restaurant: restaurant._id,
      table: table._id,
      tokenHash: hashToken(rawQrToken),
      isActive: true,
      createdBy: ownerUser._id
    });
  });

  test('Customer successfully creates session when inside geofence', async () => {
    const res = await request(app)
      .post('/api/order-sessions')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        qrToken: rawQrToken,
        location: {
          latitude: 9.0201, // Near (9.0200, 38.7500)
          longitude: 38.7501,
          accuracy: 15
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session).toBeDefined();

    // Verify coordinates are NOT stored in the database (Privacy Guard)
    const sessionInDb = await OrderSession.findById(res.body.data.session.id);
    expect(sessionInDb.locationVerification.latitude).toBeUndefined();
    expect(sessionInDb.locationVerification.longitude).toBeUndefined();
    expect(sessionInDb.locationVerification.accuracyMeters).toBe(15);
    expect(sessionInDb.locationVerification.distanceMeters).toBeDefined();
  });

  test('Reject session creation if user is not a customer', async () => {
    const res = await request(app)
      .post('/api/order-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        qrToken: rawQrToken,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 }
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CUSTOMER_ROLE_REQUIRED');
  });

  test('Only one active session is permitted globally (auto-cancels other restaurant sessions)', async () => {
    // 1. Setup an existing active session at Restaurant B
    const otherRest = await Restaurant.create({
      name: 'Other Cafe',
      phone: '+251922222222',
      owner: ownerUser._id
    });
    const otherTable = await RestaurantTable.create({
      restaurant: otherRest._id,
      name: 'Table X',
      code: 'TX',
      isActive: true
    });
    const otherQr = await RestaurantQrCode.create({
      restaurant: otherRest._id,
      table: otherTable._id,
      tokenHash: hashToken('token_other'),
      isActive: true,
      createdBy: ownerUser._id
    });

    const oldSession = await OrderSession.create({
      customer: customerUser._id,
      restaurant: otherRest._id,
      table: otherTable._id,
      qrCode: otherQr._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    // 2. Check in at Restaurant A
    const res = await request(app)
      .post('/api/order-sessions')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        qrToken: rawQrToken,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 }
      });

    expect(res.status).toBe(201);

    // 3. Verify old session is marked cancelled
    const oldSessionReload = await OrderSession.findById(oldSession._id);
    expect(oldSessionReload.status).toBe('cancelled');

    // 4. Verify exactly one active session exists
    const activeSessionsCount = await OrderSession.countDocuments({
      customer: customerUser._id,
      status: 'active'
    });
    expect(activeSessionsCount).toBe(1);
  });

  test('Expired session is rejected and marked expired in verification checks', async () => {
    const expiredSession = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurant._id,
      table: table._id,
      qrCode: qrCode._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() - 5000) // 5 seconds ago
    });

    const check = await validateOrderSessionForOrdering(expiredSession._id, customerUser._id);
    expect(check.isValid).toBe(false);
    expect(check.error).toBe('ORDER_SESSION_EXPIRED');

    const updated = await OrderSession.findById(expiredSession._id);
    expect(updated.status).toBe('expired');
  });

  test('Deactivated table invalidates the session', async () => {
    const session = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurant._id,
      table: table._id,
      qrCode: qrCode._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60000)
    });

    // Deactivate table
    table.isActive = false;
    await table.save();

    const check = await validateOrderSessionForOrdering(session._id, customerUser._id);
    expect(check.isValid).toBe(false);
    expect(check.error).toBe('TABLE_INACTIVE');
  });

  test('QR code trust rules: rotation allows active sessions, revocation invalidates them', async () => {
    const session = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurant._id,
      table: table._id,
      qrCode: qrCode._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60000)
    });

    // Case 1: Rotate QR code -> Session remains valid
    qrCode.isActive = false;
    qrCode.rotatedAt = new Date();
    await qrCode.save();

    let check = await validateOrderSessionForOrdering(session._id, customerUser._id);
    expect(check.isValid).toBe(true);

    // Case 2: Revoke QR code -> Session is invalidated
    qrCode.revokedAt = new Date();
    await qrCode.save();

    check = await validateOrderSessionForOrdering(session._id, customerUser._id);
    expect(check.isValid).toBe(false);
    expect(check.error).toBe('QR_CODE_REVOKED');
  });

  test('Concurrency safety: multiple concurrent session requests result in exactly one active session', async () => {
    // Fire two requests concurrently
    const request1 = request(app)
      .post('/api/order-sessions')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        qrToken: rawQrToken,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 }
      });

    const request2 = request(app)
      .post('/api/order-sessions')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        qrToken: rawQrToken,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 }
      });

    const [res1, res2] = await Promise.all([request1, request2]);

    // One request must return 201. The other can return 201 (reused session) or 409 conflict.
    expect([201, 409]).toContain(res1.status);
    expect([201, 409]).toContain(res2.status);

    // Ensure database-level unique index successfully enforced exactly one active session
    const activeSessionsCount = await OrderSession.countDocuments({
      customer: customerUser._id,
      status: 'active'
    });
    expect(activeSessionsCount).toBe(1);
  });
});
