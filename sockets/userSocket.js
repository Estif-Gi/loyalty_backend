const { getProfileSocket } = require('../controllers/users');
const { registerUser, removeUser } = require('./socketManager');

function registerUserSockets(socket) {
  const userId = socket.user.id;

  // Register this user's socket and join a user-specific room
  registerUser(userId, socket.id);
  socket.join(userId.toString());
  console.log(`✅ Socket connected: ${socket.id} | user: ${userId}`);

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