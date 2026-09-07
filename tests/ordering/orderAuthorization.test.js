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

describe('Order Authorization and Restaurant Isolation Tests', () => {
  let customerA, customerAToken;
  let customerB, customerBToken;
  let ownerUser;
  let employeeA, employeeAToken;
  let employeeB, employeeBToken;
  let restaurantA, restaurantB, sessionA, menuA, tableA, qrCodeA;
  let orderAId;

  beforeAll(async () => {
    jest.setTimeout(60000);
    await Order.syncIndexes();
  });

  beforeEach(async () => {

    customerA = await User.create({ name: 'Customer A', phone: '+251910000009', password: 'password123', role: 'customer' });
    customerAToken = jwt.sign({ id: customerA._id, role: 'customer' }, process.env.JWT_SECRET);

    customerB = await User.create({ name: 'Customer B', phone: '+251910000010', password: 'password123', role: 'customer' });
    customerBToken = jwt.sign({ id: customerB._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({ name: 'Owner', phone: '+251910000011', password: 'password123', role: 'owner' });

    // Restaurant A
    restaurantA = await Restaurant.create({
      name: 'Restaurant A',
      phone: '+251920000007',
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

    tableA = await RestaurantTable.create({ restaurant: restaurantA._id, name: 'Table A', code: 'TA', isActive: true });
    qrCodeA = await RestaurantQrCode.create({ restaurant: restaurantA._id, table: tableA._id, tokenHash: hashToken('tokenA'), isActive: true, createdBy: ownerUser._id });
    menuA = await Menu.create({ restaurant: restaurantA._id, items: [{ name: 'Fanta', price: 50, category: 'Drinks' }] });
    sessionA = await OrderSession.create({
      customer: customerA._id,
      restaurant: restaurantA._id,
      table: tableA._id,
      qrCode: qrCodeA._id,
      status: 'active',
      locationVerification: { accuracyMeters: 10, distanceMeters: 5, verifiedAt: new Date() },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    // Restaurant B
    restaurantB = await Restaurant.create({ name: 'Restaurant B', phone: '+251920000008', owner: ownerUser._id });

    // Create Employee A (for Restaurant A)
    employeeA = await Employee.create({ name: 'Chef A', password: 'password123', role: 'chef', restaurant: restaurantA._id, isActive: true });
    employeeAToken = jwt.sign({ id: employeeA._id, role: 'employee' }, process.env.JWT_SECRET);

    // Create Employee B (for Restaurant B)
    employeeB = await Employee.create({ name: 'Chef B', password: 'password123', role: 'chef', restaurant: restaurantB._id, isActive: true });
    employeeBToken = jwt.sign({ id: employeeB._id, role: 'employee' }, process.env.JWT_SECRET);

    // Create Waiter for Restaurant A and assign to tableA
    const waiterA = await Employee.create({
      name: 'Waiter A',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurantA._id,
      isActive: true
    });
    tableA.assignedWaiter = waiterA._id;
    await tableA.save();

    // Create Order A
    const orderA = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', 'orderA-idempotency')
      .send({
        orderSessionId: sessionA._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [{ menuItemId: menuA.items[0]._id, quantity: 2 }]
      });
    orderAId = orderA.body.data.order.id;
  });

  test('Customer A can retrieve own order details', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderAId}`)
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order.id).toBe(orderAId);
  });

  test('Customer B is blocked from retrieving Customer A order details', async () => {
    const res = await request(app)
      .get(`/api/orders/${orderAId}`)
      .set('Authorization', `Bearer ${customerBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Employee A can view Restaurant A order queue', async () => {
    const res = await request(app)
      .get('/api/employee/orders')
      .set('Authorization', `Bearer ${employeeAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].id).toBe(orderAId);
  });

  test('Employee B is blocked from retrieving Restaurant A order queue', async () => {
    const res = await request(app)
      .get('/api/employee/orders')
      .set('Authorization', `Bearer ${employeeBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(0); // isolated, no orders for Restaurant B
  });

  test('Employee B is blocked from advancing Restaurant A order step', async () => {
    const res = await request(app)
      .post(`/api/employee/orders/${orderAId}/advance`)
      .set('Authorization', `Bearer ${employeeBToken}`)
      .send({ expectedStep: 'placed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_ACCESS_DENIED');
  });

  test('Owner can view Restaurant A order queue with populated details', async () => {
    const ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/employee/orders')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    
    const order = res.body.data.orders[0];
    expect(order.id).toBe(orderAId);
    
    // Check populated table
    expect(order.table).toBeDefined();
    expect(order.table.name).toBe('Table A');
    expect(order.table.code).toBe('TA');

    // Check populated customer details
    expect(order.customer).toBeDefined();
    expect(order.customer.name).toBe('Customer A');
    expect(order.customer.phone).toBe('+251910000009');
    expect(order.customer.password).toBeUndefined(); // Verify password was not returned

    // Check populated waiter details
    expect(order.service).toBeDefined();
    expect(order.service.waiter).toBeDefined();
    expect(order.service.waiter.name).toBe('Waiter A');
    expect(order.service.waiter.role).toBe('waiter');
  });

  test('Owner can filter order queue by restaurantId', async () => {
    const ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get(`/api/employee/orders?restaurantId=${restaurantA._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBe(1);
    expect(res.body.data.orders[0].id).toBe(orderAId);
  });

  test('Owner is blocked from retrieving queue of restaurant they do not own', async () => {
    // Create another owner
    const otherOwner = await User.create({ name: 'Other Owner', phone: '+251910000099', password: 'password123', role: 'owner' });
    const otherOwnerToken = jwt.sign({ id: otherOwner._id, role: 'owner' }, process.env.JWT_SECRET);

    const res = await request(app)
      .get(`/api/employee/orders?restaurantId=${restaurantA._id}`)
      .set('Authorization', `Bearer ${otherOwnerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_ACCESS_DENIED');
  });
});
