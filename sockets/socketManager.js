const userSockets = new Map(); // userId → socketId

function registerUser(userId, socketId) {
  userSockets.set(userId.toString(), socketId);
}

function removeUser(userId) {
  userSockets.delete(userId.toString());
}

function getSocketId(userId) {
  return userSockets.get(userId.toString());
}

module.exports = { registerUser, removeUser, getSocketId };