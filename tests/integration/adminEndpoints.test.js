const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const Employee = require('../../model/employee');
const Menu = require('../../model/menu');
const Order = require('../../model/order');
const AdminAudit = require('../../model/adminAudit');

describe('Admin API Endpoints Integration Tests', () => {
  let adminUser, adminToken;
  let ownerUser, ownerToken;
  let customerUser, customerToken;

  beforeEach(async () => {
    // 1. Admin User & Token
    adminUser = await User.create({
      name: 'Super Admin',
      phone: '+251911000111',
      password: 'AdminPassword123!',
      role: 'admin'
    });
    adminToken = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET);

    // 2. Owner User & Token
    ownerUser = await User.create({
      name: 'Existing Owner',
      phone: '+251911000222',
      password: 'OwnerPassword123!',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // 3. Customer User & Token
    customerUser = await User.create({
      name: 'Regular Customer',
      phone: '+251911000333',
      password: 'CustomerPassword123!',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);
  });

  describe('POST /api/admin/restaurants (Create Owner + Restaurant)', () => {
    test('admin can create owner account and restaurant in one atomic operation', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          owner: {
            name: 'Abebe Bikila',
            phone: '0912001122',
            password: 'SecurePassword123!'
          },
          restaurant: {
            name: 'Lucy Traditional Restaurant',
            phone: '0115501122',
            location: 'Bole Medhanialem, Addis Ababa',
            themeColor: '#7A4B2A',
            billingStatus: 'loyal'
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restaurant).toBeDefined();
      expect(res.body.data.owner).toBeDefined();

      // Owner verification
      expect(res.body.data.owner.name).toBe('Abebe Bikila');
      expect(res.body.data.owner.phone).toBe('+251912001122');
      expect(res.body.data.owner.role).toBe('owner');
      expect(res.body.data.owner).not.toHaveProperty('password');

      // Restaurant verification
      expect(res.body.data.restaurant.name).toBe('Lucy Traditional Restaurant');
      expect(res.body.data.restaurant.phone).toBe('+251115501122');
      expect(res.body.data.restaurant.billingStatus).toBe('loyal');

      // Check DB
      const dbOwner = await User.findById(res.body.data.owner.id);
      expect(dbOwner).toBeTruthy();
      expect(dbOwner.role).toBe('owner');

      const dbRes = await Restaurant.findById(res.body.data.restaurant.id);
      expect(dbRes).toBeTruthy();
      expect(dbRes.owner.toString()).toBe(dbOwner._id.toString());
      expect(dbRes.billingStatus).toBe('loyal');

      // Check audit log
      const auditLogs = await AdminAudit.find({ restaurantId: dbRes._id });
      expect(auditLogs.length).toBeGreaterThanOrEqual(2);
    });

    test('defaults billingStatus to "free" if not specified', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          owner: {
            name: 'Derartu Tulu',
            phone: '0913112233',
            password: 'Password123!'
          },
          restaurant: {
            name: 'Bole Cafe'
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.data.restaurant.billingStatus).toBe('free');
    });

    test('rejects duplicate owner phone number', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          owner: {
            name: 'Duplicate Owner',
            phone: '0911000222', // Matches existing ownerUser (+251911000222)
            password: 'Password123!'
          },
          restaurant: {
            name: 'Duplicate Place'
          }
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('USER_ALREADY_EXISTS');
    });

    test('rejects invalid Ethiopian phone format for owner', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          owner: {
            name: 'Invalid Phone Owner',
            phone: '12345',
            password: 'Password123!'
          },
          restaurant: {
            name: 'Test Cafe'
          }
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ETHIOPIAN_PHONE_NUMBER');
    });

    test('rejects invalid billing tier', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          owner: {
            name: 'Valid Owner',
            phone: '0914556677',
            password: 'Password123!'
          },
          restaurant: {
            name: 'Super Place',
            billingStatus: 'platinum_vip'
          }
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_BILLING_TIER');
    });

    test('rejects non-admin (owner) with 403', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          owner: { name: 'Owner', phone: '0914556677', password: 'Password123!' },
          restaurant: { name: 'New Restaurant' }
        });

      expect(res.status).toBe(403);
    });

    test('rejects non-admin (customer) with 403', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          owner: { name: 'Owner', phone: '0914556677', password: 'Password123!' },
          restaurant: { name: 'New Restaurant' }
        });

      expect(res.status).toBe(403);
    });

    test('rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/admin/restaurants')
        .send({
          owner: { name: 'Owner', phone: '0914556677', password: 'Password123!' },
          restaurant: { name: 'New Restaurant' }
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/restaurants (List with search & filter)', () => {
    let testRestaurant;

    beforeEach(async () => {
      testRestaurant = await Restaurant.create({
        name: 'Habesha Delight',
        phone: '+251911444555',
        location: 'Kazanchis, Addis Ababa',
        owner: ownerUser._id,
        billingStatus: 'trustworthy',
        orderingEnabled: true
      });
    });

    test('admin can list restaurants with pagination metadata', async () => {
      const res = await request(app)
        .get('/api/admin/restaurants?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.restaurants)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(1);

      // Verify passwords never appear
      const found = res.body.data.restaurants.find(r => r.id === testRestaurant._id.toString());
      expect(found).toBeDefined();
      expect(found.owner).not.toHaveProperty('password');
      expect(found.billingStatus).toBe('trustworthy');
    });

    test('supports searching by restaurant name', async () => {
      const res = await request(app)
        .get('/api/admin/restaurants?search=Habesha')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.restaurants.some(r => r.name.includes('Habesha'))).toBe(true);
    });

    test('supports filtering by billing tier', async () => {
      const res = await request(app)
        .get('/api/admin/restaurants?billingStatus=trustworthy')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.restaurants.every(r => r.billingStatus === 'trustworthy')).toBe(true);
    });
  });

  describe('GET /api/admin/restaurants/:id (Details, Usage & Limits)', () => {
    let testRestaurant;

    beforeEach(async () => {
      testRestaurant = await Restaurant.create({
        name: 'Gusto Italian',
        phone: '+251911333222',
        location: 'Old Airport, Addis Ababa',
        owner: ownerUser._id,
        billingStatus: 'loyal',
        orderingEnabled: true
      });

      // Add a couple of staff
      await Employee.create({
        name: 'Waiter John',
        restaurant: testRestaurant._id,
        password: 'Password123!',
        role: 'waiter',
        isActive: true
      });

      // Add a menu item
      await Menu.create({
        restaurant: testRestaurant._id,
        items: [{ name: 'Margherita Pizza', price: 350, category: 'Mains' }]
      });
    });

    test('returns detailed view with owner, tier limits, and live usage', async () => {
      const res = await request(app)
        .get(`/api/admin/restaurants/${testRestaurant._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restaurant.name).toBe('Gusto Italian');
      expect(res.body.data.owner.name).toBe('Existing Owner');
      expect(res.body.data.owner).not.toHaveProperty('password');

      // Check billing limits for 'loyal' tier
      expect(res.body.data.billing.tier).toBe('loyal');
      expect(res.body.data.billing.limits.staff).toBe(4);
      expect(res.body.data.billing.limits.customers).toBe(100);
      expect(res.body.data.billing.limits.menuItems).toBe(100);

      // Check live usage
      expect(res.body.data.billing.usage.staff).toBe(1);
      expect(res.body.data.billing.usage.menuItems).toBe(1);
    });

    test('returns 404 for non-existent restaurant ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .get(`/api/admin/restaurants/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RESTAURANT_NOT_FOUND');
    });
  });

  describe('PATCH /api/admin/restaurants/:id/billing (Update Tier)', () => {
    let testRestaurant;

    beforeEach(async () => {
      testRestaurant = await Restaurant.create({
        name: 'Tier Change Test Cafe',
        owner: ownerUser._id,
        billingStatus: 'free'
      });
    });

    test('admin can update restaurant billing tier', async () => {
      const res = await request(app)
        .patch(`/api/admin/restaurants/${testRestaurant._id}/billing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          billingStatus: 'trustworthy',
          billingNote: 'Upgraded to trustworthy plan'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.billingStatus).toBe('trustworthy');

      const updated = await Restaurant.findById(testRestaurant._id);
      expect(updated.billingStatus).toBe('trustworthy');
      expect(updated.billingUpdatedBy.toString()).toBe(adminUser._id.toString());
      expect(updated.billingNote).toBe('Upgraded to trustworthy plan');

      // Verify audit trail
      const audit = await AdminAudit.findOne({
        restaurantId: testRestaurant._id,
        action: 'BILLING_TIER_CHANGED'
      });
      expect(audit).toBeTruthy();
      expect(audit.oldValue.billingStatus).toBe('free');
      expect(audit.newValue.billingStatus).toBe('trustworthy');
    });

    test('rejects invalid tier update', async () => {
      const res = await request(app)
        .patch(`/api/admin/restaurants/${testRestaurant._id}/billing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          billingStatus: 'mythical_tier'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_BILLING_TIER');
    });

    test('restaurant owner cannot change billingStatus via owner PATCH /api/restaurants/:id', async () => {
      const res = await request(app)
        .patch(`/api/restaurants/${testRestaurant._id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          billingStatus: 'faithful'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BILLING_STATUS_NOT_OWNER_EDITABLE');
    });
  });

  describe('GET /api/admin/dashboard/summary & /api/admin/billing/plans', () => {
    test('returns dashboard aggregation with actual database metrics', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restaurants).toBeDefined();
      expect(res.body.data.restaurants).toHaveProperty('total');
      expect(res.body.data.restaurants).toHaveProperty('free');
      expect(res.body.data.restaurants).toHaveProperty('loyal');
      expect(res.body.data.restaurants).toHaveProperty('trustworthy');
      expect(res.body.data.restaurants).toHaveProperty('faithful');
      expect(res.body.data).toHaveProperty('customers');
      expect(res.body.data).toHaveProperty('employees');
      expect(res.body.data.orders).toHaveProperty('total');
      expect(res.body.data.orders).toHaveProperty('today');
    });

    test('returns all four system billing plans and limits', async () => {
      const res = await request(app)
        .get('/api/admin/billing/plans')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(4);

      const freePlan = res.body.data.find(p => p.tier === 'free');
      expect(freePlan.limits.staff).toBe(2);
      expect(freePlan.limits.customers).toBe(50);

      const faithfulPlan = res.body.data.find(p => p.tier === 'faithful');
      expect(faithfulPlan.limits.customers).toBe('unlimited');
    });
  });
});
