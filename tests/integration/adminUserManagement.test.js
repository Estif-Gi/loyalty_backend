const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');

describe('Admin User Creation and Role Management Integration Tests', () => {
  let adminUser, adminToken;
  let ownerUser, ownerToken;
  let customerUser, customerToken;

  beforeEach(async () => {
    // 1. Create Admin User & Token
    adminUser = await User.create({
      name: 'System Admin',
      phone: '+251911999888',
      password: 'AdminPassword123!',
      role: 'admin'
    });
    adminToken = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET);

    // 2. Create Owner User & Token
    ownerUser = await User.create({
      name: 'Restaurant Owner',
      phone: '+251911777666',
      password: 'OwnerPassword123!',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // 3. Create Customer User & Token
    customerUser = await User.create({
      name: 'Loyal Customer',
      phone: '+251911555444',
      password: 'CustomerPassword123!',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);
  });

  describe('Option A: Create User by Admin (POST /api/users)', () => {
    test('admin can create a new user with role "owner"', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Owner Abebe',
          phone: '0912345678',
          password: 'SecurePassword123!',
          role: 'owner'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.name).toBe('New Owner Abebe');
      expect(res.body.user.phone).toBe('+251912345678');
      expect(res.body.user.role).toBe('owner');
      expect(res.body.user).not.toHaveProperty('password');

      const dbUser = await User.findById(res.body.user.id);
      expect(dbUser).toBeTruthy();
      expect(dbUser.role).toBe('owner');
      expect(dbUser.phone).toBe('+251912345678');
    });

    test('admin can create a new user with role "admin"', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Co-Admin Sara',
          phone: '0922334455',
          password: 'AdminPassword123!',
          role: 'admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('admin');
    });

    test('defaults to role "owner" if no role is explicitly passed', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Default Role User',
          phone: '0711223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('owner');
      expect(res.body.user.phone).toBe('+251711223344');
    });

    test('enforces Ethiopian phone number validation on admin creation', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Foreign Number Owner',
          phone: '+12025550199',
          password: 'Password123!',
          role: 'owner'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });

    test('rejects creation if phone number is already registered', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate Owner',
          phone: '0911555444', // Matches customerUser's +251911555444
          password: 'Password123!',
          role: 'owner'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('USER_ALREADY_EXISTS');
    });

    test('rejects invalid role specifications', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Hacker Role',
          phone: '0911001122',
          password: 'Password123!',
          role: 'supergod'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ROLE');
    });

    test('rejects non-admin users (e.g. owners) with 403', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Unauthorized Attempt',
          phone: '0911001122',
          password: 'Password123!',
          role: 'owner'
        });

      expect(res.status).toBe(403);
    });

    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({
          name: 'No Token Attempt',
          phone: '0911001122',
          password: 'Password123!',
          role: 'owner'
        });

      expect(res.status).toBe(401);
    });
  });

  describe('Option B: Update User Role by Admin (PATCH /api/users/:id/role)', () => {
    test('admin can promote an existing customer to "owner"', async () => {
      const res = await request(app)
        .patch(`/api/users/${customerUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'owner' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('owner');

      const updatedUser = await User.findById(customerUser._id);
      expect(updatedUser.role).toBe('owner');
    });

    test('admin can promote an existing owner to "admin"', async () => {
      const res = await request(app)
        .patch(`/api/users/${ownerUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');

      const updatedUser = await User.findById(ownerUser._id);
      expect(updatedUser.role).toBe('admin');
    });

    test('admin can demote a user to "customer"', async () => {
      const res = await request(app)
        .patch(`/api/users/${ownerUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'customer' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('customer');
    });

    test('rejects invalid role in role update with 400', async () => {
      const res = await request(app)
        .patch(`/api/users/${customerUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'invalid_role' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ROLE');
    });

    test('returns 404 if user ID does not exist', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .patch(`/api/users/${fakeId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'owner' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('USER_NOT_FOUND');
    });

    test('returns 400 if user ID is malformed', async () => {
      const res = await request(app)
        .patch('/api/users/not-a-valid-id/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'owner' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_USER_ID');
    });

    test('rejects non-admin users (e.g. customers) with 403', async () => {
      const res = await request(app)
        .patch(`/api/users/${customerUser._id}/role`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ role: 'owner' });

      expect(res.status).toBe(403);
    });

    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .patch(`/api/users/${customerUser._id}/role`)
        .send({ role: 'owner' });

      expect(res.status).toBe(401);
    });
  });
});
