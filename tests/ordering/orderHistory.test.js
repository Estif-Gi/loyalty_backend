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
const { SYSTEM_STATES } = require('../../constants/orders');

describe('Customer Order History API Tests', () => {
  let customerA, customerAToken;
  let customerB, customerBToken;
  let ownerUser, ownerToken;
  let employeeUser, employeeToken;
  let restaurantA, restaurantB;
  let tableA, tableB;
  let qrCodeA, qrCodeB;
  let sessionA, sessionB;
  let orderCompleted1, orderCompleted2, orderCancelled1, orderActive1;

  beforeAll(async () => {
    await Order.syncIndexes();
  });

  beforeEach(async () => {
    // Clear collections
    await Order.deleteMany({});
    await OrderSession.deleteMany({});
    await RestaurantQrCode.deleteMany({});
    await RestaurantTable.deleteMany({});
    await Menu.deleteMany({});
    await Employee.deleteMany({});
    await Restaurant.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    customerA = await User.create({
      name: 'Customer Alice',
      phone: '+251911111111',
      password: 'password123',
      role: 'customer'
    });
    customerAToken = jwt.sign({ id: customerA._id, role: 'customer' }, process.env.JWT_SECRET);

    customerB = await User.create({
      name: 'Customer Bob',
      phone: '+251922222222',
      password: 'password123',
      role: 'customer'
    });
    customerBToken = jwt.sign({ id: customerB._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({
      name: 'Owner Dave',
      phone: '+251933333333',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // 2. Restaurants
    restaurantA = await Restaurant.create({
      name: 'Burger Haven',
      phone: '+251944444444',
      location: 'Bole Medhanealem',
      logoURL: 'https://example.com/logo-a.png',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100
    });

    restaurantB = await Restaurant.create({
      name: 'Pizza Piazza',
      phone: '+251955555555',
      location: 'Kazanchis',
      logoURL: 'https://example.com/logo-b.png',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7600, 9.0300] },
      orderingRadiusMeters: 100
    });

    employeeUser = await Employee.create({
      name: 'Waiter Sam',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: true
    });
    employeeToken = jwt.sign({ id: employeeUser._id, role: 'employee' }, process.env.JWT_SECRET);

    // Tables
    tableA = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table A1',
      code: 'TA1',
      assignedWaiter: employeeUser._id,
      isActive: true
    });

    tableB = await RestaurantTable.create({
      restaurant: restaurantB._id,
      name: 'Table B1',
      code: 'TB1',
      isActive: true
    });

    // QR Codes
    qrCodeA = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: tableA._id,
      tokenHash: hashToken('tokenA'),
      isActive: true,
      createdBy: ownerUser._id
    });
    qrCodeB = await RestaurantQrCode.create({
      restaurant: restaurantB._id,
      table: tableB._id,
      tokenHash: hashToken('tokenB'),
      isActive: true,
      createdBy: ownerUser._id
    });

    // Sessions
    sessionA = await OrderSession.create({
      customer: customerA._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      qrCode: qrCodeA._id,
      status: 'completed',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    sessionB = await OrderSession.create({
      customer: customerA._id,
      restaurant: restaurantB._id,
      table: tableB._id,
      qrCode: qrCodeB._id,
      status: 'completed',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    const defaultWorkflow = {
      version: 1,
      steps: [
        { key: 'placed', label: 'Placed', systemState: 'OPEN', order: 1, enabled: true, required: true },
        { key: 'completed', label: 'Completed', systemState: 'COMPLETED', order: 2, enabled: true, required: true }
      ]
    };

    // Create 3 historical orders and 1 active order for Customer A
    // Order 1: Completed at Restaurant A (Older)
    orderCompleted1 = await Order.create({
      orderNumber: 'ORD-101',
      customer: customerA._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Classic Burger', quantity: 2, unitPrice: 200, lineTotal: 400 }],
      pricing: { subtotal: 400, discount: 0, tax: 0, serviceCharge: 0, total: 400, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      timeline: [{ stepKey: 'completed', systemState: 'COMPLETED', actorType: 'employee', actorId: employeeUser._id, action: 'order_completed' }],
      idempotencyKey: 'history-key-1',
      createdAt: new Date('2026-09-01T10:00:00.000Z')
    });

    // Order 2: Completed at Restaurant B (Middle)
    orderCompleted2 = await Order.create({
      orderNumber: 'ORD-102',
      customer: customerA._id,
      restaurant: restaurantB._id,
      table: tableB._id,
      orderSession: sessionB._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Pepperoni Pizza', quantity: 1, unitPrice: 350, lineTotal: 350 }],
      pricing: { subtotal: 350, discount: 0, tax: 0, serviceCharge: 0, total: 350, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      timeline: [{ stepKey: 'completed', systemState: 'COMPLETED', actorType: 'employee', actorId: employeeUser._id, action: 'order_completed' }],
      idempotencyKey: 'history-key-2',
      createdAt: new Date('2026-09-03T12:00:00.000Z')
    });

    // Order 3: Cancelled at Restaurant A (Newest historical)
    orderCancelled1 = await Order.create({
      orderNumber: 'ORD-103',
      customer: customerA._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Soda', quantity: 3, unitPrice: 50, lineTotal: 150 }],
      pricing: { subtotal: 150, discount: 0, tax: 0, serviceCharge: 0, total: 150, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.CANCELLED,
      cancellation: { reason: 'Customer changed mind', cancelledBy: customerA._id, actorType: 'customer', cancelledAt: new Date('2026-09-05T14:00:00.000Z') },
      timeline: [{ stepKey: 'placed', systemState: 'CANCELLED', actorType: 'customer', actorId: customerA._id, action: 'order_cancelled' }],
      idempotencyKey: 'history-key-3',
      createdAt: new Date('2026-09-05T14:00:00.000Z')
    });

    // Order 4: Active order (OPEN) - should NOT be included in default history
    orderActive1 = await Order.create({
      orderNumber: 'ORD-104',
      customer: customerA._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Fries', quantity: 1, unitPrice: 100, lineTotal: 100 }],
      pricing: { subtotal: 100, discount: 0, tax: 0, serviceCharge: 0, total: 100, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.OPEN,
      timeline: [{ stepKey: 'placed', systemState: 'OPEN', actorType: 'customer', actorId: customerA._id, action: 'order_created' }],
      idempotencyKey: 'history-key-4',
      createdAt: new Date('2026-09-07T16:00:00.000Z')
    });

    // Create 1 completed order for Customer B to verify isolation
    await Order.create({
      orderNumber: 'ORD-201',
      customer: customerB._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Customer B Item', quantity: 1, unitPrice: 120, lineTotal: 120 }],
      pricing: { subtotal: 120, discount: 0, tax: 0, serviceCharge: 0, total: 120, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      timeline: [{ stepKey: 'completed', systemState: 'COMPLETED', actorType: 'employee', actorId: employeeUser._id, action: 'order_completed' }],
      idempotencyKey: 'history-key-customer-b',
      createdAt: new Date('2026-09-06T10:00:00.000Z')
    });
  });

  test('Customer receives completed and cancelled orders by default, sorted newest-first', async () => {
    const res = await request(app)
      .get('/api/orders/history')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toBeDefined();
    expect(res.body.data.orders.length).toBe(3);

    // Check order numbers in descending order: ORD-103 (Sep 5), ORD-102 (Sep 3), ORD-101 (Sep 1)
    expect(res.body.data.orders[0].orderNumber).toBe('ORD-103');
    expect(res.body.data.orders[1].orderNumber).toBe('ORD-102');
    expect(res.body.data.orders[2].orderNumber).toBe('ORD-101');

    // Active order ORD-104 is NOT included in history
    const orderNumbers = res.body.data.orders.map((o) => o.orderNumber);
    expect(orderNumbers).not.toContain('ORD-104');

    // Verify timeline is NOT included in order history responses
    for (const order of res.body.data.orders) {
      expect(order.timeline).toBeUndefined();
    }

    // Pagination metadata check
    expect(res.body.data.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    });
  });

  test('Populated restaurant and table details are correctly structured in response', async () => {
    const res = await request(app)
      .get('/api/orders/history')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    const order = res.body.data.orders.find((o) => o.orderNumber === 'ORD-101');
    expect(order).toBeDefined();

    // Verify restaurant object
    expect(order.restaurant).toBeDefined();
    expect(order.restaurant.name).toBe('Burger Haven');
    expect(order.restaurant.location).toBe('Bole Medhanealem');
    expect(order.restaurant.logoURL).toBe('https://example.com/logo-a.png');
    expect(order.restaurant.phone).toBe('+251944444444');

    // Verify table object
    expect(order.table).toBeDefined();
    expect(order.table.name).toBe('Table A1');
    expect(order.table.code).toBe('TA1');
  });

  test('Pagination works accurately with page and limit parameters', async () => {
    // Request page 1 with limit 2
    const resPage1 = await request(app)
      .get('/api/orders/history?page=1&limit=2')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resPage1.status).toBe(200);
    expect(resPage1.body.data.orders.length).toBe(2);
    expect(resPage1.body.data.orders[0].orderNumber).toBe('ORD-103');
    expect(resPage1.body.data.orders[1].orderNumber).toBe('ORD-102');
    expect(resPage1.body.data.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false
    });

    // Request page 2 with limit 2
    const resPage2 = await request(app)
      .get('/api/orders/history?page=2&limit=2')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resPage2.status).toBe(200);
    expect(resPage2.body.data.orders.length).toBe(1);
    expect(resPage2.body.data.orders[0].orderNumber).toBe('ORD-101');
    expect(resPage2.body.data.pagination).toEqual({
      total: 3,
      page: 2,
      limit: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true
    });
  });

  test('Filter by restaurantId returns only orders for that restaurant', async () => {
    const res = await request(app)
      .get(`/api/orders/history?restaurantId=${restaurantB._id}`)
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].orderNumber).toBe('ORD-102');
    expect(res.body.data.orders[0].restaurant.name).toBe('Pizza Piazza');
  });

  test('Filter by specific status works (completed, cancelled, active, all)', async () => {
    // Only completed
    const resCompleted = await request(app)
      .get('/api/orders/history?status=completed')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resCompleted.status).toBe(200);
    expect(resCompleted.body.data.orders.length).toBe(2);
    expect(resCompleted.body.data.orders.every((o) => o.systemState === 'COMPLETED')).toBe(true);

    // Only cancelled
    const resCancelled = await request(app)
      .get('/api/orders/history?status=cancelled')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resCancelled.status).toBe(200);
    expect(resCancelled.body.data.orders.length).toBe(1);
    expect(resCancelled.body.data.orders[0].systemState).toBe('CANCELLED');

    // Only active
    const resActive = await request(app)
      .get('/api/orders/history?status=active')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resActive.status).toBe(200);
    expect(resActive.body.data.orders.length).toBe(1);
    expect(resActive.body.data.orders[0].orderNumber).toBe('ORD-104');
    expect(resActive.body.data.orders[0].systemState).toBe('OPEN');

    // All orders
    const resAll = await request(app)
      .get('/api/orders/history?status=all')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resAll.status).toBe(200);
    expect(resAll.body.data.orders.length).toBe(4);
  });

  test('Date range filtering works as expected', async () => {
    // Orders between 2026-09-02 and 2026-09-04 should only match ORD-102 (Sep 3)
    const res = await request(app)
      .get('/api/orders/history?startDate=2026-09-02T00:00:00.000Z&endDate=2026-09-04T00:00:00.000Z')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].orderNumber).toBe('ORD-102');
  });

  test('Rejects invalid restaurantId and invalid date format with 400', async () => {
    const resInvalidRest = await request(app)
      .get('/api/orders/history?restaurantId=not-a-valid-id')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resInvalidRest.status).toBe(400);
    expect(resInvalidRest.body.error).toBe('INVALID_RESTAURANT_ID');

    const resInvalidDate = await request(app)
      .get('/api/orders/history?startDate=invalid-date')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(resInvalidDate.status).toBe(400);
    expect(resInvalidDate.body.error).toBe('INVALID_DATE_FORMAT');
  });

  test('Tenant isolation: Customer B cannot see Customer A orders', async () => {
    const res = await request(app)
      .get('/api/orders/history')
      .set('Authorization', `Bearer ${customerBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].orderNumber).toBe('ORD-201');
  });

  test('Non-customer roles and unauthenticated requests are blocked', async () => {
    // Unauthenticated
    const resNoToken = await request(app).get('/api/orders/history');
    expect(resNoToken.status).toBe(401);

    // Owner role
    const resOwner = await request(app)
      .get('/api/orders/history')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(resOwner.status).toBe(403);
    expect(resOwner.body.error).toBe('ORDER_ACCESS_DENIED');

    // Employee role
    const resEmployee = await request(app)
      .get('/api/orders/history')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(resEmployee.status).toBe(403);
    expect(resEmployee.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Ascending sorting (sort=asc) returns oldest orders first', async () => {
    const res = await request(app)
      .get('/api/orders/history?sort=asc')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(3);
    expect(res.body.data.orders[0].orderNumber).toBe('ORD-101'); // Oldest
    expect(res.body.data.orders[1].orderNumber).toBe('ORD-102');
    expect(res.body.data.orders[2].orderNumber).toBe('ORD-103'); // Newest
  });
});
