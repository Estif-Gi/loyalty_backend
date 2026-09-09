const mongoose = require('mongoose');
const { getProfileSocket } = require('../controllers/users');
const { registerUser, removeUser } = require('./socketManager');
const Employee = require('../model/employee');
const Restaurant = require('../model/restaurant');
const Order = require('../model/order');

/**
 * Registers an authenticated socket connection and joins server-derived identity rooms.
 * 
 * Room Namespaces:
 * - customer:<customerId>     — for customer accounts (tab/device synchronization)
 * - employee:<employeeId>     — for active staff (direct waiter notifications)
 * - restaurant:<restaurantId> — for active restaurant staff & owner (realtime orders & invalidation signals)
 * - orders:<restaurantId>     — alias for restaurant order room
 * - order:<orderId>           — individual order room
 * 
 * Clients are registered into server-derived identity rooms upon connection.
 * Authenticated dynamic room join events are also supported with strict authorization checks.
 * 
 * @param {import('socket.io').Socket} socket 
 */
async function registerUserSockets(socket) {
  const userId = socket.user?.id;
  const userRole = socket.user?.role;

  if (!userId) {
    return socket.disconnect(true);
  }

  // Register socket in tracker
  registerUser(userId, socket.id);

  // Register event listeners immediately (synchronously) so no events are dropped during async initialization
  socket.on('joinRestaurant', async (payload, callback) => {
    try {
      const restId = typeof payload === 'object' ? payload?.restaurantId : payload;
      if (!restId || !mongoose.isValidObjectId(restId)) {
        if (typeof callback === 'function') callback({ success: false, message: 'Invalid restaurantId' });
        return;
      }

      let isAuthorized = false;
      if (userRole === 'admin') {
        isAuthorized = true;
      } else if (userRole === 'owner') {
        const owned = await Restaurant.findOne({ _id: restId, owner: userId }).select('_id');
        if (owned) isAuthorized = true;
      } else if (userRole === 'employee') {
        if (socket.employee?.restaurantId === restId.toString()) {
          isAuthorized = true;
        } else {
          const emp = await Employee.findOne({ _id: userId, restaurant: restId, isActive: true });
          if (emp) isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        if (typeof callback === 'function') callback({ success: false, message: 'Not authorized for this restaurant' });
        return;
      }

      socket.join(`restaurant:${restId}`);
      socket.join(`orders:${restId}`);
      console.log(`✅ Socket ${socket.id} joined restaurant:${restId} and orders:${restId}`);
      if (typeof callback === 'function') callback({ success: true, room: `restaurant:${restId}` });
    } catch (err) {
      console.error(`🔥 Error in joinRestaurant handler:`, err);
      if (typeof callback === 'function') callback({ success: false, message: err.message });
    }
  });

  socket.on('joinOrder', async (payload, callback) => {
    try {
      const orderId = typeof payload === 'object' ? payload?.orderId : payload;
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        if (typeof callback === 'function') callback({ success: false, message: 'Invalid orderId' });
        return;
      }

      const order = await Order.findById(orderId).select('customer restaurant');
      if (!order) {
        if (typeof callback === 'function') callback({ success: false, message: 'Order not found' });
        return;
      }

      let isAuthorized = false;
      if (userRole === 'admin') {
        isAuthorized = true;
      } else if (userRole === 'customer' && order.customer?.toString() === userId.toString()) {
        isAuthorized = true;
      } else if (userRole === 'owner') {
        const owned = await Restaurant.findOne({ _id: order.restaurant, owner: userId }).select('_id');
        if (owned) isAuthorized = true;
      } else if (userRole === 'employee') {
        if (socket.employee?.restaurantId === order.restaurant.toString()) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        if (typeof callback === 'function') callback({ success: false, message: 'Not authorized for this order' });
        return;
      }

      socket.join(`order:${orderId}`);
      console.log(`✅ Socket ${socket.id} joined order:${orderId}`);
      if (typeof callback === 'function') callback({ success: true, room: `order:${orderId}` });
    } catch (err) {
      console.error(`🔥 Error in joinOrder handler:`, err);
      if (typeof callback === 'function') callback({ success: false, message: err.message });
    }
  });

  socket.on('joinOrderRoom', async (payload, callback) => {
    const restId = payload?.restaurantId;
    const orderId = payload?.orderId;
    if (orderId) {
      const listeners = socket.listeners('joinOrder');
      if (listeners.length > 0) return listeners[0](payload, callback);
    }
    if (restId) {
      const listeners = socket.listeners('joinRestaurant');
      if (listeners.length > 0) return listeners[0](payload, callback);
    }
    if (typeof callback === 'function') callback({ success: false, message: 'Either restaurantId or orderId is required' });
  });

  socket.on('leaveRestaurant', (payload, callback) => {
    const restId = typeof payload === 'object' ? payload?.restaurantId : payload;
    if (restId) {
      socket.leave(`restaurant:${restId}`);
      socket.leave(`orders:${restId}`);
    }
    if (typeof callback === 'function') callback({ success: true });
  });

  socket.on('getProfile', async () => {
    try {
      const profile = await getProfileSocket(userId);
      socket.emit('profileData', { success: true, data: profile });
    } catch (err) {
      socket.emit('profileData', { success: false, message: err.message });
    }
  });

  socket.on('disconnect', () => {
    removeUser(userId, socket.id);
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });

  // Async server-derived identity room assignments
  // 1. Customer Room Assignment
  if (userRole === 'customer') {
    const customerRoom = `customer:${userId.toString()}`;
    socket.join(customerRoom);
    console.log(`✅ Customer ${userId} joined room ${customerRoom}`);
  }

  // 2. Employee Room Assignment
  if (userRole === 'employee') {
    try {
      let employee = socket.employee;
      if (!employee) {
        const empDoc = await Employee.findById(userId);
        if (empDoc && empDoc.isActive) {
          employee = {
            id: empDoc._id.toString(),
            restaurantId: empDoc.restaurant.toString(),
            role: empDoc.role,
            isActive: empDoc.isActive
          };
        }
      }

      if (employee && employee.isActive) {
        const restaurantRoom = `restaurant:${employee.restaurantId}`;
        const ordersRoom = `orders:${employee.restaurantId}`;
        const employeeRoom = `employee:${employee.id}`;

        socket.join(restaurantRoom);
        socket.join(ordersRoom);
        socket.join(employeeRoom);
        console.log(`✅ Employee ${userId} joined rooms ${restaurantRoom}, ${ordersRoom} and ${employeeRoom}`);
      }
    } catch (err) {
      console.error(`🔥 Error joining employee rooms for socket ${socket.id}:`, err);
    }
  }

  // 3. Restaurant Owner Room Assignment
  if (userRole === 'owner') {
    try {
      const ownedRestaurants = await Restaurant.find({ owner: userId }).select('_id');
      for (const r of ownedRestaurants) {
        const restId = r._id.toString();
        socket.join(`restaurant:${restId}`);
        socket.join(`orders:${restId}`);
        console.log(`✅ Owner ${userId} joined rooms restaurant:${restId} and orders:${restId}`);
      }

      const handshakeRestId = socket.handshake?.auth?.restaurantId || socket.handshake?.query?.restaurantId;
      if (handshakeRestId && mongoose.isValidObjectId(handshakeRestId)) {
        const isOwner = ownedRestaurants.some(r => r._id.toString() === handshakeRestId.toString());
        if (isOwner) {
          socket.join(`restaurant:${handshakeRestId}`);
          socket.join(`orders:${handshakeRestId}`);
        }
      }
    } catch (err) {
      console.error(`🔥 Error joining owner restaurant rooms for socket ${socket.id}:`, err);
    }
  }
}

module.exports = { registerUserSockets };