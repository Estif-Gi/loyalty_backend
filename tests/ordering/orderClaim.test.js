const request = require('supertest');
const jwt = require('jsonwebtoken');
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

describe('Order Table Assignment and Operational Workflow Integration Tests', () => {
  let customerUser, customerToken;
  let ownerUser, ownerToken;
  let waiterA, waiterAToken;
  let waiterB, waiterBToken;
  let chefEmployee, chefToken;
  let restaurant, table, qrCode, menu, session;
  const rawQrToken = 'raw_qr_claim_test';
  let mockMenuItemId;

  beforeEach(async () => {
    await Order.syncIndexes();

    customerUser = await User.create({
      name: 'Claim Customer',
      phone: '+251910000007',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({
      name: 'Claim Owner',
      phone: '+251910000008',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    restaurant = await Restaurant.create({
      name: 'Claim Cafe',
      phone: '+251920000006',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100
    });

    table = await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Table 11',
      code: 'T11',
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
      items: [{ name: 'Espresso', price: 60, category: 'Drinks' }]
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

    waiterA = await Employee.create({
      name: 'Waiter A',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurant._id,
      isActive: true
    });
    waiterAToken = jwt.sign({ id: waiterA._id, role: 'employee' }, process.env.JWT_SECRET);

    waiterB = await Employee.create({
      name: 'Waiter B',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurant._id,
      isActive: true
    });
    waiterBToken = jwt.sign({ id: waiterB._id, role: 'employee' }, process.env.JWT_SECRET);

    chefEmployee = await Employee.create({
      name: 'Chef Gordon',
      password: 'password123',
      role: 'chef',
      restaurant: restaurant._id,
      isActive: true
    });
    chefToken = jwt.sign({ id: chefEmployee._id, role: 'employee' }, process.env.JWT_SECRET);
  });

  test('Waiter claim endpoint returns 410 Gone / Deprecated', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'claim-depr-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    const claimRes = await request(app)
      .post(`/api/employee/orders/${orderId}/claim`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    expect(claimRes.status).toBe(410);
    expect(claimRes.body.error).toBe('ORDER_CLAIM_DEPRECATED');
  });

  test('Table-based waiter assignment and initial PLACED state with order_created timeline', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'auto-assign-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(createRes.status).toBe(201);
    const order = createRes.body.data.order;

    // Waiter auto snapshot
    expect(order.service.waiter).toBe(waiterA._id.toString());
    expect(order.service.assignmentSource).toBe('table');

    // Initial state: PLACED / OPEN (no auto advance to preparing)
    expect(order.currentStepKey).toBe('placed');
    expect(order.systemState).toBe('OPEN');

    // Timeline has single order_created event
    expect(order.timeline.length).toBe(1);
    expect(order.timeline[0].stepKey).toBe('placed');
    expect(order.timeline[0].action).toBe('order_created');
  });

  test('Order creation blocked if table has no assigned waiter', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'no-waiter-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(createRes.status).toBe(409);
    expect(createRes.body.error).toBe('TABLE_WAITER_NOT_ASSIGNED');
  });

  test('Order creation blocked if assigned waiter is inactive', async () => {
    waiterA.isActive = false;
    await waiterA.save();

    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'inactive-waiter-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(createRes.status).toBe(409);
    expect(createRes.body.error).toBe('TABLE_WAITER_UNAVAILABLE');
  });

  test('Waiter assignment is historical and table re-assignments affect only new orders', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'hist-order-1')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(res1.status).toBe(201);
    expect(res1.body.data.order.service.waiter).toBe(waiterA._id.toString());

    table.assignedWaiter = waiterB._id;
    await table.save();

    const order1 = await Order.findById(res1.body.data.order.id);
    expect(order1.service.waiter.toString()).toBe(waiterA._id.toString());

    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'hist-order-2')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(res2.status).toBe(201);
    expect(res2.body.data.order.service.waiter).toBe(waiterB._id.toString());
  });

  test('Waiter queue returns only assigned orders while Chef queue is restaurant-wide', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'queue-order-1')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(res1.status).toBe(201);

    table.assignedWaiter = waiterB._id;
    await table.save();

    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'queue-order-2')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(res2.status).toBe(201);

    const waiterARes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${waiterAToken}`);
    expect(waiterARes.status).toBe(200);
    expect(waiterARes.body.data.orders.length).toBe(1);
    expect(waiterARes.body.data.orders[0].id).toBe(res1.body.data.order.id);

    const waiterBRes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${waiterBToken}`);
    expect(waiterBRes.status).toBe(200);
    expect(waiterBRes.body.data.orders.length).toBe(1);
    expect(waiterBRes.body.data.orders[0].id).toBe(res2.body.data.order.id);

    // Chef Gordon retrieves queue -> gets both Order #1 and Order #2 (restaurant-wide visibility)
    const chefRes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${chefToken}`);
    expect(chefRes.status).toBe(200);
    expect(chefRes.body.data.orders.length).toBe(2);
  });

  test('Waiter B blocked from serving Waiter A order (placed -> served and served -> completed)', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'wrong-waiter-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    // 1. Waiter B (not assigned) tries to advance placed -> served
    const serveRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterBToken}`)
      .send({ expectedStep: 'placed' });

    expect(serveRes.status).toBe(403);
    expect(serveRes.body.error).toBe('ORDER_ASSIGNED_TO_ANOTHER_WAITER');

    // 2. Waiter A advances placed -> served
    const waiterAServeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });
    expect(waiterAServeRes.status).toBe(200);

    // 3. Waiter B tries to complete Waiter A's order (served -> completed)
    const completeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterBToken}`)
      .send({ expectedStep: 'served' });

    expect(completeRes.status).toBe(403);
    expect(completeRes.body.error).toBe('ORDER_ASSIGNED_TO_ANOTHER_WAITER');
  });

  test('Waiter A serves own order (placed -> served -> completed) and updates servedAt', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'serve-correct-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    // 1. Waiter A advances placed -> served
    const serveRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    expect(serveRes.status).toBe(200);
    expect(serveRes.body.data.order.currentStepKey).toBe('served');
    expect(serveRes.body.data.order.systemState).toBe('IN_PROGRESS');
    expect(serveRes.body.data.order.service.servedAt).not.toBeNull();

    // 2. Waiter A advances served -> completed
    const completeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'served' });

    expect(completeRes.status).toBe(200);
    const updated = completeRes.body.data.order;
    expect(updated.currentStepKey).toBe('completed');
    expect(updated.systemState).toBe('COMPLETED');
    expect(updated.service.servedAt).not.toBeNull();
  });

  test('Waiter A completes order while unpaid (payment.status remains unpaid and independent)', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'unpaid-complete-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    // Verify order starts as unpaid
    expect(createRes.body.data.order.payment.status).toBe('unpaid');

    // 1. Waiter A advances placed -> served
    await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    // 2. Waiter A completes order served -> completed while still unpaid
    const completeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'served' });

    expect(completeRes.status).toBe(200);
    const completedOrder = completeRes.body.data.order;
    expect(completedOrder.currentStepKey).toBe('completed');
    expect(completedOrder.systemState).toBe('COMPLETED');
    // Crucial: payment status MUST remain unpaid
    expect(completedOrder.payment.status).toBe('unpaid');

    const dbOrder = await Order.findById(orderId);
    expect(dbOrder.systemState).toBe('COMPLETED');
    expect(dbOrder.payment.status).toBe('unpaid');
  });

  test('Paying does not automatically advance operational workflow state', async () => {
    table.assignedWaiter = waiterA._id;
    await table.save();

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'payment-mutation-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    // Mutate payment to paid
    const order = await Order.findById(orderId);
    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    await order.save();

    // Verify operational workflow state remains placed / OPEN
    const updatedDbOrder = await Order.findById(orderId);
    expect(updatedDbOrder.payment.status).toBe('paid');
    expect(updatedDbOrder.currentStepKey).toBe('placed');
    expect(updatedDbOrder.systemState).toBe('OPEN');
  });
});
