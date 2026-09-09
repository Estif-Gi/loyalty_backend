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
const Employee = require('../../model/employee');
const { hashToken } = require('../../services/qrCodeService');
const { SYSTEM_STATES } = require('../../constants/orders');

describe('Restaurant Order History API Tests', () => {
  let customerUser, customerToken;
  let ownerUserA, ownerTokenA;
  let ownerUserB, ownerTokenB;
  let employeeA, employeeTokenA;
  let employeeB, employeeTokenB;
  let restaurantA, restaurantB;
  let tableA, tableB;
  let sessionA;
  let orderCompleted1, orderCompleted2, orderCancelled1, orderActive1;

  beforeAll(async () => {
    await Order.syncIndexes();
  });

  beforeEach(async () => {
    await Order.deleteMany({});
    await OrderSession.deleteMany({});
    await RestaurantQrCode.deleteMany({});
    await RestaurantTable.deleteMany({});
    await Employee.deleteMany({});
    await Restaurant.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    customerUser = await User.create({
      name: 'Customer Charlie',
      phone: '+251911111111',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUserA = await User.create({
      name: 'Owner Alice',
      phone: '+251922222222',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenA = jwt.sign({ id: ownerUserA._id, role: 'owner' }, process.env.JWT_SECRET);

    ownerUserB = await User.create({
      name: 'Owner Bob',
      phone: '+251933333333',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenB = jwt.sign({ id: ownerUserB._id, role: 'owner' }, process.env.JWT_SECRET);

    // 2. Restaurants
    restaurantA = await Restaurant.create({
      name: 'Cafe Roma',
      phone: '+251944444444',
      location: 'Bole',
      owner: ownerUserA._id,
      orderingEnabled: true
    });

    restaurantB = await Restaurant.create({
      name: 'Bistro Paris',
      phone: '+251955555555',
      location: 'Kazanchis',
      owner: ownerUserB._id,
      orderingEnabled: true
    });

    // 3. Employees
    employeeA = await Employee.create({
      name: 'Waiter Sam',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: true
    });
    employeeTokenA = jwt.sign({ id: employeeA._id, role: 'employee' }, process.env.JWT_SECRET);

    employeeB = await Employee.create({
      name: 'Waiter Ben',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantB._id,
      isActive: true
    });
    employeeTokenB = jwt.sign({ id: employeeB._id, role: 'employee' }, process.env.JWT_SECRET);

    // 4. Tables
    tableA = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 1',
      code: 'T1',
      assignedWaiter: employeeA._id,
      isActive: true
    });

    tableB = await RestaurantTable.create({
      restaurant: restaurantB._id,
      name: 'Table 2',
      code: 'T2',
      assignedWaiter: employeeB._id,
      isActive: true
    });

    // QR Code
    const qrCodeA = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: tableA._id,
      tokenHash: hashToken('token_test_rest_history'),
      isActive: true,
      createdBy: ownerUserA._id
    });

    const qrCodeB = await RestaurantQrCode.create({
      restaurant: restaurantB._id,
      table: tableB._id,
      tokenHash: hashToken('token_test_rest_b_history'),
      isActive: true,
      createdBy: ownerUserB._id
    });

    // 5. Sessions
    sessionA = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      qrCode: qrCodeA._id,
      status: 'completed',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    const sessionB = await OrderSession.create({
      customer: customerUser._id,
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

    // Orders for Restaurant A
    // Order 1: Completed (Older)
    orderCompleted1 = await Order.create({
      orderNumber: 'RO-101',
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Espresso', quantity: 2, unitPrice: 50, lineTotal: 100 }],
      pricing: { subtotal: 100, discount: 0, tax: 0, serviceCharge: 0, total: 100, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      idempotencyKey: 'rest-history-1',
      createdAt: new Date('2026-09-01T10:00:00.000Z')
    });

    // Order 2: Completed (Middle)
    orderCompleted2 = await Order.create({
      orderNumber: 'RO-102',
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Cappuccino', quantity: 1, unitPrice: 70, lineTotal: 70 }],
      pricing: { subtotal: 70, discount: 0, tax: 0, serviceCharge: 0, total: 70, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      idempotencyKey: 'rest-history-2',
      createdAt: new Date('2026-09-03T12:00:00.000Z')
    });

    // Order 3: Cancelled (Newer)
    orderCancelled1 = await Order.create({
      orderNumber: 'RO-103',
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Latte', quantity: 1, unitPrice: 80, lineTotal: 80 }],
      pricing: { subtotal: 80, discount: 0, tax: 0, serviceCharge: 0, total: 80, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.CANCELLED,
      cancellation: { reason: 'Guest left', cancelledBy: ownerUserA._id, actorType: 'employee', cancelledAt: new Date('2026-09-05T14:00:00.000Z') },
      idempotencyKey: 'rest-history-3',
      createdAt: new Date('2026-09-05T14:00:00.000Z')
    });

    // Order 4: Active (OPEN)
    orderActive1 = await Order.create({
      orderNumber: 'RO-104',
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'Croissant', quantity: 1, unitPrice: 60, lineTotal: 60 }],
      pricing: { subtotal: 60, discount: 0, tax: 0, serviceCharge: 0, total: 60, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.OPEN,
      idempotencyKey: 'rest-history-4',
      createdAt: new Date('2026-09-07T16:00:00.000Z')
    });

    // Order for Restaurant B
    await Order.create({
      orderNumber: 'RO-B201',
      customer: customerUser._id,
      restaurant: restaurantB._id,
      table: tableB._id,
      orderSession: sessionB._id,
      items: [{ menuItemId: new mongoose.Types.ObjectId(), name: 'French Fries', quantity: 1, unitPrice: 90, lineTotal: 90 }],
      pricing: { subtotal: 90, discount: 0, tax: 0, serviceCharge: 0, total: 90, currency: 'ETB' },
      workflow: defaultWorkflow,
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      idempotencyKey: 'rest-history-b1',
      createdAt: new Date('2026-09-06T10:00:00.000Z')
    });
  });

  test('Owner retrieves restaurant order history (completed & cancelled default, sorted newest-first)', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toBeDefined();
    expect(res.body.data.orders.length).toBe(3);

    // Newest first: RO-103 (Sep 5), RO-102 (Sep 3), RO-101 (Sep 1)
    expect(res.body.data.orders[0].orderNumber).toBe('RO-103');
    expect(res.body.data.orders[1].orderNumber).toBe('RO-102');
    expect(res.body.data.orders[2].orderNumber).toBe('RO-101');

    // Active order RO-104 is NOT included in default history
    const numbers = res.body.data.orders.map((o) => o.orderNumber);
    expect(numbers).not.toContain('RO-104');

    expect(res.body.data.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    });
  });

  test('Pagination works accurately with page and limit', async () => {
    const resPage1 = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?page=1&limit=2`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resPage1.status).toBe(200);
    expect(resPage1.body.data.orders.length).toBe(2);
    expect(resPage1.body.data.orders[0].orderNumber).toBe('RO-103');
    expect(resPage1.body.data.orders[1].orderNumber).toBe('RO-102');
    expect(resPage1.body.data.pagination.totalPages).toBe(2);
    expect(resPage1.body.data.pagination.hasNextPage).toBe(true);

    const resPage2 = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?page=2&limit=2`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resPage2.status).toBe(200);
    expect(resPage2.body.data.orders.length).toBe(1);
    expect(resPage2.body.data.orders[0].orderNumber).toBe('RO-101');
    expect(resPage2.body.data.pagination.hasPrevPage).toBe(true);
    expect(resPage2.body.data.pagination.hasNextPage).toBe(false);
  });

  test('Filter by status (completed, cancelled, active, all)', async () => {
    // Completed
    const resCompleted = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?status=completed`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resCompleted.status).toBe(200);
    expect(resCompleted.body.data.orders.length).toBe(2);
    expect(resCompleted.body.data.orders.every((o) => o.systemState === 'COMPLETED')).toBe(true);

    // Cancelled
    const resCancelled = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?status=cancelled`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resCancelled.status).toBe(200);
    expect(resCancelled.body.data.orders.length).toBe(1);
    expect(resCancelled.body.data.orders[0].orderNumber).toBe('RO-103');

    // Active
    const resActive = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?status=active`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resActive.status).toBe(200);
    expect(resActive.body.data.orders.length).toBe(1);
    expect(resActive.body.data.orders[0].orderNumber).toBe('RO-104');

    // All
    const resAll = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?status=all`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resAll.status).toBe(200);
    expect(resAll.body.data.orders.length).toBe(4);
  });

  test('Date range filtering works as expected', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?startDate=2026-09-02T00:00:00.000Z&endDate=2026-09-04T00:00:00.000Z`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].orderNumber).toBe('RO-102');
  });

  test('Search filtering by orderNumber', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?search=101`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].orderNumber).toBe('RO-101');
  });

  test('Tenant isolation: Owner B cannot view Restaurant A order history', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history`)
      .set('Authorization', `Bearer ${ownerTokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Employee A can view Restaurant A order history; Employee B cannot', async () => {
    // Employee A works at Restaurant A -> allowed
    const resA = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history`)
      .set('Authorization', `Bearer ${employeeTokenA}`);

    expect(resA.status).toBe(200);
    expect(resA.body.data.orders.length).toBe(3);

    // Employee B works at Restaurant B -> denied on Restaurant A
    const resB = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history`)
      .set('Authorization', `Bearer ${employeeTokenB}`);

    expect(resB.status).toBe(403);
    expect(resB.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Customer role is blocked from restaurant order history', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Validation: Rejects invalid restaurant ID and invalid date format', async () => {
    const resId = await request(app)
      .get('/api/restaurants/invalid-id-format/orders/history')
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resId.status).toBe(400);
    expect(resId.body.error).toBe('INVALID_RESTAURANT_ID');

    const resDate = await request(app)
      .get(`/api/restaurants/${restaurantA._id}/orders/history?startDate=not-a-date`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(resDate.status).toBe(400);
    expect(resDate.body.error).toBe('INVALID_DATE_FORMAT');
  });

  test('Accessible via /api/employee/orders/history with restaurantId query param', async () => {
    const res = await request(app)
      .get(`/api/employee/orders/history?restaurantId=${restaurantA._id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(3);
    expect(res.body.data.orders[0].orderNumber).toBe('RO-103');
  });
});
