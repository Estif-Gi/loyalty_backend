const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, checkRole } = require('../middleware/auth');

// All admin routes strictly require authentication and 'admin' role
router.use(verifyToken);
router.use(checkRole('admin'));

// 1. Dashboard summary
router.get('/dashboard/summary', adminController.getDashboardSummary);

// 2. Billing plans metadata
router.get('/billing/plans', adminController.getBillingPlans);

// 3. Restaurant management
router.post('/restaurants', adminController.createRestaurant);
router.get('/restaurants', adminController.getRestaurants);
router.get('/restaurants/:id', adminController.getRestaurantById);
router.patch('/restaurants/:id', adminController.updateRestaurant);
router.patch('/restaurants/:id/billing', adminController.updateRestaurantBilling);

// 4. Owner management
router.patch('/owners/:ownerId/password', adminController.resetOwnerPassword);

module.exports = router;
