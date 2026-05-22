const userSockets = new Map(); // userId → Set<socketId>

function registerUser(userId, socketId) {
  const key = userId.toString();
  if (!userSockets.has(key)) {
    userSockets.set(key, new Set());
  }
  userSockets.get(key).add(socketId);
}

function removeUser(userId, socketId) {
  const key = userId.toString();
  const sockets = userSockets.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(key);
  }
}

function getSocketId(userId) {
  const sockets = userSockets.get(userId.toString());
  if (!sockets || sockets.size === 0) return null;
  return sockets.values().next().value;
}

module.exports = { registerUser, removeUser, getSocketId };