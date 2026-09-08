const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { validateCreateOrder } = require('../validators/orderValidator');

router.post(
  '/',
  verifyToken,
  validateCreateOrder,
  orderController.placeOrder
);

router.get(
  '/my',
  verifyToken,
  orderController.getMyOrders
);

router.get(
  '/history',
  verifyToken,
  orderController.getOrderHistory
);

router.get(
  '/:orderId',
  verifyToken,
  orderController.getCustomerOrder
);

module.exports = router;
