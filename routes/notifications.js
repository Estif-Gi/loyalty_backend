const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications');
const { verifyToken, checkRole } = require('../middleware/auth');

router.post(
  '/',
  verifyToken,
  checkRole('owner', 'admin'),
  notificationsController.createNotification
);

router.post(
  '/targeted',
  verifyToken,
  checkRole('owner', 'admin'),
  notificationsController.createStampNotification
);

router.get(
  '/',
  verifyToken,
  checkRole('owner', 'admin', 'employee'),
  notificationsController.getNotifications
);

module.exports = router;
