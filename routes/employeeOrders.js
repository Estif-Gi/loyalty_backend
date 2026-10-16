const express = require('express');
const router = express.Router();
const employeeOrderController = require('../controllers/employeeOrderController');
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

// All queue/transitions operations require token verification
router.get(
  '/',
  verifyToken, // Supports employee and owner roles
  employeeOrderController.getEmployeeOrders
);

const restaurantOrderController = require('../controllers/restaurantOrderController');
router.get(
  '/history',
  verifyToken,
  restaurantOrderController.getRestaurantOrderHistory
);

router.post(
  '/:orderId/advance',
  verifyToken,
  employeeOrderController.advanceOrder
);

router.post(
  '/:orderId/claim',
  verifyToken,
  employeeOrderController.claimOrder
);

router.post(
  '/:orderId/cancel',
  verifyToken,
  employeeOrderController.cancelOrder
);

// Per-order payment is deprecated in favor of DiningCheck payment: PATCH /api/employee/dining-checks/:checkId/payment (Section 21)
router.all('/:orderId/payment', (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'ORDER_PAYMENT_DEPRECATED',
    message: 'Payment per individual order has been deprecated. Use DiningCheck payment endpoint: PATCH /api/employee/dining-checks/:checkId/payment'
  });
});

router.all('/:orderId/pay', (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'ORDER_PAYMENT_DEPRECATED',
    message: 'Payment per individual order has been deprecated. Use DiningCheck payment endpoint: PATCH /api/employee/dining-checks/:checkId/payment'
  });
});

module.exports = router;
