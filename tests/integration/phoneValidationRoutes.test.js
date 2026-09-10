const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');

describe('Ethiopian Phone Validation & Normalization API Integration Tests', () => {
  describe('User Registration (POST /api/users/register)', () => {
    test('accepts valid 09 Ethiopian mobile number and stores it normalized to +2519...', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Abebe Kebede',
          phone: '0911223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');

      const savedUser = await User.findOne({ name: 'Abebe Kebede' });
      expect(savedUser).toBeTruthy();
      expect(savedUser.phone).toBe('+251911223344');
    });

    test('accepts valid 07 Safaricom Ethiopian mobile number and stores it normalized to +2517...', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Chala Safaricom',
          phone: '0711223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');

      const savedUser = await User.findOne({ name: 'Chala Safaricom' });
      expect(savedUser).toBeTruthy();
      expect(savedUser.phone).toBe('+251711223344');
    });

    test('accepts valid international +2519... format', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Almaz Intl',
          phone: '+251922334455',
          password: 'Password123!'
        });

      expect(res.status).toBe(201);
      const savedUser = await User.findOne({ name: 'Almaz Intl' });
      expect(savedUser.phone).toBe('+251922334455');
    });

    test('accepts formatted Ethiopian number with spaces and dashes', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Formatted User',
          phone: '+251 93 344 5566',
          password: 'Password123!'
        });

      expect(res.status).toBe(201);
      const savedUser = await User.findOne({ name: 'Formatted User' });
      expect(savedUser.phone).toBe('+251933445566');
    });

    test('rejects non-Ethiopian international numbers (e.g. USA +1...) with 400', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'US User',
          phone: '+12025550123',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
      expect(res.body.message).toContain('Only Ethiopian phone numbers are accepted');
    });

    test('rejects non-Ethiopian regional numbers (e.g. Kenya +254...) with 400', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Kenya User',
          phone: '+254712345678',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });

    test('rejects invalid domestic prefixes (e.g. 08..., 06...) with 400', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Bad Prefix User',
          phone: '0811223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });

    test('rejects invalid length numbers with 400', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'Short Phone User',
          phone: '091122',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });

    test('rejects missing or empty phone numbers with 400', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          name: 'No Phone User',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('PHONE_NUMBER_REQUIRED');
    });
  });

  describe('User Login (POST /api/users/login)', () => {
    beforeEach(async () => {
      // Register a user with standard domestic 09 format
      await request(app)
        .post('/api/users/register')
        .send({
          name: 'Login Test User',
          phone: '0911223344',
          password: 'Password123!'
        });
    });

    test('allows login using the same domestic format (0911223344)', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          phone: '0911223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.name).toBe('Login Test User');
    });

    test('allows login using international format (+251911223344) interchangeably', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          phone: '+251911223344',
          password: 'Password123!'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.name).toBe('Login Test User');
    });

    test('allows login using formatted phone with spaces (+251 91 122 3344)', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          phone: '+251 91 122 3344',
          password: 'Password123!'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    test('fails login with invalid credentials', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          phone: '0911223344',
          password: 'WrongPassword'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid credentials');
    });
  });

  describe('Restaurant Phone Validation (POST /api/restaurants)', () => {
    let ownerToken, ownerUser;

    beforeEach(async () => {
      ownerUser = await User.create({
        name: 'Rest Owner',
        phone: '+251911998877',
        password: 'Password123!',
        role: 'owner'
      });
      ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);
    });

    test('accepts valid Ethiopian mobile phone for restaurant and normalizes it', async () => {
      const res = await request(app)
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Habesha Cafe',
          phone: '0911556677',
          location: 'Bole, Addis Ababa'
        });

      expect(res.status).toBe(201);
      expect(res.body.phone).toBe('+251911556677');
    });

    test('accepts valid Ethiopian landline for restaurant', async () => {
      const res = await request(app)
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Addis Dine',
          phone: '0115512233',
          location: 'Piazza, Addis Ababa'
        });

      expect(res.status).toBe(201);
      expect(res.body.phone).toBe('+251115512233');
    });

    test('rejects non-Ethiopian restaurant phone number with 400', async () => {
      const res = await request(app)
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Foreign Phone Rest',
          phone: '+14155552671',
          location: 'Addis Ababa'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });
  });

  describe('Mongoose Schema Validation direct enforcement', () => {
    test('throws ValidationError when saving user with non-Ethiopian phone', async () => {
      await expect(
        User.create({
          name: 'Direct Invalid User',
          phone: '+12025550199',
          password: 'Password123!'
        })
      ).rejects.toThrow();
    });

    test('automatically normalizes phone on direct User.create', async () => {
      const user = await User.create({
        name: 'Direct User',
        phone: '0911002233',
        password: 'Password123!'
      });

      expect(user.phone).toBe('+251911002233');
    });
  });
});
