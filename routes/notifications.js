const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications');
const { verifyToken, checkRole } = require('../middleware/auth');

// Create notification
router.post('/', verifyToken, checkRole('owner', 'manager', 'employee'), notificationsController.createNotification);

// Get all notifications
router.get('/', notificationsController.getNotifications);

module.exports = router;
