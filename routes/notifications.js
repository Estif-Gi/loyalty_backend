// routes/notifications.js
const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications');
const { verifyToken, checkRole } = require('../middleware/auth');

router.post(
  '/',
  verifyToken,
  checkRole('owner', 'manager', 'employee'),
  notificationsController.createNotification
);

router.get(
  '/',
  verifyToken,
  checkRole('owner', 'manager', 'employee'),
  notificationsController.getNotifications
);

module.exports = router;
