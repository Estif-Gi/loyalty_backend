const { getProfileSocket } = require('../controllers/users');
const { registerUser, removeUser } = require('./socketManager');
const Employee = require('../model/employee');

async function registerUserSockets(socket) {
  const userId = socket.user.id;
  const userRole = socket.user.role;

  // Register this user's socket and join a user-specific room
  registerUser(userId, socket.id);
  socket.join(userId.toString());
  console.log(`✅ Socket connected: ${socket.id} | user/employee: ${userId} | role: ${userRole}`);

  // Employee-specific room joining
  if (userRole === 'employee') {
    try {
      const employee = await Employee.findById(userId);
      if (employee && employee.isActive) {
        const restaurantRoom = `restaurant:${employee.restaurant.toString()}`;
        const employeeRoom = `employee:${employee._id.toString()}`;
        
        socket.join(restaurantRoom);
        socket.join(employeeRoom);
        console.log(`✅ Employee ${userId} joined room ${restaurantRoom} and ${employeeRoom}`);
        
        /**
         * FUTURE ORDER SOCKET EVENTS ROADMAP:
         * 
         * 1. Room "restaurant:<restaurantId>":
         *    - Staff members (chef, waiter, cashier) subscribe to this room.
         *    - When a customer places a new order, the server emits "order:new" to this room.
         *    - Any staff member who has the order workflow updates it, emitting "order:status-changed" to this room.
         * 
         * 2. Room "employee:<employeeId>":
         *    - Specific employee receives direct alerts.
         *    - For example, when a waiter is assigned/claims an order, they receive "order:claimed".
         *    - Custom notifications or status warnings could be pushed here.
         * 
         * Future Events list:
         *    - "order:new": Dispatched when customer successfully places a physical presence-verified order.
         *    - "order:status-changed": Emitted when workflow moves (e.g. from PLACED to PREPARING).
         *    - "order:claimed": Sent when a waiter claims a ready order to serve.
         *    - "order:completed": Sent when order status transitions to COMPLETED.
         */
      }
    } catch (err) {
      console.error(`🔥 Error joining employee rooms for socket ${socket.id}:`, err);
    }
  }

  socket.on('getProfile', async () => {
    try {
      const profile = await getProfileSocket(userId);
      socket.emit('profileData', { success: true, data: profile });
    } catch (err) {
      socket.emit('profileData', { success: false, message: err.message });
    }
  });

  socket.on('disconnect', () => {
    removeUser(userId, socket.id);   // ← clean up only this socket
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
}

module.exports = { registerUserSockets };