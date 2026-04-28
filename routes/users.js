const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users');
const { verifyToken, checkRole } = require('../middleware/auth');

router.post('/register', usersController.register);
router.post('/login', usersController.login);
router.get('/profile', verifyToken, usersController.getProfile);

// Only owners, managers, and employees can add stamps
router.post('/stamps', verifyToken, checkRole('owner', 'manager', 'employee'), usersController.addStamps);

// Get all users (admin or owner only - adjust roles as needed)
router.get('/', verifyToken, checkRole('admin', 'owner'), usersController.getAllUsers);

// Get user by ID (admin or owner only)
router.get('/:id', verifyToken, checkRole('admin', 'owner'), usersController.getUserById);

module.exports = router;
