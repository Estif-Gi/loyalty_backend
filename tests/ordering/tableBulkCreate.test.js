const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const RestaurantTable = require('../../model/restaurantTable');

describe('Bulk Table Creation Integration Checks', () => {
  let ownerUser, ownerToken;
  let customerUser, customerToken;
  let otherOwnerUser, otherOwnerToken;
  let restaurant;

  beforeEach(async () => {
    ownerUser = await User.create({
      name: 'Owner Jim',
      phone: '+251910000002',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    customerUser = await User.create({
      name: 'Customer Bob',
      phone: '+251910000001',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    otherOwnerUser = await User.create({
      name: 'Owner Sally',
      phone: '+251910000003',
      password: 'password123',
      role: 'owner'
    });
    otherOwnerToken = jwt.sign({ id: otherOwnerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    restaurant = await Restaurant.create({
      name: 'Creation Cafe',
      phone: '+251920000003',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['chef'] },
        { key: 'completed', label: 'Done', systemState: 'COMPLETED', enabled: true, required: true, order: 2, actionRoles: ['cashier'] }
      ]
    });
  });

  test('Create tables successfully using custom tables array', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tables: [
          { name: 'Table A1', code: 'TA1', description: 'Near window' },
          { name: 'Table A2', code: 'TA2' }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);

    expect(res.body.data[0].name).toBe('Table A1');
    expect(res.body.data[0].code).toBe('TA1');
    expect(res.body.data[0].description).toBe('Near window');

    expect(res.body.data[1].name).toBe('Table A2');
    expect(res.body.data[1].code).toBe('TA2');
    expect(res.body.data[1].description).toBeNull();

    // Verify they are saved in MongoDB
    const count = await RestaurantTable.countDocuments({ restaurant: restaurant._id });
    expect(count).toBe(2);
  });

  test('Create tables successfully using auto-generator config', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        count: 5,
        prefix: 'T-',
        startNumber: 10,
        description: 'Auto generated'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(5);

    expect(res.body.data[0].name).toBe('T-10');
    expect(res.body.data[0].code).toBe('T-10');
    expect(res.body.data[0].description).toBe('Auto generated');

    expect(res.body.data[4].name).toBe('T-14');
    expect(res.body.data[4].code).toBe('T-14');

    const count = await RestaurantTable.countDocuments({ restaurant: restaurant._id });
    expect(count).toBe(5);
  });

  test('Create tables successfully using default generator configuration when prefix/startNumber are omitted', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        count: 3
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(3);

    expect(res.body.data[0].name).toBe('Table 1');
    expect(res.body.data[0].code).toBe('TABLE 1');

    expect(res.body.data[2].name).toBe('Table 3');
    expect(res.body.data[2].code).toBe('TABLE 3');
  });

  test('Reject request if both tables and count are missing', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BULK_CREATE_INPUT');
  });

  test('Reject request if tables array has invalid items', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tables: [
          { name: 'Table A1', code: '' }, // invalid code
          { name: '', code: 'TA2' } // invalid name
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TABLE_CODE'); // First invalid item in list lacks code, validator stops on it
  });

  test('Reject request if count is negative or zero', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        count: -1
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_COUNT');
  });

  test('Reject request if count exceeds 100', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        count: 101
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BULK_CREATE_LIMIT_EXCEEDED');
  });

  test('Reject request if there are duplicate codes in the payload', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tables: [
          { name: 'Table A1', code: 'T1' },
          { name: 'Table A2', code: 'T1' } // Duplicate code
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DUPLICATE_CODES_IN_BATCH');
  });

  test('Reject request if a generated/provided code already exists in DB', async () => {
    // Create an existing table first
    await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Existing Table',
      code: 'TABLE 2',
      isActive: true
    });

    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        count: 3 // This generates codes: TABLE 1, TABLE 2, TABLE 3. TABLE 2 will conflict.
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TABLE_CODES_ALREADY_EXIST');
    expect(res.body.details.existingCodes).toContain('TABLE 2');
  });

  test('Reject request if non-owner tries to bulk-create tables', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        count: 3
      });

    expect(res.status).toBe(403);
  });

  test('Reject request if owner of another restaurant tries to bulk-create tables', async () => {
    const res = await request(app)
      .post(`/api/restaurants/${restaurant._id}/tables/bulk`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({
        count: 3
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TABLE_RESTAURANT_ACCESS_DENIED');
  });
});
