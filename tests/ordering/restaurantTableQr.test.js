const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const RestaurantTable = require('../../model/restaurantTable');
const RestaurantQrCode = require('../../model/restaurantQrCode');

describe('Stable Restaurant Table QR Management and Role Permissions', () => {
  let ownerTokenA, ownerUserA;
  let ownerTokenB, ownerUserB;
  let adminToken, adminUser;
  let customerToken, customerUser;
  let restaurantA, tableA1;
  
  beforeEach(async () => {
    // 1. Create Owners
    ownerUserA = await User.create({
      name: 'Owner A',
      phone: '+251920000001',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenA = jwt.sign({ id: ownerUserA._id, role: 'owner' }, process.env.JWT_SECRET);

    ownerUserB = await User.create({
      name: 'Owner B',
      phone: '+251920000002',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenB = jwt.sign({ id: ownerUserB._id, role: 'owner' }, process.env.JWT_SECRET);

    // 2. Create Admin
    adminUser = await User.create({
      name: 'Admin User',
      phone: '+251920000003',
      password: 'password123',
      role: 'admin'
    });
    adminToken = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET);

    // 3. Create Customer
    customerUser = await User.create({
      name: 'Customer User',
      phone: '+251920000004',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    // 4. Create Restaurant A & Table A1
    restaurantA = await Restaurant.create({
      name: 'Restaurant A',
      phone: '+251911111112',
      owner: ownerUserA._id,
      orderingEnabled: true
    });

    tableA1 = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table A1',
      code: 'TA1',
      isActive: true
    });
  });

  test('Owner Restaurant A generates QR for Table A1 -> success and creates encryptedToken', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBeDefined();

    // Verify database contains encryptedToken
    const qrInDb = await RestaurantQrCode.findById(res.body.data.qrCodeId);
    expect(qrInDb.encryptedToken).toBeDefined();
    expect(qrInDb.encryptedToken).not.toBeNull();
  });

  test('Owner Restaurant A retrieves Table A1 QR -> same ordering URL', async () => {
    // Generate QR first
    const genRes = await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();
    const originalUrl = genRes.body.data.url;

    // Retrieve active QR code metadata
    const getRes = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    
    // Find active QR in list
    const activeQr = getRes.body.data.find(q => q.isActive);
    expect(activeQr).toBeDefined();
    expect(activeQr.url).toBe(originalUrl);
    expect(activeQr.tokenHash).toBeUndefined();
    expect(activeQr.encryptedToken).toBeUndefined();
  });

  test('Retrieve active QR multiple times -> returns same URL, does not generate new records', async () => {
    // Generate QR
    await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    const countBefore = await RestaurantQrCode.countDocuments({ table: tableA1._id });

    // Retrieve 5 times
    let firstUrl = null;
    for (let i = 0; i < 5; i++) {
      const getRes = await request(app)
        .get(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      
      const activeQr = getRes.body.data.find(q => q.isActive);
      if (firstUrl === null) {
        firstUrl = activeQr.url;
      } else {
        expect(activeQr.url).toBe(firstUrl);
      }
    }

    const countAfter = await RestaurantQrCode.countDocuments({ table: tableA1._id });
    expect(countAfter).toBe(countBefore);
  });

  test('Different restaurant owner B attempts Table A1 QR retrieval -> 403 Forbidden', async () => {
    // Generate QR first
    await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    const getRes = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenB}`);

    expect(getRes.status).toBe(403);
    expect(getRes.body.success).toBe(false);
  });

  test('Customer attempts Table A1 QR retrieval -> 403 Forbidden', async () => {
    const getRes = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(getRes.status).toBe(403);
  });

  test('Owner attempts to rotate Table A1 QR -> 403 ADMIN_PERMISSION_REQUIRED', async () => {
    const rotateRes = await request(app)
      .patch(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr/rotate`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    expect(rotateRes.status).toBe(403);
    expect(rotateRes.body.success).toBe(false);
    expect(rotateRes.body.error).toBe('ADMIN_PERMISSION_REQUIRED');
  });

  test('Owner attempts to revoke Table A1 QR -> 403 ADMIN_PERMISSION_REQUIRED', async () => {
    // Generate QR
    const genRes = await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();
    const qrCodeId = genRes.body.data.qrCodeId;

    const revokeRes = await request(app)
      .patch(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr/${qrCodeId}/revoke`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();

    expect(revokeRes.status).toBe(403);
    expect(revokeRes.body.success).toBe(false);
    expect(revokeRes.body.error).toBe('ADMIN_PERMISSION_REQUIRED');
  });

  test('Platform Admin can rotate Table A1 QR successfully', async () => {
    // Generate QR first
    const genRes = await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();
    const firstUrl = genRes.body.data.url;

    // Rotate as Admin
    const rotateRes = await request(app)
      .patch(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr/rotate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.success).toBe(true);
    expect(rotateRes.body.data.url).not.toBe(firstUrl);
  });

  test('Platform Admin can revoke Table A1 QR successfully', async () => {
    // Generate QR
    const genRes = await request(app)
      .post(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send();
    const qrCodeId = genRes.body.data.qrCodeId;

    // Revoke as Admin
    const revokeRes = await request(app)
      .patch(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr/${qrCodeId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    const qrInDb = await RestaurantQrCode.findById(qrCodeId);
    expect(qrInDb.isActive).toBe(false);
  });

  test('Legacy QR (without encryptedToken) returns QR_CREDENTIAL_NOT_RECOVERABLE', async () => {
    // Create legacy QR code in DB manually (no encryptedToken)
    const legacyQr = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: tableA1._id,
      tokenHash: 'legacy_hash_abc_123',
      isActive: true,
      createdBy: ownerUserA._id
    });

    const getRes = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/tables/${tableA1._id}/qr`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(getRes.status).toBe(400);
    expect(getRes.body.success).toBe(false);
    expect(getRes.body.error).toBe('QR_CREDENTIAL_NOT_RECOVERABLE');
  });
});
