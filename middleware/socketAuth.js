const jwt = require('jsonwebtoken');

module.exports = (socket, next) => {
  const token = socket.handshake.auth?.token
    || socket.handshake.headers?.authorization?.split(' ')[1];

  if (!token) return next(new Error('Authentication error: no token'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // { id, role }
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
};