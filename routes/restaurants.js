const express = require('express');
const router = express.Router();
const restaurantsController = require('../controllers/restaurants');
const { verifyToken, checkRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Create restaurant (only owner)
router.post('/', verifyToken, checkRole('owner'), restaurantsController.createRestaurant);

// Get restaurant details (public)
router.get('/:id', restaurantsController.getRestaurant);

// Upload logo (owner, manager, employee)
router.patch('/:id/logo', verifyToken, checkRole('owner', 'manager', 'employee'), upload.single('logo'), restaurantsController.updateLogo);

// Update other details (owner, manager)
router.patch('/:id', verifyToken, checkRole('owner', 'manager'), restaurantsController.updateRestaurant);

// List restaurant employees (owner, manager)
router.get('/:id/employees', verifyToken, checkRole('owner', 'manager'), restaurantsController.getEmployees);

// Create restaurant employee (owner)
router.post('/:id/employees', verifyToken, checkRole('owner', 'manager'), restaurantsController.createEmployee);
module.exports = router;
