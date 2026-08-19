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
    // 1. Assign waiter to table
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create order
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

    // 3. Try claiming it
    const claimRes = await request(app)
      .post(`/api/employee/orders/${orderId}/claim`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'preparing' });

    expect(claimRes.status).toBe(410);
    expect(claimRes.body.error).toBe('ORDER_CLAIM_DEPRECATED');
  });

  test('Table-based waiter assignment and auto-advance to preparing', async () => {
    // 1. Assign waiter to table
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create order
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

    // Auto-advance checking: PLACED -> PREPARING
    expect(order.currentStepKey).toBe('preparing');
    expect(order.systemState).toBe('IN_PROGRESS');

    // Timeline preserves both events
    expect(order.timeline.length).toBe(2);
    expect(order.timeline[0].stepKey).toBe('placed');
    expect(order.timeline[0].action).toBe('order_created');
    expect(order.timeline[1].stepKey).toBe('preparing');
    expect(order.timeline[1].action).toBe('auto_started_preparation');
  });

  test('Order creation blocked if table has no assigned waiter', async () => {
    // Table does not have assignedWaiter (default null)
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
    // 1. Assign waiter and set inactive
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
    // 1. Assign Waiter A to table
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create Order #1
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

    // 3. Reassign table to Waiter B
    table.assignedWaiter = waiterB._id;
    await table.save();

    // 4. Verify Order #1 still belongs to Waiter A
    const order1 = await Order.findById(res1.body.data.order.id);
    expect(order1.service.waiter.toString()).toBe(waiterA._id.toString());

    // 5. Create Order #2
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
    // 1. Assign Waiter A to table
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create Order #1 (Assigned to Waiter A)
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

    // 3. Reassign table to Waiter B
    table.assignedWaiter = waiterB._id;
    await table.save();

    // 4. Create Order #2 (Assigned to Waiter B)
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

    // 5. Waiter A retrieves queue -> gets Order #1, not Order #2
    const waiterARes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${waiterAToken}`);
    expect(waiterARes.status).toBe(200);
    expect(waiterARes.body.data.orders.length).toBe(1);
    expect(waiterARes.body.data.orders[0].id).toBe(res1.body.data.order.id);

    // 6. Waiter B retrieves queue -> gets Order #2, not Order #1
    const waiterBRes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${waiterBToken}`);
    expect(waiterBRes.status).toBe(200);
    expect(waiterBRes.body.data.orders.length).toBe(1);
    expect(waiterBRes.body.data.orders[0].id).toBe(res2.body.data.order.id);

    // 7. Chef Gordon retrieves queue -> gets both Order #1 and Order #2 (restaurant-wide)
    const chefRes = await request(app)
      .get('/api/employee/orders?status=active')
      .set('Authorization', `Bearer ${chefToken}`);
    expect(chefRes.status).toBe(200);
    expect(chefRes.body.data.orders.length).toBe(2);
  });

  test('Waiter B blocked from serving Waiter A order', async () => {
    // 1. Assign table to Waiter A
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create order (goes to preparing)
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

    // 3. Chef Gordon advances order preparing -> ready
    const readyRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'preparing' });
    expect(readyRes.status).toBe(200);

    // 4. Waiter B (not assigned) tries to advance ready -> completed (serving)
    const serveRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterBToken}`)
      .send({ expectedStep: 'ready' });

    expect(serveRes.status).toBe(403);
    expect(serveRes.body.error).toBe('ORDER_ASSIGNED_TO_ANOTHER_WAITER');
  });

  test('Waiter A serves own order (ready -> completed) and updates servedAt timeline', async () => {
    // 1. Assign table to Waiter A
    table.assignedWaiter = waiterA._id;
    await table.save();

    // 2. Create order (auto transitions to preparing)
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

    // 3. Chef Gordon advances preparing -> ready
    const readyRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'preparing' });
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.data.order.kitchen.readyBy).toBe(chefEmployee._id.toString());
    expect(readyRes.body.data.order.kitchen.readyAt).not.toBeNull();

    // 4. Waiter A advances ready -> completed
    const serveRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'ready' });

    expect(serveRes.status).toBe(200);
    const updated = serveRes.body.data.order;
    expect(updated.currentStepKey).toBe('completed');
    expect(updated.systemState).toBe('COMPLETED');
    expect(updated.service.servedAt).not.toBeNull();
  });
});
