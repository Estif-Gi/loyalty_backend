const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');

describe('Restaurant Owner Login Billing Information Tests', () => {
  let ownerUser;
  let testRestaurant;
  const rawPassword = 'Password123!';

  beforeEach(async () => {
    await Restaurant.deleteMany({});
    await User.deleteMany({});

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    ownerUser = await User.create({
      name: 'Test Owner',
      phone: '+251911998877',
      password: hashedPassword,
      role: 'owner'
    });

    testRestaurant = await Restaurant.create({
      name: 'Sunset Bistro',
      phone: '+251911223344',
      owner: ownerUser._id,
      billingStatus: 'trustworthy',
      billingUpdatedAt: new Date('2026-10-01T12:00:00Z')
    });
  });

  test('includes billingStatus, billingUpdatedAt, and restaurantId when restaurant owner logs in', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({
        phone: '0911998877',
        password: rawPassword
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.restaurantId).toBe(testRestaurant._id.toString());
    expect(res.body.user.billingStatus).toBe('trustworthy');
    expect(new Date(res.body.user.billingUpdatedAt).toISOString()).toBe(testRestaurant.billingUpdatedAt.toISOString());
  });

  test('falls back to default free tier when owner has no restaurant created yet', async () => {
    await Restaurant.deleteMany({});

    const res = await request(app)
      .post('/api/users/login')
      .send({
        phone: '+251911998877',
        password: rawPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.restaurantId).toBeNull();
    expect(res.body.user.billingStatus).toBe('free');
    expect(res.body.user.billingUpdatedAt).toBeNull();
  });

  test('does not include restaurant billing information when a customer logs in', async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    await User.create({
      name: 'Regular Customer',
      phone: '+251922334455',
      password: hashedPassword,
      role: 'customer'
    });

    const res = await request(app)
      .post('/api/users/login')
      .send({
        phone: '0922334455',
        password: rawPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('customer');
    expect(res.body.user.billingStatus).toBeUndefined();
    expect(res.body.user.restaurantId).toBeUndefined();
  });

  test('includes billingStatus and billingUpdatedAt in GET /api/users/profile for owners', async () => {
    const loginRes = await request(app)
      .post('/api/users/login')
      .send({
        phone: '0911998877',
        password: rawPassword
      });

    const token = loginRes.body.token;

    const profileRes = await request(app)
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.role).toBe('owner');
    expect(profileRes.body.restaurantId.toString()).toBe(testRestaurant._id.toString());
    expect(profileRes.body.billingStatus).toBe('trustworthy');
    expect(new Date(profileRes.body.billingUpdatedAt).toISOString()).toBe(testRestaurant.billingUpdatedAt.toISOString());
  });
});
