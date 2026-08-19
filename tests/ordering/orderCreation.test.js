const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const RestaurantTable = require('../../model/restaurantTable');
const RestaurantQrCode = require('../../model/restaurantQrCode');
const OrderSession = require('../../model/orderSession');
const Order = require('../../model/order');
const Menu = require('../../model/menu');
const Employee = require('../../model/employee');
const { hashToken } = require('../../services/qrCodeService');

describe('Order Creation Integration Checks', () => {
  let customerUser, customerToken;
  let ownerUser, ownerToken;
  let restaurant, table, qrCode, menu, session;
  const rawQrToken = 'raw_qr_token_creation_test';
  let mockMenuItemId;

  beforeEach(async () => {
    await Order.syncIndexes();

    customerUser = await User.create({
      name: 'Customer Bob',
      phone: '+251910000001',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({
      name: 'Owner Jim',
      phone: '+251910000002',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    restaurant = await Restaurant.create({
      name: 'Creation Cafe',
      phone: '+251920000003',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['chef'] },
        { key: 'preparing', label: 'Cooking', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['chef'] },
        { key: 'completed', label: 'Done', systemState: 'COMPLETED', enabled: true, required: true, order: 3, actionRoles: ['cashier'] }
      ]
    });

    table = await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Table 3',
      code: 'T3',
      isActive: true
    });

    qrCode = await RestaurantQrCode.create({
      restaurant: restaurant._id,
      table: table._id,
      tokenHash: hashToken(rawQrToken),
      isActive: true,
      createdBy: ownerUser._id
    });

    menu = await Menu.create({
      restaurant: restaurant._id,
      items: [
        { name: 'Double Burger', price: 250, category: 'Mains' },
        { name: 'Fries', price: 100, category: 'Sides' }
      ]
    });
    mockMenuItemId = menu.items[0]._id;

    session = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurant._id,
      table: table._id,
      qrCode: qrCode._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    const waiter = await Employee.create({
      name: 'Waiter Hana',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurant._id,
      isActive: true
    });
    table.assignedWaiter = waiter._id;
    await table.save();
  });

  test('Create order successfully with correct pricing and snapshot', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'unique-idempotency-key-1')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 2, notes: 'Extra cheese' }],
        customerNotes: 'Deliver fast please'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.orderNumber).toMatch(/ORD-\d+/);
    expect(res.body.data.order.pricing.total).toBe(500); // 250 * 2

    // Verify coordinates are excluded from serializations (Privacy Guard)
    expect(res.body.data.order.customerExactLocation).toBeUndefined();

    // Verify snapshotting workflow in DB
    const savedOrder = await Order.findById(res.body.data.order.id);
    expect(savedOrder.workflow.version).toBe(1);
    expect(savedOrder.workflow.steps.length).toBe(3);
    expect(savedOrder.currentStepKey).toBe('placed');
  });

  test('Idempotent submissions return cached order without duplicates', async () => {
    const payload = {
      orderSessionId: session._id,
      location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
      items: [{ menuItemId: mockMenuItemId, quantity: 1 }],
      customerNotes: 'Double tap test'
    };

    const run1 = request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'idempotency-double-tap')
      .send(payload);

    const run2 = request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'idempotency-double-tap')
      .send(payload);

    const [res1, res2] = await Promise.all([run1, run2]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201); // Both return success
    expect(res1.body.data.order.id).toBe(res2.body.data.order.id);

    // Verify only ONE order exists in the DB
    const count = await Order.countDocuments({ customer: customerUser._id });
    expect(count).toBe(1);
  });

  test('Reject order if session is expired', async () => {
    session.expiresAt = new Date(Date.now() - 5000);
    await session.save();

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'expired-key-1')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDER_SESSION_INVALID');
  });

  test('Reject order if physical geofence check fails', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'geofence-fail-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0900, longitude: 38.7500, accuracy: 15 }, // Far away
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_LOCATION_VERIFICATION_FAILED');
  });

  test('Reject order if item belongs to another restaurant', async () => {
    // Create other restaurant menu item
    const otherMenu = await Menu.create({
      restaurant: new mongoose.Types.ObjectId(),
      items: [{ name: 'Foreign Pizza', price: 400, category: 'Mains' }]
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'foreign-item-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: otherMenu.items[0]._id, quantity: 1 }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MENU_ITEM_RESTAURANT_MISMATCH');
  });

  test('Reject order if quantity is invalid', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'invalid-qty-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: -2 }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ORDER_QUANTITY');
  });
});
