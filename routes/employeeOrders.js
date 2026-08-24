const express = require('express');
const router = express.Router();
const employeeOrderController = require('../controllers/employeeOrderController');
const { verifyToken } = require('../middleware/auth');

// All queue/transitions operations require token verification
router.get(
  '/',
  verifyToken, // Supports employee and owner roles
  employeeOrderController.getEmployeeOrders
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

module.exports = router;
