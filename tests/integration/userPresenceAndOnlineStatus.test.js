const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { io: ioClient } = require('socket.io-client');
const app = require('../../app');
const User = require('../../model/users');
const Restaurant = require('../../model/restaurant');
const { isUserOnline, clearAllSockets } = require('../../sockets/socketManager');

describe('User Presence, Online Tracking & Admin API Integration Tests', () => {
  let testHttpServer;
  let serverPort;
  let activeSockets = [];

  let adminUser, adminToken;
  let ownerUser, ownerToken;
  let customerUser, customerToken;

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

  function waitForEvent(socket, eventName, timeoutMs = 5000) {
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
  });

  afterAll((done) => {
    while (activeSockets.length > 0) {
      const s = activeSockets.pop();
      if (s && s.connected) s.disconnect();
    }
    clearAllSockets();
    if (testHttpServer && testHttpServer.listening) {
      testHttpServer.close(done);
    } else {
      done();
    }
  });

  beforeEach(async () => {
    clearAllSockets();
    while (activeSockets.length > 0) {
      const s = activeSockets.pop();
      if (s && s.connected) s.disconnect();
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('SecurePassword123!', salt);

    // 1. Admin
    adminUser = await User.create({
      name: 'System Admin Presence',
      phone: '+251911110001',
      password: passwordHash,
      role: 'admin'
    });
    adminToken = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET);

    // 2. Owner
    ownerUser = await User.create({
      name: 'Owner Presence',
      phone: '+251911110002',
      password: passwordHash,
      role: 'owner'
    });
    ownerToken = jwt.sign({ id: ownerUser._id, role: 'owner' }, process.env.JWT_SECRET);

    // 3. Customer
    customerUser = await User.create({
      name: 'Customer Presence',
      phone: '+251911110003',
      password: passwordHash,
      role: 'customer'
    });
    customerToken = jwt.sign({ id: customerUser._id, role: 'customer' }, process.env.JWT_SECRET);
  });

  describe('1. MongoDB: lastLoginAt and lastSeenAt', () => {
    test('user initially has null lastLoginAt and null lastSeenAt', async () => {
      const freshUser = await User.findById(customerUser._id);
      expect(freshUser.lastLoginAt).toBeNull();
      expect(freshUser.lastSeenAt).toBeNull();
    });

    test('login updates both lastLoginAt and lastSeenAt in MongoDB', async () => {
      const beforeLogin = new Date(Date.now() - 1000);

      const loginRes = await request(app)
        .post('/api/users/login')
        .send({
          phone: '0911110003',
          password: 'SecurePassword123!'
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user).toHaveProperty('lastLoginAt');
      expect(loginRes.body.user).toHaveProperty('lastSeenAt');
      expect(loginRes.body.user).toHaveProperty('isOnline');
      expect(new Date(loginRes.body.user.lastLoginAt).getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
      expect(new Date(loginRes.body.user.lastSeenAt).getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());

      const dbUser = await User.findById(customerUser._id);
      expect(dbUser.lastLoginAt).toBeDefined();
      expect(dbUser.lastSeenAt).toBeDefined();
      expect(dbUser.lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
      expect(dbUser.lastSeenAt.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
    });
  });

  describe('2. Socket.IO: isOnline right now', () => {
    test('user is not online before connecting socket', () => {
      expect(isUserOnline(customerUser._id)).toBe(false);
    });

    test('user becomes online upon Socket.IO connection and updates lastSeenAt', async () => {
      const socket = await connectSocket(customerToken);
      expect(socket.connected).toBe(true);

      expect(isUserOnline(customerUser._id)).toBe(true);

      // Verify DB lastSeenAt updated
      await new Promise(r => setTimeout(r, 100));
      const dbUser = await User.findById(customerUser._id);
      expect(dbUser.lastSeenAt).not.toBeNull();
    });

    test('user becomes offline upon Socket.IO disconnection and lastSeenAt records disconnect', async () => {
      const socket = await connectSocket(customerToken);
      expect(isUserOnline(customerUser._id)).toBe(true);

      const disconnectPromise = new Promise(resolve => socket.on('disconnect', resolve));
      socket.disconnect();
      await disconnectPromise;

      // Allow disconnect event handling
      await new Promise(r => setTimeout(r, 200));

      expect(isUserOnline(customerUser._id)).toBe(false);
      const dbUser = await User.findById(customerUser._id);
      expect(dbUser.lastSeenAt).not.toBeNull();
    });

    test('checkUserOnline socket event correctly queries realtime status', async () => {
      const socket = await connectSocket(adminToken);

      // Query customer when offline
      const offlineStatus = await new Promise(resolve => {
        socket.emit('checkUserOnline', { userId: customerUser._id.toString() }, resolve);
      });
      expect(offlineStatus.success).toBe(true);
      expect(offlineStatus.isOnline).toBe(false);

      // Connect customer socket
      const customerSocket = await connectSocket(customerToken);
      expect(customerSocket.connected).toBe(true);

      // Query customer when online
      const onlineStatus = await new Promise(resolve => {
        socket.emit('checkUserOnline', { userId: customerUser._id.toString() }, resolve);
      });
      expect(onlineStatus.success).toBe(true);
      expect(onlineStatus.isOnline).toBe(true);
    });
  });

  describe('3. Admin API: returns all three (lastLoginAt, lastSeenAt, isOnline)', () => {
    test('GET /api/users returns lastLoginAt, lastSeenAt, and isOnline for all users', async () => {
      // Connect customer socket to make customer online
      const customerSocket = await connectSocket(customerToken);
      expect(customerSocket.connected).toBe(true);

      // Log in owner to set lastLoginAt
      await request(app)
        .post('/api/users/login')
        .send({ phone: '0911110002', password: 'SecurePassword123!' });

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      for (const u of res.body) {
        expect(u).toHaveProperty('lastLoginAt');
        expect(u).toHaveProperty('lastSeenAt');
        expect(u).toHaveProperty('isOnline');
      }

      const returnedCustomer = res.body.find(u => u._id.toString() === customerUser._id.toString());
      expect(returnedCustomer).toBeDefined();
      expect(returnedCustomer.isOnline).toBe(true);
      expect(returnedCustomer.lastSeenAt).not.toBeNull();

      const returnedOwner = res.body.find(u => u._id.toString() === ownerUser._id.toString());
      expect(returnedOwner).toBeDefined();
      expect(returnedOwner.lastLoginAt).not.toBeNull();
      expect(returnedOwner.isOnline).toBe(false);
    });

    test('GET /api/users/:id returns lastLoginAt, lastSeenAt, and isOnline for specific user', async () => {
      const customerSocket = await connectSocket(customerToken);
      expect(customerSocket.connected).toBe(true);

      const res = await request(app)
        .get(`/api/users/${customerUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('lastLoginAt');
      expect(res.body).toHaveProperty('lastSeenAt');
      expect(res.body).toHaveProperty('isOnline');
      expect(res.body.isOnline).toBe(true);
      expect(res.body.lastSeenAt).not.toBeNull();
    });

    test('GET /api/admin/users returns lastLoginAt, lastSeenAt, and isOnline in paginated list', async () => {
      const customerSocket = await connectSocket(customerToken);
      expect(customerSocket.connected).toBe(true);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('users');
      expect(res.body.data).toHaveProperty('pagination');
      expect(Array.isArray(res.body.data.users)).toBe(true);

      const returnedCustomer = res.body.data.users.find(u => u.id.toString() === customerUser._id.toString() || u._id.toString() === customerUser._id.toString());
      expect(returnedCustomer).toBeDefined();
      expect(returnedCustomer).toHaveProperty('lastLoginAt');
      expect(returnedCustomer).toHaveProperty('lastSeenAt');
      expect(returnedCustomer).toHaveProperty('isOnline');
      expect(returnedCustomer.isOnline).toBe(true);
    });

    test('GET /api/admin/users/:id returns lastLoginAt, lastSeenAt, and isOnline', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${ownerUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('lastLoginAt');
      expect(res.body.data).toHaveProperty('lastSeenAt');
      expect(res.body.data).toHaveProperty('isOnline');
      expect(res.body.data.isOnline).toBe(false);
    });

    test('GET /api/admin/restaurants/:id returns owner with all three presence fields', async () => {
      const restaurant = await Restaurant.create({
        name: 'Presence Test Restaurant',
        owner: ownerUser._id,
        billingStatus: 'loyal'
      });

      const res = await request(app)
        .get(`/api/admin/restaurants/${restaurant._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.owner).toBeDefined();
      expect(res.body.data.owner).toHaveProperty('lastLoginAt');
      expect(res.body.data.owner).toHaveProperty('lastSeenAt');
      expect(res.body.data.owner).toHaveProperty('isOnline');
      expect(res.body.data.owner.isOnline).toBe(false);
    });
  });
});
