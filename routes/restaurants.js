const express = require('express');
const router = express.Router();
const restaurantsController = require('../controllers/restaurants');
const { verifyToken, checkRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Create restaurant (only owner)
router.post('/', verifyToken, checkRole('owner'), restaurantsController.createRestaurant);

// Get restaurant details (public - protected customer projected fields)
router.get('/:id', restaurantsController.getRestaurant);

// GET all restaurants (public - protected customer projected fields)
router.get('/', restaurantsController.getAllRestaurants);

// Upload logo (owner, employee of this restaurant)
router.patch('/:id/logo', verifyToken, checkRole('owner', 'employee'), upload.single('logo'), restaurantsController.updateLogo);

// Update other details (owner only)
router.patch('/:id', verifyToken, checkRole('owner'), restaurantsController.updateRestaurant);

// List restaurant employees (owner only)
router.get('/:id/employees', verifyToken, checkRole('owner'), restaurantsController.getEmployees);

// Get specific restaurant employee details (owner only)
router.get('/:id/employees/:employeeId', verifyToken, checkRole('owner'), restaurantsController.getEmployeeDetails);

// Update restaurant employee role/status (owner only)
router.patch('/:id/employees/:employeeId', verifyToken, checkRole('owner'), restaurantsController.updateEmployee);

// Delete restaurant employee (owner only)
router.delete('/:id/employees/:employeeId', verifyToken, checkRole('owner'), restaurantsController.deleteEmployee);

// Get restaurant by logged-in employee (authenticated employee only)
router.get('/employee/me', verifyToken, restaurantsController.getRestaurantByEmployeeId);

// Employee login (public login endpoint)
router.post('/employee/login', restaurantsController.employeeLogin);

// Create restaurant employee (owner only)
router.post('/:id/employees', verifyToken, checkRole('owner'), restaurantsController.createEmployee);

// Get physical ordering configuration (owner, employee)
router.get('/:id/ordering-config', verifyToken, checkRole('owner', 'employee'), restaurantsController.getOrderingConfig);

// Update physical ordering configuration (owner only)
router.patch('/:id/ordering-config', verifyToken, checkRole('owner'), restaurantsController.updateOrderingConfig);

// Get custom order workflow steps (owner, employee)
router.get('/:id/workflow', verifyToken, checkRole('owner', 'employee'), restaurantsController.getWorkflow);

// Update custom order workflow steps (owner only)
router.patch('/:id/workflow', verifyToken, checkRole('owner'), restaurantsController.updateWorkflow);

// Restaurant order history & orders endpoint
const restaurantOrderController = require('../controllers/restaurantOrderController');
router.get('/:id/orders/history', verifyToken, restaurantOrderController.getRestaurantOrderHistory);
router.get('/:id/orders', verifyToken, restaurantOrderController.getRestaurantOrderHistory);

module.exports = router;
