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
        { key: 'placed', label: 'Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['chef'] },
        { key: 'preparing', label: 'Cooking', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['chef'] },
        { key: 'ready', label: 'Ready', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 3, actionRoles: ['waiter'] },
        { key: 'completed', label: 'Done', systemState: 'COMPLETED', enabled: true, required: true, order: 4, actionRoles: ['cashier'] }
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

    // Create Waiter
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

    // 2. Change Restaurant workflow (disable preparing step and increment version to 2)
    restaurant.orderWorkflowVersion = 2;
    restaurant.orderWorkflow[1].enabled = false; // Disable preparing
    await restaurant.save();

    // 3. Retrieve the order and verify the workflow configuration snapshot is STILL version 1
    const order = await Order.findById(orderId);
    expect(order.workflow.version).toBe(1);
    expect(order.workflow.steps[1].enabled).toBe(true); // Still enabled in snapshot
  });

  test('Chef successfully advances order from placed to preparing', async () => {
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

    // Advance to next step (placed -> preparing)
    const advanceRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'placed' });

    expect(advanceRes.status).toBe(200);
    expect(advanceRes.body.data.order.currentStepKey).toBe('preparing');
    expect(advanceRes.body.data.order.systemState).toBe('IN_PROGRESS');

    // Verify timeline entry was added
    expect(advanceRes.body.data.order.timeline.length).toBe(2);
    expect(advanceRes.body.data.order.timeline[1].action).toBe('workflow_advanced');
  });

  test('Reject transition if employee role lacks actionRoles capability in current step', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'reject-transition-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // Waiter tries to advance from placed (only chef is allowed: actionRoles = ['chef'])
    const advanceRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ expectedStep: 'placed' });

    expect(advanceRes.status).toBe(403);
    expect(advanceRes.body.error).toBe('ORDER_WORKFLOW_PERMISSION_DENIED');
  });

  test('Advance concurrency: expect 409 conflict if state was already changed', async () => {
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

    // Chef 1 advances successfully
    const chef1 = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'placed' });

    // Chef 2 concurrently tries to advance from 'placed' as well (expectedStep: 'placed')
    const chef2 = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${chefToken}`)
      .send({ expectedStep: 'placed' });

    expect(chef1.status).toBe(200);
    expect(chef2.status).toBe(409); // Conflict!
    expect(chef2.body.error).toBe('ORDER_STATE_CHANGED');
  });
});
