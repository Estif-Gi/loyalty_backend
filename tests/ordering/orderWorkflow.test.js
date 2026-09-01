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

describe('Order Workflow Transition and Isolation Tests', () => {
  let customerUser, customerToken;
  let ownerUser;
  let chefEmployee, chefToken;
  let waiterEmployee, waiterToken;
  let restaurant, table, qrCode, menu, session;
  const rawQrToken = 'raw_qr_workflow_test';
  let mockMenuItemId;

  beforeEach(async () => {
    await Order.syncIndexes();

    customerUser = await User.create({
      name: 'Workflow Customer',
      phone: '+251910000005',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({
      name: 'Workflow Owner',
      phone: '+251910000006',
      password: 'password123',
      role: 'owner'
    });

    restaurant = await Restaurant.create({
      name: 'Workflow Cafe',
      phone: '+251920000005',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Order Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['waiter'], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: 'waiter' },
        { key: 'served', label: 'Served', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['waiter'], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: 'waiter' },
        { key: 'completed', label: 'Completed', systemState: 'COMPLETED', enabled: true, required: true, order: 3, actionRoles: [], visibleToRoles: ['chef', 'waiter', 'cashier'], responsibleRole: null }
      ]
    });

    table = await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Table 10',
      code: 'T10',
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
      items: [{ name: 'Test Juice', price: 80, category: 'Drinks' }]
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

    // Create Chef
    chefEmployee = await Employee.create({
      name: 'Chef Gordon',
      password: 'password123',
      role: 'chef',
      restaurant: restaurant._id,
      isActive: true
    });
    chefToken = jwt.sign({ id: chefEmployee._id, role: 'employee' }, process.env.JWT_SECRET);

    // Create Waiter A (Assigned to table)
    waiterEmployee = await Employee.create({
      name: 'Waiter Mario',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurant._id,
      isActive: true
    });
    waiterToken = jwt.sign({ id: waiterEmployee._id, role: 'employee' }, process.env.JWT_SECRET);

    table.assignedWaiter = waiterEmployee._id;
    await table.save();
  });

  test('Order Workflow snapshotting is preserved when Restaurant workflow changes', async () => {
    // 1. Create Order under workflow snapshot version 1
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'workflow-version-key-1')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;

    // 2. Change Restaurant workflow (disable served step and increment version to 2)
    restaurant.orderWorkflowVersion = 2;
    restaurant.orderWorkflow[1].enabled = false; // Disable served
    await restaurant.save();

    // 3. Retrieve the order and verify the workflow configuration snapshot is STILL version 1
    const order = await Order.findById(orderId);
    expect(order.workflow.version).toBe(1);
    expect(order.workflow.steps[1].enabled).toBe(true); // Still enabled in snapshot
  });

  test('Assigned Waiter advances placed -> served -> completed with timestamp and timeline integrity', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'advance-test-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // Verify initial state is placed / OPEN
    expect(createRes.body.data.order.currentStepKey).toBe('placed');
    expect(createRes.body.data.order.systemState).toBe('OPEN');
    expect(createRes.body.data.order.timeline.length).toBe(1);
    expect(createRes.body.data.order.timeline[0].action).toBe('order_created');

    // 1. Advance placed -> served
    const serveRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'placed' });

    expect(serveRes.status).toBe(200);
    expect(serveRes.body.data.order.currentStepKey).toBe('served');
    expect(serveRes.body.data.order.systemState).toBe('IN_PROGRESS');
    expect(serveRes.body.data.order.service.servedAt).not.toBeNull();
    const servedAtTimestamp = serveRes.body.data.order.service.servedAt;

    // Verify timeline entry for served
    expect(serveRes.body.data.order.timeline.length).toBe(2);
    expect(serveRes.body.data.order.timeline[1].stepKey).toBe('served');
    expect(serveRes.body.data.order.timeline[1].action).toBe('order_served');

    // 2. Advance served -> completed
    const completeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'served' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.order.currentStepKey).toBe('completed');
    expect(completeRes.body.data.order.systemState).toBe('COMPLETED');
    // Verify servedAt timestamp was not overwritten
    expect(completeRes.body.data.order.service.servedAt).toBe(servedAtTimestamp);

    // Verify timeline entries are in chronological order
    expect(completeRes.body.data.order.timeline.length).toBe(3);
    expect(completeRes.body.data.order.timeline[0].stepKey).toBe('placed');
    expect(completeRes.body.data.order.timeline[0].action).toBe('order_created');
    expect(completeRes.body.data.order.timeline[1].stepKey).toBe('served');
    expect(completeRes.body.data.order.timeline[1].action).toBe('order_served');
    expect(completeRes.body.data.order.timeline[2].stepKey).toBe('completed');
    expect(completeRes.body.data.order.timeline[2].action).toBe('order_completed');
  });

  test('Chef is blocked from advancing placed or served orders (403 Forbidden)', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'chef-block-test-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // Chef tries to advance placed -> served
    const chefAdvanceRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'placed' });

    expect(chefAdvanceRes.status).toBe(403);
    expect(chefAdvanceRes.body.error).toBe('ORDER_WORKFLOW_PERMISSION_DENIED');
  });

  test('Advance concurrency: expect 409 conflict if expectedStep does not match current state', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'concurrency-advance-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // 1. Waiter advances from placed -> served
    const firstAdvance = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'placed' });

    expect(firstAdvance.status).toBe(200);

    // 2. Client sends stale expectedStep: 'placed' when order is now 'served'
    const staleAdvance = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'placed' });

    expect(staleAdvance.status).toBe(409); // Conflict!
    expect(staleAdvance.body.error).toBe('ORDER_STATE_CHANGED');
  });

  test('Terminal completed state cannot be advanced', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'terminal-advance-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // Advance placed -> served
    await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'placed' });

    // Advance served -> completed
    await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'served' });

    // Attempt to advance terminal completed order
    const terminalRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'completed' });

    expect(terminalRes.status).toBe(403);
    expect(terminalRes.body.error).toBe('ORDER_NO_NEXT_WORKFLOW_STEP');
  });
});
