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
const Employee = require('../../model/employee');
const DiningCheck = require('../../model/diningCheck');
const { hashToken } = require('../../services/qrCodeService');
const { SYSTEM_STATES, PAYMENT_METHODS, ORDER_ERROR_CODES } = require('../../constants/orders');

describe('DiningCheck Payment Settlement API & Realtime Tests', () => {
  let testHttpServer;
  let serverPort;
  let activeSockets = [];

  let customerUser, customerToken;
  let ownerUserA, ownerTokenA;
  let ownerUserB, ownerTokenB;
  let waiterA, waiterTokenA;
  let cashierA, cashierTokenA;
  let chefA, chefTokenA;
  let waiterB, waiterTokenB;
  let restaurantA, restaurantB;
  let tableA;
  let qrCodeA;
  let sessionA;
  let sampleOrder;
  let sampleCheck;

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
    await Employee.deleteMany({});
    await Restaurant.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    customerUser = await User.create({
      name: 'Customer Dave',
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
      name: 'Restaurant Alpha',
      phone: '+251944444444',
      location: 'Bole',
      owner: ownerUserA._id,
      orderingEnabled: true
    });

    restaurantB = await Restaurant.create({
      name: 'Restaurant Beta',
      phone: '+251955555555',
      location: 'Kazanchis',
      owner: ownerUserB._id,
      orderingEnabled: true
    });

    // 3. Employees
    waiterA = await Employee.create({
      name: 'Waiter Wendy',
      restaurant: restaurantA._id,
      role: 'waiter',
      password: 'password123',
      isActive: true
    });
    waiterTokenA = jwt.sign({ id: waiterA._id, role: 'employee' }, process.env.JWT_SECRET);

    cashierA = await Employee.create({
      name: 'Cashier Chris',
      restaurant: restaurantA._id,
      role: 'cashier',
      password: 'password123',
      isActive: true
    });
    cashierTokenA = jwt.sign({ id: cashierA._id, role: 'employee' }, process.env.JWT_SECRET);

    chefA = await Employee.create({
      name: 'Chef Carlos',
      restaurant: restaurantA._id,
      role: 'chef',
      password: 'password123',
      isActive: true
    });
    chefTokenA = jwt.sign({ id: chefA._id, role: 'employee' }, process.env.JWT_SECRET);

    waiterB = await Employee.create({
      name: 'Waiter Walter B',
      restaurant: restaurantB._id,
      role: 'waiter',
      password: 'password123',
      isActive: true
    });
    waiterTokenB = jwt.sign({ id: waiterB._id, role: 'employee' }, process.env.JWT_SECRET);

    // 4. Table & QR & Session
    tableA = await RestaurantTable.create({
      restaurant: restaurantA._id,
      name: 'Table 10',
      code: 'T10',
      capacity: 4,
      isActive: true,
      assignedWaiter: waiterA._id
    });

    qrCodeA = await RestaurantQrCode.create({
      restaurant: restaurantA._id,
      table: tableA._id,
      tokenHash: hashToken('token_pay_test'),
      isActive: true,
      createdBy: ownerUserA._id
    });

    sessionA = await OrderSession.create({
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      qrCode: qrCodeA._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 3600000)
    });

    // 5. Seed initial order & dining check
    sampleOrder = await Order.create({
      orderNumber: 'ORD-PAY-001',
      customer: customerUser._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      orderSession: sessionA._id,
      items: [
        {
          menuItemId: new mongoose.Types.ObjectId(),
          name: 'Steak',
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500
        }
      ],
      pricing: {
        subtotal: 500,
        tax: 75,
        total: 575,
        currency: 'ETB'
      },
      currentStepKey: 'placed',
      systemState: SYSTEM_STATES.OPEN,
      idempotencyKey: 'pay-test-key-1',
      workflow: {
        version: 1,
        steps: [
          { key: 'placed', label: 'Placed', systemState: SYSTEM_STATES.OPEN, order: 1, enabled: true, required: true },
          { key: 'served', label: 'Served', systemState: SYSTEM_STATES.IN_PROGRESS, order: 2, enabled: true, required: true },
          { key: 'completed', label: 'Completed', systemState: SYSTEM_STATES.COMPLETED, order: 3, enabled: true, required: true }
        ]
      },
      service: {
        waiter: waiterA._id
      }
    });

    sampleCheck = await DiningCheck.findById(sampleOrder.diningCheck);
  }, 60000);

  test('1. Waiter with orders:payment successfully settles payment via PATCH /dining-checks/:checkId/payment (default cash)', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.check.payment.isPaid).toBe(true);
    expect(res.body.data.check.payment.method).toBe('cash');
    expect(res.body.data.check.payment.paidAt).toBeTruthy();

    const dbCheck = await DiningCheck.findById(sampleCheck._id);
    expect(dbCheck.payment.isPaid).toBe(true);
    expect(dbCheck.payment.method).toBe('cash');
  });

  test('2. Cashier with orders:payment successfully settles payment with method "telebirr"', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'telebirr' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.check.payment.isPaid).toBe(true);
    expect(res.body.data.check.payment.method).toBe('telebirr');

    const dbCheck = await DiningCheck.findById(sampleCheck._id);
    expect(dbCheck.payment.method).toBe('telebirr');
  });

  test('3. Restaurant owner successfully settles payment with method "card"', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ method: 'card' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.check.payment.isPaid).toBe(true);
    expect(res.body.data.check.payment.method).toBe('card');
  });

  test('4. POST /dining-checks/:checkId/pay alias functions equivalently', async () => {
    const res = await request(app)
      .post(`/api/employee/dining-checks/${sampleCheck._id}/pay`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'card' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.check.payment.isPaid).toBe(true);
    expect(res.body.data.check.payment.method).toBe('card');
  });

  test('5. Chef role without orders:payment is denied with 403 ORDER_PAYMENT_PERMISSION_DENIED', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${chefTokenA}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(ORDER_ERROR_CODES.ORDER_PAYMENT_PERMISSION_DENIED);
  });

  test('6. Employee from another restaurant is denied with 403 DINING_CHECK_ACCESS_DENIED', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${waiterTokenB}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('7. Customer role is denied with 403 DINING_CHECK_ACCESS_DENIED', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('8. Already paid check returns 409 DINING_CHECK_ALREADY_PAID (idempotency check)', async () => {
    // Settle payment first
    await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'cash' });

    // Attempt second payment
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(ORDER_ERROR_CODES.DINING_CHECK_ALREADY_PAID);
  });

  test('9. Cancelled order check cannot be paid if no active orders (returns 400 DINING_CHECK_EMPTY)', async () => {
    sampleOrder.systemState = SYSTEM_STATES.CANCELLED;
    await sampleOrder.save();

    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(ORDER_ERROR_CODES.DINING_CHECK_EMPTY);
  });

  test('10. Invalid payment method returns 400 INVALID_PAYMENT_METHOD', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'bitcoin_invalid' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(ORDER_ERROR_CODES.INVALID_PAYMENT_METHOD);
  });

  test('11. Broadcasts check:payment-updated realtime event via Socket.IO to restaurant and customer rooms', async () => {
    const ownerSocket = await connectSocket(ownerTokenA);
    const custSocket = await connectSocket(customerToken);

    const ownerEventPromise = waitForEvent(ownerSocket, 'check:payment-updated');
    const custEventPromise = waitForEvent(custSocket, 'check:payment-updated');

    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${cashierTokenA}`)
      .send({ method: 'telebirr' });

    expect(res.status).toBe(200);

    const [ownerEvent, custEvent] = await Promise.all([ownerEventPromise, custEventPromise]);

    expect(ownerEvent.type).toBe('check:payment-updated');
    expect(ownerEvent.data.isPaid).toBe(true);
    expect(ownerEvent.data.method).toBe('telebirr');

    expect(custEvent.type).toBe('check:payment-updated');
    expect(custEvent.data.isPaid).toBe(true);
    expect(custEvent.data.method).toBe('telebirr');
  });

  test('12. Waiter optionally attaches payment proof link and it is saved with check', async () => {
    const proofUrl = 'https://res.cloudinary.com/loyaltyImages/image/upload/v12345/receipt_proof.jpg';

    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({
        method: 'telebirr',
        proofUrl
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.check.payment.isPaid).toBe(true);
    expect(res.body.data.check.payment.method).toBe('telebirr');
    expect(res.body.data.check.payment.proofUrl).toBe(proofUrl);

    const dbCheck = await DiningCheck.findById(sampleCheck._id);
    expect(dbCheck.payment.proofUrl).toBe(proofUrl);
  });

  test('13. Response contains authoritative DiningCheck DTO with totals and payment status', async () => {
    const res = await request(app)
      .patch(`/api/employee/dining-checks/${sampleCheck._id}/payment`)
      .set('Authorization', `Bearer ${waiterTokenA}`)
      .send({ method: 'cash' });

    expect(res.status).toBe(200);
    const checkData = res.body.data.check;

    expect(checkData.id).toBeTruthy();
    expect(checkData.table).toBeTruthy();
    expect(checkData.totals).toBeTruthy();
    expect(checkData.totals.total).toBe(575);
    expect(checkData.payment).toBeTruthy();
    expect(checkData.payment.isPaid).toBe(true);
    expect(checkData.payment.method).toBe('cash');
    expect(checkData.orders).toHaveLength(1);
    expect(checkData.orderCount).toBe(1);
  });
});
