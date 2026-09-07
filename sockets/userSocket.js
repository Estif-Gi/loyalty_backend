const { getProfileSocket } = require('../controllers/users');
const { registerUser, removeUser } = require('./socketManager');
const Employee = require('../model/employee');

/**
 * Registers an authenticated socket connection and joins server-derived identity rooms.
 * 
 * Room Namespaces:
 * - customer:<customerId>  — for customer accounts (tab/device synchronization)
 * - employee:<employeeId>  — for active staff (direct waiter notifications)
 * - restaurant:<restaurantId> — for active restaurant staff (invalidation signals)
 * 
 * Clients are NEVER permitted to arbitrarily join rooms. All room memberships
 * are strictly derived by the server from verified JWT identity.
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
        const employeeRoom = `employee:${employee.id}`;

        socket.join(restaurantRoom);
        socket.join(employeeRoom);
        console.log(`✅ Employee ${userId} joined room ${restaurantRoom} and ${employeeRoom}`);
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
    removeUser(userId, socket.id);
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
}

module.exports = { registerUserSockets };