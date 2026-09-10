const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users');
const { verifyToken, checkRole } = require('../middleware/auth');

router.post('/register', usersController.register);
router.post('/login', usersController.login);
router.get('/profile', verifyToken, usersController.getProfile);

// Only owners, admins, and employees can add stamps
router.post('/stamps', verifyToken, checkRole('owner', 'admin', 'employee'), usersController.addStamps);

// Create user with privileged role (admin only)
router.post('/', verifyToken, checkRole('admin'), usersController.createUserByAdmin);

// Get all users (admin or owner only - adjust roles as needed)
router.get('/', verifyToken, checkRole('admin', 'owner'), usersController.getAllUsers);

// Get user by ID (admin or owner only)
router.get('/:id', verifyToken, checkRole('admin', 'owner'), usersController.getUserById);

// Update user role (admin only)
router.patch('/:id/role', verifyToken, checkRole('admin'), usersController.updateUserRole);

// Save / refresh FCM push token (any authenticated user)
router.patch('/fcm-token', verifyToken, usersController.saveFcmToken); 

module.exports = router;
