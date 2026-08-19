const jwt = require('jsonwebtoken');
const Employee = require('../model/employee');
const ROLE_PERMISSIONS = require('../config/permissions');

module.exports = async (socket, next) => {
  const token = socket.handshake.auth?.token
    || socket.handshake.headers?.authorization?.split(' ')[1];

  if (!token) return next(new Error('Authentication error: no token'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // { id, role }

    if (decoded.role === 'employee') {
      const employee = await Employee.findById(decoded.id);
      if (!employee) {
        return next(new Error('Authentication error: employee not found'));
      }
      if (!employee.isActive) {
        return next(new Error('Authentication error: employee inactive'));
      }
      socket.employee = {
        id: employee._id.toString(),
        restaurantId: employee.restaurant.toString(),
        role: employee.role,
        permissions: ROLE_PERMISSIONS[employee.role] || [],
        isActive: employee.isActive
      };
    }
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
};