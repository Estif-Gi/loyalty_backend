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

describe('Order Pricing Guard Tests', () => {
  let customerUser, customerToken;
  let ownerUser;
  let restaurant, table, qrCode, menu, session;
  const rawQrToken = 'raw_qr_pricing_test';
  let mockMenuItemId;

  beforeEach(async () => {
    await Order.syncIndexes();

    customerUser = await User.create({
      name: 'Pricing Customer',
      phone: '+251910000003',
      password: 'password123',
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);

    ownerUser = await User.create({
      name: 'Pricing Owner',
      phone: '+251910000004',
      password: 'password123',
      role: 'owner'
    });

    restaurant = await Restaurant.create({
      name: 'Pricing Cafe',
      phone: '+251920000004',
      owner: ownerUser._id,
      orderingEnabled: true,
      orderingLocation: { type: 'Point', coordinates: [38.7500, 9.0200] },
      orderingRadiusMeters: 100,
      orderWorkflow: [
        { key: 'placed', label: 'Placed', systemState: 'OPEN', enabled: true, required: true, order: 1, actionRoles: ['chef'] },
        { key: 'completed', label: 'Done', systemState: 'COMPLETED', enabled: true, required: true, order: 2, actionRoles: ['cashier'] }
      ]
    });

    table = await RestaurantTable.create({
      restaurant: restaurant._id,
      name: 'Table 5',
      code: 'T5',
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
      items: [
        { name: 'Burger Premium', price: 300, category: 'Mains' }
      ]
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

    const waiter = await Employee.create({
      name: 'Waiter Hana',
      password: 'password123',
      role: 'waiter',
      restaurant: restaurant._id,
      isActive: true
    });
    table.assignedWaiter = waiter._id;
    await table.save();
  });

  test('Ignore fake low price sent by the client, use Mongoose database price instead', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'pricing-idempotency-key')
      .send({
        orderSessionId: session._id,
        location: { latitude: 9.0201, longitude: 38.7501, accuracy: 15 },
        items: [
          {
            menuItemId: mockMenuItemId,
            quantity: 3,
            unitPrice: 10, // A malicious client tries to set a cheap price of 10 ETB instead of 300 ETB
            lineTotal: 30
          }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify subtotal/total calculation is verified server-side: 300 * 3 = 900
    expect(res.body.data.order.pricing.total).toBe(900);
    expect(res.body.data.order.items[0].unitPrice).toBe(300);
    expect(res.body.data.order.items[0].lineTotal).toBe(900);
  });
});
