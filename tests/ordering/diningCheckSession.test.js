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
const DiningCheck = require('../../model/diningCheck');
const { hashToken } = require('../../services/qrCodeService');
const { SYSTEM_STATES, ORDER_ERROR_CODES } = require('../../constants/orders');

describe('DiningCheck & Session-Level Billing Integration Tests', () => {
  let testHttpServer;
  let serverPort;
  let activeSockets = [];

  let customerUserA, customerTokenA;
  let customerUserB, customerTokenB;
  let ownerUserA, ownerTokenA;
  let ownerUserB, ownerTokenB;
  let waiterA, waiterTokenA;
  let cashierA, cashierTokenA;
  let waiterB, waiterTokenB;
  let restaurantA, restaurantB;
  let table5, table1, table2, table4;
  let qrCodeA, qrCodeB;
  let sessionA;
  let menuA;
  let itemBurgerId, itemFriesId, itemSodaId;

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

  function waitForEvent(socket, eventName, timeoutMs = 8000) {
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

  beforeAll(async () => {
    jest.setTimeout(60000);
    await new Promise((resolve) => {
      testHttpServer = app.server.listen(0, () => {
        serverPort = testHttpServer.address().port;
        resolve();
      });
    });
    await Order.syncIndexes();
    await DiningCheck.syncIndexes();
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
    await DiningCheck.deleteMany({});
    await Order.deleteMany({});
    await OrderSession.deleteMany({});
    await RestaurantQrCode.deleteMany({});
    await RestaurantTable.deleteMany({});
    await Menu.deleteMany({});
    await Employee.deleteMany({});
    await Restaurant.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    customerUserA = await User.create({
      name: 'Abebe Kebede',
      phone: '+251911000001',
      password: 'password123',
      role: 'customer'
    });
    customerTokenA = jwt.sign({ id: customerUserA._id, role: 'customer' }, process.env.JWT_SECRET);

    customerUserB = await User.create({
      name: 'Sara Tadesse',
      phone: '+251911000002',
      password: 'password123',
      role: 'customer'
    });
    customerTokenB = jwt.sign({ id: customerUserB._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUserA = await User.create({
      name: 'Owner Alpha',
      phone: '+251922000001',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenA = jwt.sign({ id: ownerUserA._id, role: 'owner' }, process.env.JWT_SECRET);

    ownerUserB = await User.create({
      name: 'Owner Beta',
      phone: '+251922000002',
      password: 'password123',
      role: 'owner'
    });
    ownerTokenB = jwt.sign({ id: ownerUserB._id, role: 'owner' }, process.env.JWT_SECRET);

    // 2. Restaurants
    restaurantA = await Restaurant.create({
      name: 'Alpha Dining',
      phone: '+251933000001',
      location: 'Bole',
      owner: ownerUserA._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Order Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['waiter'], visibleToRoles: ['waiter', 'cashier'], responsibleRole: 'waiter' },
        { key: 'served', label: 'Served', systemState: 'IN_PROGRESS', enabled: true, required: false, order: 2, actionRoles: ['waiter'], visibleToRoles: ['waiter', 'cashier'], responsibleRole: 'waiter' },
        { key: 'completed', label: 'Completed', systemState: 'COMPLETED', enabled: true, required: true, order: 3, actionRoles: [], visibleToRoles: ['waiter', 'cashier'], responsibleRole: null }
      ]
    });

    restaurantB = await Restaurant.create({
      name: 'Beta Bistro',
      phone: '+251933000002',
      location: 'Kazanchis',
      owner: ownerUserB._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7600, 9.0300] },
      orderingRadiusMeters: 100
    });

    // 3. Employees
    waiterA = await Employee.create({
      name: 'Waiter Wendimu',
      restaurant: restaurantA._id,
      role: 'waiter',
      password: 'password123',
      isActive: true
    });
    waiterTokenA = jwt.sign({ id: waiterA._id, role: 'employee' }, process.env.JWT_SECRET);

    cashierA = await Employee.create({
      name: 'Cashier Chaltu',
      restaurant: restaurantA._id,
      role: 'cashier',
      password: 'password123',
      isActive: true
    });
    cashierTokenA = jwt.sign({ id: cashierA._id, role: 'employee' }, process.env.JWT_SECRET);

    waiterB = await Employee.create({
      name: 'Waiter Biruk',
      restaurant: restaurantB._id,
      role: 'waiter',
      password: 'password123',
      isActive: true
    });
    waiterTokenB = jwt.sign({ id: waiterB._id, role: 'employee' }, process.env.JWT_SECRET);

    // 4. Tables
    table5 = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 5',
      code: 'T5',
      assignedWaiter: waiterA._id,
      isActive: true
    });

    table1 = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 1',
      code: 'T1',
      assignedWaiter: waiterA._id,
      isActive: true
    });

    table2 = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 2',
      code: 'T2',
      assignedWaiter: waiterA._id,
      isActive: true
    });

    table4 = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 4',
      code: 'T4',
      assignedWaiter: waiterA._id,
      isActive: true
    });

    // 5. QR Code & Session for Customer A at Table 5
    qrCodeA = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: table5._id,
      tokenHash: hashToken('token_check_test_a'),
      isActive: true,
      createdBy: ownerUserA._id
    });

    sessionA = await OrderSession.create({
      customer: customerUserA._id,
      restaurant: restaurantA._id,
      table: table5._id,
      qrCode: qrCodeA._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 3600000)
    });

    // 6. Menu Items
    menuA = await Menu.create({
      restaurant: restaurantA._id,
      items: [
        { name: 'Burger', price: 250, category: 'Mains' },
        { name: 'Fries', price: 150, category: 'Sides' },
        { name: 'Soda', price: 100, category: 'Drinks' }
      ]
    });
    itemBurgerId = menuA.items[0]._id;
    itemFriesId = menuA.items[1]._id;
    itemSodaId = menuA.items[2]._id;
  }, 60000);

  test('Section 51 & 52 & 54: Multiple orders in same session share ONE DiningCheck with combined total', async () => {
    // 1. Place Order #1: Burger (250 ETB)
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'multi-order-key-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    expect(res1.status).toBe(201);
    const order1Id = res1.body.data.order.id;
    const check1Id = res1.body.data.order.diningCheckId;
    expect(check1Id).toBeTruthy();

    // Check DiningCheck total = 250 ETB
    let check = await DiningCheck.findById(check1Id);
    expect(check.totals.total).toBe(250);

    // 2. Place Order #2: Fries (150 ETB)
    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'multi-order-key-2')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemFriesId, quantity: 1, unitPrice: 150, lineTotal: 150 }]
      });
    expect(res2.status).toBe(201);
    const order2Id = res2.body.data.order.id;
    expect(res2.body.data.order.diningCheckId).toBe(check1Id);

    // 3. Place Order #3: Soda (100 ETB)
    const res3 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'multi-order-key-3')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemSodaId, quantity: 1, unitPrice: 100, lineTotal: 100 }]
      });
    expect(res3.status).toBe(201);
    const order3Id = res3.body.data.order.id;
    expect(res3.body.data.order.diningCheckId).toBe(check1Id);

    // Assert: Exactly 3 orders exist
    const orders = await Order.find({ orderSession: sessionA._id });
    expect(orders).toHaveLength(3);

    // Assert: Exactly ONE DiningCheck exists
    const totalChecks = await DiningCheck.countDocuments({ orderSession: sessionA._id });
    expect(totalChecks).toBe(1);

    // Assert: All three orders reference the exact same diningCheck ID
    expect(orders[0].diningCheck.toString()).toBe(check1Id);
    expect(orders[1].diningCheck.toString()).toBe(check1Id);
    expect(orders[2].diningCheck.toString()).toBe(check1Id);

    // Assert: Combined total = 250 + 150 + 100 = 500 ETB
    check = await DiningCheck.findById(check1Id);
    expect(check.totals.subtotal).toBe(500);
    expect(check.totals.total).toBe(500);
    expect(check.payment.isPaid).toBe(false);
  });

  test('Section 53: Idempotent retries never double-increase DiningCheck total', async () => {
    // 1. Submit Order #1 with Key A
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'idempotency-test-key-A')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    expect(res1.status).toBe(201);
    const checkId = res1.body.data.order.diningCheckId;

    let check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(250);

    // 2. Retry with the SAME Key A
    const resRetry = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'idempotency-test-key-A')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    expect(resRetry.status).toBe(201);

    // Assert only 1 order document was created
    const orders = await Order.find({ orderSession: sessionA._id });
    expect(orders).toHaveLength(1);

    // Assert total remains 250, NOT 500
    check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(250);

    // 3. Legitimate second order with Key B (150 ETB)
    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'idempotency-test-key-B')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemFriesId, quantity: 1, unitPrice: 150, lineTotal: 150 }]
      });
    expect(res2.status).toBe(201);

    check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(400);
  });

  test('Section 55 & 56: One payment covers all orders on DiningCheck', async () => {
    // Place 2 orders on check
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'pay-cov-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });

    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'pay-cov-2')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemFriesId, quantity: 1, unitPrice: 150, lineTotal: 150 }]
      });
    const checkId = res2.body.data.order.diningCheckId;

    const proofUrl = 'https://res.cloudinary.com/loyalty/image/upload/telebirr_proof_123.jpg';

    // Cashier pays the DiningCheck once
    const payRes = await request(app)
      .patch(`/api/employee/dining-checks/${checkId}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({
        method: 'telebirr',
        proofUrl
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.data.check.payment.isPaid).toBe(true);
    expect(payRes.body.data.check.payment.method).toBe('telebirr');
    expect(payRes.body.data.check.payment.proofUrl).toBe(proofUrl);
    expect(payRes.body.data.check.payment.recordedBy).toBe(cashierA._id.toString());
    expect(payRes.body.data.check.payment.paidAt).toBeTruthy();

    const dbCheck = await DiningCheck.findById(checkId);
    expect(dbCheck.payment.isPaid).toBe(true);
    expect(dbCheck.payment.method).toBe('telebirr');
    expect(dbCheck.payment.proofUrl).toBe(proofUrl);
  });

  test('Section 57: Paid DiningCheck rejects new orders with 409 DINING_CHECK_ALREADY_PAID', async () => {
    // 1. Create first order
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'pre-pay-order')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const checkId = res1.body.data.order.diningCheckId;

    // 2. Mark check paid
    await request(app)
      .patch(`/api/employee/dining-checks/${checkId}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ method: 'cash' });

    // 3. Attempt to place another order on the paid session
    const resAttempt = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'post-pay-attempt')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemSodaId, quantity: 1, unitPrice: 100, lineTotal: 100 }]
      });

    expect(resAttempt.status).toBe(409);
    expect(resAttempt.body.success).toBe(false);
    expect(resAttempt.body.error).toBe(ORDER_ERROR_CODES.DINING_CHECK_ALREADY_PAID);

    // Total remains 250 and no second order exists
    const check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(250);
    const orderCount = await Order.countDocuments({ orderSession: sessionA._id });
    expect(orderCount).toBe(1);
  });

  test('Section 58: Cancelling an unpaid order updates DiningCheck total', async () => {
    // Order 1: Burger (250 ETB)
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'cancel-test-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const order1 = res1.body.data.order;
    const checkId = order1.diningCheckId;

    // Order 2: Fries (150 ETB)
    const res2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'cancel-test-2')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemFriesId, quantity: 1, unitPrice: 150, lineTotal: 150 }]
      });
    const order2 = res2.body.data.order;

    let check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(400);

    // Cancel Order 2 while unpaid
    const cancelRes = await request(app)
      .post(`/api/employee/orders/${order2.id}/cancel`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ reason: 'Customer changed mind' });

    expect(cancelRes.status).toBe(200);

    // DiningCheck total is now recalculated excluding the cancelled order (250 ETB)
    check = await DiningCheck.findById(checkId);
    expect(check.totals.total).toBe(250);
  });

  test('Section 59: Reject cancelling an order after DiningCheck is paid', async () => {
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'cancel-paid-test')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const order = res1.body.data.order;
    const checkId = order.diningCheckId;

    // Mark check paid
    await request(app)
      .patch(`/api/employee/dining-checks/${checkId}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'cash' });

    // Attempt to cancel the order on the paid check
    const cancelRes = await request(app)
      .post(`/api/employee/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ reason: 'Attempt refund cancellation' });

    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.success).toBe(false);
    expect(cancelRes.body.error).toBe(ORDER_ERROR_CODES.DINING_CHECK_ALREADY_PAID);

    // Verify order remains OPEN / not CANCELLED
    const dbOrder = await Order.findById(order.id);
    expect(dbOrder.systemState).toBe(SYSTEM_STATES.OPEN);
  });

  test('Section 60: Operational order completion does NOT mark DiningCheck paid', async () => {
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'op-complete-test')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const order = res1.body.data.order;
    const checkId = order.diningCheckId;

    // Advance placed -> served
    await request(app)
      .post(`/api/employee/orders/${order.id}/advance`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ expectedStep: 'placed' });

    // Advance served -> completed
    const advanceRes = await request(app)
      .post(`/api/employee/orders/${order.id}/advance`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ expectedStep: 'served' });

    expect(advanceRes.status).toBe(200);
    expect(advanceRes.body.data.order.systemState).toBe(SYSTEM_STATES.COMPLETED);

    // DiningCheck MUST remain unpaid!
    const check = await DiningCheck.findById(checkId);
    expect(check.payment.isPaid).toBe(false);
  });

  test('Section 61: Restaurant isolation - Employee from Restaurant B cannot access or pay Restaurant A check', async () => {
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'isolation-test')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const checkId = res1.body.data.order.diningCheckId;

    // Waiter from Restaurant B attempts to view DiningCheck A
    const viewRes = await request(app)
      .get(`/api/employee/dining-checks/${checkId}`)
      .set('Authorization', `Bearer ${waiterTokenB}`);
    expect(viewRes.status).toBe(403);

    // Waiter from Restaurant B attempts to pay DiningCheck A
    const payRes = await request(app)
      .patch(`/api/employee/dining-checks/${checkId}/payment`)
      .set('Authorization', `Bearer ${waiterTokenB}`)
      .send({ method: 'cash' });
    expect(payRes.status).toBe(403);

    // DiningCheck remains unpaid
    const check = await DiningCheck.findById(checkId);
    expect(check.payment.isPaid).toBe(false);
  });

  test('Section 62: Owner history returns grouped DiningChecks with pagination and answer all 7 questions', async () => {
    // Check 1: Customer A at Table 1 (Cash, Paid)
    const checkA = await DiningCheck.create({
      restaurant: restaurantA._id,
      customer: customerUserA._id,
      table: table1._id,
      orderSession: new mongoose.Types.ObjectId(),
      customerSnapshot: { name: 'Abebe Kebede', phone: '+251911000001' },
      tableSnapshot: { name: 'Table 1', code: 'T1' },
      totals: { subtotal: 400, total: 400, currency: 'ETB' },
      payment: { isPaid: true, method: 'cash', paidAt: new Date() }
    });
    await Order.create({
      orderNumber: 'ORD-A1',
      customer: customerUserA._id,
      restaurant: restaurantA._id,
      table: table1._id,
      orderSession: checkA.orderSession,
      diningCheck: checkA._id,
      items: [{ menuItemId: itemBurgerId, name: 'Burger', quantity: 1, unitPrice: 400, lineTotal: 400 }],
      pricing: { subtotal: 400, total: 400, currency: 'ETB' },
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      idempotencyKey: 'hist-key-a1'
    });

    // Check 2: Customer B at Table 4 (Telebirr, Paid, Proof attached)
    const proofUrl = 'https://cloudinary.com/proof_b.jpg';
    const checkB = await DiningCheck.create({
      restaurant: restaurantA._id,
      customer: customerUserB._id,
      table: table4._id,
      orderSession: new mongoose.Types.ObjectId(),
      customerSnapshot: { name: 'Sara Tadesse', phone: '+251911000002' },
      tableSnapshot: { name: 'Table 4', code: 'T4' },
      totals: { subtotal: 600, total: 600, currency: 'ETB' },
      payment: { isPaid: true, method: 'telebirr', proofUrl, paidAt: new Date() }
    });
    await Order.create({
      orderNumber: 'ORD-B1',
      customer: customerUserB._id,
      restaurant: restaurantA._id,
      table: table4._id,
      orderSession: checkB.orderSession,
      diningCheck: checkB._id,
      items: [{ menuItemId: itemBurgerId, name: 'Burger', quantity: 2, unitPrice: 300, lineTotal: 600 }],
      pricing: { subtotal: 600, total: 600, currency: 'ETB' },
      currentStepKey: 'completed',
      systemState: SYSTEM_STATES.COMPLETED,
      idempotencyKey: 'hist-key-b1'
    });

    // Check 3: Customer A at Table 2 (Unpaid)
    const checkC = await DiningCheck.create({
      restaurant: restaurantA._id,
      customer: customerUserA._id,
      table: table2._id,
      orderSession: new mongoose.Types.ObjectId(),
      customerSnapshot: { name: 'Abebe Kebede', phone: '+251911000001' },
      tableSnapshot: { name: 'Table 2', code: 'T2' },
      totals: { subtotal: 200, total: 200, currency: 'ETB' },
      payment: { isPaid: false }
    });
    await Order.create({
      orderNumber: 'ORD-C1',
      customer: customerUserA._id,
      restaurant: restaurantA._id,
      table: table2._id,
      orderSession: checkC.orderSession,
      diningCheck: checkC._id,
      items: [{ menuItemId: itemSodaId, name: 'Soda', quantity: 2, unitPrice: 100, lineTotal: 200 }],
      pricing: { subtotal: 200, total: 200, currency: 'ETB' },
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.OPEN,
      idempotencyKey: 'hist-key-c1'
    });

    // Owner requests history
    const histRes = await request(app)
      .get(`/api/owner/dining-checks/history?restaurantId=${restaurantA._id}&page=1&limit=20`)
      .set('Authorization', `Bearer ${ownerTokenA}`);

    expect(histRes.status).toBe(200);
    expect(histRes.body.success).toBe(true);
    expect(histRes.body.data.checks).toHaveLength(3);
    expect(histRes.body.data.pagination.total).toBe(3);

    // Verify answers to 7 questions:
    const saraCheck = histRes.body.data.checks.find((c) => c.customer.name === 'Sara Tadesse');
    expect(saraCheck).toBeTruthy();
    expect(saraCheck.customer.name).toBe('Sara Tadesse'); // WHO
    expect(saraCheck.table.name).toBe('Table 4');         // WHERE
    expect(saraCheck.orders).toHaveLength(1);            // WHAT
    expect(saraCheck.totals.total).toBe(600);            // HOW MUCH
    expect(saraCheck.payment.method).toBe('telebirr');    // HOW PAID
    expect(saraCheck.payment.isPaid).toBe(true);         // DID THEY PAY
    expect(saraCheck.payment.proofUrl).toBe(proofUrl);   // WHAT PROOF
  });

  test('Section 63: Same table with different customer sessions creates separate DiningChecks', async () => {
    // 12:00 -> Customer A at Table 5, Session A
    const resA = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'same-table-cust-A')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const checkIdA = resA.body.data.order.diningCheckId;

    // Settle payment and expire Session A
    await request(app)
      .patch(`/api/employee/dining-checks/${checkIdA}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ method: 'cash' });
    sessionA.status = 'completed';
    await sessionA.save();

    // 14:00 -> Customer B at same Table 5, creates Session B
    const sessionB = await OrderSession.create({
      customer: customerUserB._id,
      restaurant: restaurantA._id,
      table: table5._id,
      qrCode: qrCodeA._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 3600000)
    });

    const resB = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenB}`)
      .set('Idempotency-Key', 'same-table-cust-B')
      .send({
        orderSessionId: sessionB._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemFriesId, quantity: 2, unitPrice: 150, lineTotal: 300 }]
      });
    const checkIdB = resB.body.data.order.diningCheckId;

    // Assert: Check A and Check B are completely DIFFERENT checks despite same table
    expect(checkIdA).not.toBe(checkIdB);

    const checkA = await DiningCheck.findById(checkIdA);
    const checkB = await DiningCheck.findById(checkIdB);

    expect(checkA.table.toString()).toBe(table5._id.toString());
    expect(checkB.table.toString()).toBe(table5._id.toString());
    expect(checkA.payment.isPaid).toBe(true);
    expect(checkB.payment.isPaid).toBe(false);
  });

  test('Section 64: Historical tableSnapshot is preserved when table is renamed', async () => {
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'snapshot-test-order')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const checkId = res1.body.data.order.diningCheckId;

    // Verify snapshot captured Table 5
    let check = await DiningCheck.findById(checkId);
    expect(check.tableSnapshot.name).toBe('Table 5');
    expect(check.tableSnapshot.code).toBe('T5');

    // Later: Table is renamed to 'VIP Table'
    table5.name = 'VIP Table';
    table5.code = 'VIP-1';
    await table5.save();

    // Re-fetch historical DiningCheck: tableSnapshot MUST still be 'Table 5'
    check = await DiningCheck.findById(checkId);
    expect(check.tableSnapshot.name).toBe('Table 5');
    expect(check.tableSnapshot.code).toBe('T5');
  });

  test('Section 39 & 40: Broadcasts check:updated and check:payment-updated via Socket.IO', async () => {
    const ownerSocket = await connectSocket(ownerTokenA);
    const custSocket = await connectSocket(customerTokenA);

    const custCheckUpdatedPromise = waitForEvent(custSocket, 'check:updated');
    const ownerInvalidatePromise = waitForEvent(ownerSocket, 'checks:invalidate');

    // Place an order -> triggers check:updated and checks:invalidate
    const res1 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .set('Idempotency-Key', 'realtime-check-test-1')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: itemBurgerId, quantity: 1, unitPrice: 250, lineTotal: 250 }]
      });
    const checkId = res1.body.data.order.diningCheckId;

    const [custUpdateEvent, ownerInvalidateEvent] = await Promise.all([
      custCheckUpdatedPromise,
      ownerInvalidatePromise
    ]);

    expect(custUpdateEvent.type).toBe('check:updated');
    expect(custUpdateEvent.data.checkId).toBe(checkId);
    expect(custUpdateEvent.data.totals.total).toBe(250);
    expect(ownerInvalidateEvent.type).toBe('checks:invalidate');

    // Now test payment event
    const custPayUpdatedPromise = waitForEvent(custSocket, 'check:payment-updated');
    const ownerPayInvalidatePromise = waitForEvent(ownerSocket, 'checks:invalidate');

    await request(app)
      .patch(`/api/employee/dining-checks/${checkId}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ method: 'telebirr' });

    const [custPayEvent, ownerPayInvalidate] = await Promise.all([
      custPayUpdatedPromise,
      ownerPayInvalidatePromise
    ]);

    expect(custPayEvent.type).toBe('check:payment-updated');
    expect(custPayEvent.data.checkId).toBe(checkId);
    expect(custPayEvent.data.isPaid).toBe(true);
    expect(custPayEvent.data.method).toBe('telebirr');
    expect(custPayEvent.data.total).toBe(250);
    expect(ownerPayInvalidate.type).toBe('checks:invalidate');
  });
});
