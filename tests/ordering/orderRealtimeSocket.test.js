const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { io: ioClient } = require('socket.io-client');
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

describe('Production-Grade Socket.IO Realtime Order Updates', () => {
  let testHttpServer;
  let serverPort;
  let activeSockets = [];

  let customerUser, customerToken;
  let customerUserB, customerTokenB;
  let ownerUser, ownerToken;
  let waiterA, waiterAToken;
  let waiterB, waiterBToken;
  let inactiveWaiter, inactiveWaiterToken;
  let restaurantA, tableA, qrCodeA, menuA, sessionA;
  let restaurantB, waiterRestB, waiterRestBToken;
  const rawQrToken = 'raw_qr_socket_test';
  let mockMenuItemId;

  function connectSocket(token) {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://localhost:${serverPort}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });
      activeSockets.push(socket);

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  function waitForEvent(socket, eventName, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for event "${eventName}"`));
      }, timeoutMs);

      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function assertNoEvent(socket, eventName, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const onEvent = (data) => {
        cleanup();
        reject(new Error(`Unexpectedly received event "${eventName}": ${JSON.stringify(data)}`));
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        socket.off(eventName, onEvent);
      }

      socket.on(eventName, onEvent);
    });
  }

  beforeAll(async () => {
    jest.setTimeout(60000);
    await new Promise((resolve) => {
      testHttpServer = app.server.listen(0, () => {
        serverPort = testHttpServer.address().port;
        resolve();
      });
    });
    await Order.syncIndexes();
  });

  afterAll((done) => {
    while (activeSockets.length > 0) {
      const s = activeSockets.pop();
      if (s && s.connected) s.disconnect();
    }
    if (testHttpServer && testHttpServer.listening) {
      testHttpServer.close(done);
    } else {
      done();
    }
  });

  afterEach(() => {
    while (activeSockets.length > 0) {
      const s = activeSockets.pop();
      if (s && s.connected) s.disconnect();
    }
  });

  beforeEach(async () => {
    // Customers
    customerUser = await User.create({
      name: 'Realtime Customer A',
      phone: '+251911111111',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    customerUserB = await User.create({
      name: 'Realtime Customer B',
      phone: '+251911111112',
      password: 'password123',
      role: 'customer'
    });
    customerTokenB = jwt.sign({ id: customerUserB._id, role: 'customer' }, process.env.JWT_SECRET);

    // Owner
    ownerUser = await User.create({
      name: 'Realtime Owner',
      phone: '+251922222222',
      password: 'password123',
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // Restaurant A
    restaurantA = await Restaurant.create({
      name: 'Realtime Cafe A',
      phone: '+251933333331',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Order Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['waiter'], visibleToRoles: ['waiter'], responsibleRole: 'waiter' },
        { key: 'served', label: 'Served', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['waiter'], visibleToRoles: ['waiter'], responsibleRole: 'waiter' },
        { key: 'completed', label: 'Completed', systemState: 'COMPLETED', enabled: true, required: true, order: 3, actionRoles: [], visibleToRoles: ['waiter'], responsibleRole: null }
      ]
    });

    // Waiter A (Assigned to Table A)
    waiterA = await Employee.create({
      name: 'Waiter Alice',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: true
    });
    waiterAToken = jwt.sign({ id: waiterA._id, role: 'employee' }, process.env.JWT_SECRET);

    // Waiter B (Same restaurant, NOT assigned to Table A)
    waiterB = await Employee.create({
      name: 'Waiter Bob',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: true
    });
    waiterBToken = jwt.sign({ id: waiterB._id, role: 'employee' }, process.env.JWT_SECRET);

    // Inactive Waiter
    inactiveWaiter = await Employee.create({
      name: 'Inactive Dave',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: false
    });
    inactiveWaiterToken = jwt.sign({ id: inactiveWaiter._id, role: 'employee' }, process.env.JWT_SECRET);

    // Table A
    tableA = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table E5',
      code: 'TABLE E5',
      assignedWaiter: waiterA._id,
      isActive: true
    });

    // QR Code
    qrCodeA = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: tableA._id,
      tokenHash: hashToken(rawQrToken),
      isActive: true,
      createdBy: ownerUser._id
    });

    // Menu
    menuA = await Menu.create({
      restaurant: restaurantA._id,
      items: [{ name: 'Cheese Pizza', price: 150, category: 'Food' }]
    });
    mockMenuItemId = menuA.items[0]._id;

    // Session
    sessionA = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      qrCode: qrCodeA._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    // Restaurant B & Staff (for cross-restaurant isolation testing)
    restaurantB = await Restaurant.create({
      name: 'Restaurant B Isolated',
      phone: '+251933333332',
      owner: ownerUser._id
    });

    waiterRestB = await Employee.create({
      name: 'Waiter Charles Rest B',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantB._id,
      isActive: true
    });
    waiterRestBToken = jwt.sign({ id: waiterRestB._id, role: 'employee' }, process.env.JWT_SECRET);
  });

  // Test 50: Customer Socket Authentication
  test('Customer Socket Auth: valid JWT connects successfully; invalid JWT is rejected', async () => {
    // Valid JWT
    const clientSocket = await connectSocket(customerToken);
    expect(clientSocket.connected).toBe(true);

    // Invalid JWT
    await expect(connectSocket('invalid.jwt.token')).rejects.toThrow();
  });

  // Test 51: Employee Socket Authentication
  test('Employee Socket Auth: active employee connects; inactive employee is rejected', async () => {
    // Active Waiter
    const waiterSocket = await connectSocket(waiterAToken);
    expect(waiterSocket.connected).toBe(true);

    // Inactive Employee
    await expect(connectSocket(inactiveWaiterToken)).rejects.toThrow();
  });

  // Test 52: New Order Realtime & Targeted Audience
  test('New Order: Waiter A receives order:created, Customer receives order:created, Waiter B does not, Restaurant receives orders:invalidate', async () => {
    const waiterASocket = await connectSocket(waiterAToken);
    const waiterBSocket = await connectSocket(waiterBToken);
    const customerSocket = await connectSocket(customerToken);

    const waiterAPromise = waitForEvent(waiterASocket, 'order:created');
    const customerPromise = waitForEvent(customerSocket, 'order:created');
    const waiterBInvalidatePromise = waitForEvent(waiterBSocket, 'orders:invalidate');

    // Customer places order via REST
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'realtime-order-key-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 2, notes: 'hot test' }],
        customerNotes: 'hot test cust'
      });

    expect(res.status).toBe(201);
    const createdOrder = res.body.data.order;

    // 1. Waiter A gets order:created with correct envelope & fields
    const waiterAEvent = await waiterAPromise;
    expect(waiterAEvent.eventId).toBeDefined();
    expect(waiterAEvent.type).toBe('order:created');
    expect(waiterAEvent.occurredAt).toBeDefined();
    expect(waiterAEvent.data.order.id.toString()).toBe(createdOrder.id.toString());
    expect(waiterAEvent.data.order.orderNumber).toBe(createdOrder.orderNumber);
    expect(waiterAEvent.data.order.table.name).toBe('Table E5');
    expect(waiterAEvent.data.order.currentStepKey).toBe('placed');
    expect(waiterAEvent.data.order.systemState).toBe('OPEN');
    expect(waiterAEvent.data.order.idempotencyKey).toBeUndefined(); // Privacy check

    // 2. Customer gets order:created
    const customerEvent = await customerPromise;
    expect(customerEvent.eventId).toBeDefined();
    expect(customerEvent.type).toBe('order:created');
    expect(customerEvent.data.order.id.toString()).toBe(createdOrder.id.toString());

    // 3. Waiter B does NOT get direct order:created
    await assertNoEvent(waiterBSocket, 'order:created', 800);

    // 4. Waiter B gets orders:invalidate via restaurant room
    const invalidateEvent = await waiterBInvalidatePromise;
    expect(invalidateEvent.type).toBe('orders:invalidate');
    expect(invalidateEvent.data.orderId.toString()).toBe(createdOrder.id.toString());
    expect(invalidateEvent.data.reason).toBe('created');
  });

  // Test 53: Idempotent Retry Prevents Duplicate Events
  test('Idempotency: duplicate request returns cached order and emits NO second order:created event', async () => {
    const waiterASocket = await connectSocket(waiterAToken);
    const idempotencyKey = 'idempotent-event-dedup-key';

    const firstEventPromise = waitForEvent(waiterASocket, 'order:created');

    // First request creates order
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(res1.status).toBe(201);
    await firstEventPromise;

    // Retry identical request with same idempotency key
    const noEventPromise = assertNoEvent(waiterASocket, 'order:created', 1500);

    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.order.id).toBe(res1.body.data.order.id);

    // Must NOT receive second order:created
    await noEventPromise;
  });

  // Test 54: Mark Served (placed -> served)
  test('Advance placed -> served: Customer and Waiter receive order:updated (placed -> served)', async () => {
    // Create order
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'advance-served-socket-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    const waiterASocket = await connectSocket(waiterAToken);
    const customerSocket = await connectSocket(customerToken);
    const waiterBSocket = await connectSocket(waiterBToken);

    const customerUpdatePromise = waitForEvent(customerSocket, 'order:updated');
    const waiterUpdatePromise = waitForEvent(waiterASocket, 'order:updated');
    const restaurantInvalidatePromise = waitForEvent(waiterBSocket, 'orders:invalidate');

    // Waiter A advances placed -> served
    const advanceRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    expect(advanceRes.status).toBe(200);

    const customerEvent = await customerUpdatePromise;
    expect(customerEvent.type).toBe('order:updated');
    expect(customerEvent.data.orderId).toBe(orderId.toString());
    expect(customerEvent.data.previousStepKey).toBe('placed');
    expect(customerEvent.data.currentStepKey).toBe('served');
    expect(customerEvent.data.systemState).toBe('IN_PROGRESS');

    const waiterEvent = await waiterUpdatePromise;
    expect(waiterEvent.data.previousStepKey).toBe('placed');
    expect(waiterEvent.data.currentStepKey).toBe('served');

    const invEvent = await restaurantInvalidatePromise;
    expect(invEvent.data.reason).toBe('updated');
  });

  // Test 55: Complete Order (served -> completed)
  test('Advance served -> completed: Customer and Waiter receive order:updated (served -> completed)', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'advance-completed-socket-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    // Advance to served first
    await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    const waiterASocket = await connectSocket(waiterAToken);
    const customerSocket = await connectSocket(customerToken);

    const customerUpdatePromise = waitForEvent(customerSocket, 'order:updated');
    const waiterUpdatePromise = waitForEvent(waiterASocket, 'order:updated');

    // Advance served -> completed
    const completeRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'served' });

    expect(completeRes.status).toBe(200);

    const customerEvent = await customerUpdatePromise;
    expect(customerEvent.data.previousStepKey).toBe('served');
    expect(customerEvent.data.currentStepKey).toBe('completed');
    expect(customerEvent.data.systemState).toBe('COMPLETED');

    const waiterEvent = await waiterUpdatePromise;
    expect(waiterEvent.data.previousStepKey).toBe('served');
    expect(waiterEvent.data.currentStepKey).toBe('completed');
  });

  // Test 56: Failed Transition Emits Nothing
  test('Failed Transition: unauthorized employee (403) emits NO order:updated events', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'failed-transition-socket-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    const customerSocket = await connectSocket(customerToken);
    const waiterASocket = await connectSocket(waiterAToken);

    const noCustEvent = assertNoEvent(customerSocket, 'order:updated', 1200);
    const noWaiterEvent = assertNoEvent(waiterASocket, 'order:updated', 1200);

    // Waiter B (not assigned) attempts to advance
    const res = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterBToken}`)
      .send({ expectedStep: 'placed' });

    expect(res.status).toBe(403);

    await Promise.all([noCustEvent, noWaiterEvent]);
  });

  // Test 57: Concurrency Conflict Emits Once
  test('Concurrency Conflict: simultaneous advance requests emit exactly ONE order:updated event', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'concurrency-socket-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    const customerSocket = await connectSocket(customerToken);
    let eventCount = 0;
    customerSocket.on('order:updated', () => {
      eventCount++;
    });

    // Run 2 simultaneous advance requests with expectedStep: 'placed'
    const req1 = request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    const req2 = request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]); // One success, one conflict

    // Wait 1.2s to confirm only ONE event arrived
    await new Promise((r) => setTimeout(r, 1200));
    expect(eventCount).toBe(1);
  });

  // Test 58: Cancellation
  test('Cancellation: Customer and Waiter receive order:cancelled; Restaurant receives orders:invalidate', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'cancel-socket-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    const orderId = createRes.body.data.order.id;

    const customerSocket = await connectSocket(customerToken);
    const waiterASocket = await connectSocket(waiterAToken);
    const waiterBSocket = await connectSocket(waiterBToken);

    const custCancelPromise = waitForEvent(customerSocket, 'order:cancelled');
    const waiterCancelPromise = waitForEvent(waiterASocket, 'order:cancelled');
    const restInvalidatePromise = waitForEvent(waiterBSocket, 'orders:invalidate');

    // Cancel order
    const cancelRes = await request(app)
      .post(`/api/employee/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ reason: 'Out of pizza ingredients' });

    expect(cancelRes.status).toBe(200);

    const custEvent = await custCancelPromise;
    expect(custEvent.type).toBe('order:cancelled');
    expect(custEvent.data.orderId).toBe(orderId.toString());
    expect(custEvent.data.systemState).toBe('CANCELLED');
    expect(custEvent.data.reason).toBe('Out of pizza ingredients');

    const waiterEvent = await waiterCancelPromise;
    expect(waiterEvent.data.reason).toBe('Out of pizza ingredients');

    const invEvent = await restInvalidatePromise;
    expect(invEvent.data.reason).toBe('cancelled');
  });

  // Test 59: Cross-Customer Isolation
  test('Cross-Customer Isolation: Customer B never receives Customer A order events', async () => {
    const customerASocket = await connectSocket(customerToken);
    const customerBSocket = await connectSocket(customerTokenB);

    const noCustBEvent = assertNoEvent(customerBSocket, 'order:created', 1500);

    // Customer A places order
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'cross-customer-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    await noCustBEvent;
  });

  // Test 60: Cross-Restaurant Isolation
  test('Cross-Restaurant Isolation: Restaurant B employees never receive Restaurant A events', async () => {
    const waiterRestBSocket = await connectSocket(waiterRestBToken);

    const noOrderCreated = assertNoEvent(waiterRestBSocket, 'order:created', 1500);
    const noInvalidate = assertNoEvent(waiterRestBSocket, 'orders:invalidate', 1500);

    // Order placed in Restaurant A
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'cross-restaurant-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    await Promise.all([noOrderCreated, noInvalidate]);
  });

  // Test 61: Restaurant Owner joins restaurant room & receives realtime order updates
  test('Restaurant Owner joins restaurant room and receives realtime order updates', async () => {
    const ownerSocket = await connectSocket(ownerToken);
    expect(ownerSocket.connected).toBe(true);

    const ownerOrderCreatedPromise = waitForEvent(ownerSocket, 'order:created');
    const ownerInvalidatePromise = waitForEvent(ownerSocket, 'orders:invalidate');

    // Customer places order
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'owner-realtime-key-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }],
        customerNotes: 'Table needs water'
      });

    expect(res.status).toBe(201);
    const orderId = res.body.data.order.id;

    const createdEvent = await ownerOrderCreatedPromise;
    expect(createdEvent.type).toBe('order:created');
    expect(createdEvent.data.order.id.toString()).toBe(orderId.toString());

    const invalidateEvent = await ownerInvalidatePromise;
    expect(invalidateEvent.type).toBe('orders:invalidate');
    expect(invalidateEvent.data.orderId.toString()).toBe(orderId.toString());

    // Advance order and verify owner receives order:updated
    const ownerUpdatedPromise = waitForEvent(ownerSocket, 'order:updated');

    const advanceRes = await request(app)
      .post(`/api/employee/orders/${orderId}/advance`)
      .set('Authorization', `Bearer ${waiterAToken}`)
      .send({ expectedStep: 'placed' });

    expect(advanceRes.status).toBe(200);

    const updatedEvent = await ownerUpdatedPromise;
    expect(updatedEvent.type).toBe('order:updated');
    expect(updatedEvent.data.orderId.toString()).toBe(orderId.toString());
    expect(updatedEvent.data.currentStepKey).toBe('served');
  }, 60000);

  // Test 62: Dynamic joinRestaurant and joinOrder socket events
  test('Dynamic join events: joinRestaurant and joinOrder allow authorized room subscription', async () => {
    const ownerSocket = await connectSocket(ownerToken);

    // 1. Join restaurant via event
    const joinRestPromise = new Promise((resolve) => {
      ownerSocket.emit('joinRestaurant', { restaurantId: restaurantA._id.toString() }, (ack) => {
        resolve(ack);
      });
    });
    const restAck = await joinRestPromise;
    expect(restAck.success).toBe(true);
    expect(restAck.room).toBe(`restaurant:${restaurantA._id}`);

    // Create an order
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'dynamic-room-join-key')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: mockMenuItemId, quantity: 1 }]
      });

    expect(res.status).toBe(201);
    const orderId = res.body.data.order.id;

    // 2. Join specific order via joinOrder
    const joinOrderPromise = new Promise((resolve) => {
      ownerSocket.emit('joinOrder', { orderId }, (ack) => {
        resolve(ack);
      });
    });
    const orderAck = await joinOrderPromise;
    expect(orderAck.success).toBe(true);
    expect(orderAck.room).toBe(`order:${orderId}`);
  }, 60000);
});
