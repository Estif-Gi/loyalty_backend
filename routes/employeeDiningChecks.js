const express = require('express');
const router = express.Router();
const employeeDiningCheckController = require('../controllers/employeeDiningCheckController');
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

// List dining checks with filters (?payment=unpaid|paid, ?tableId=...)
router.get(
  '/',
  verifyToken,
  employeeDiningCheckController.getEmployeeDiningChecks
);

// Get single dining check details
router.get(
  '/:checkId',
  verifyToken,
  employeeDiningCheckController.getEmployeeDiningCheckById
);

// Record payment for a dining check (PATCH or POST alias)
router.patch(
  '/:checkId/payment',
  verifyToken,
  upload.handlePaymentProofUpload,
  employeeDiningCheckController.updateDiningCheckPayment
);

router.post(
  '/:checkId/pay',
  verifyToken,
  upload.handlePaymentProofUpload,
  employeeDiningCheckController.updateDiningCheckPayment
);

router.post(
  '/:checkId/payment',
  verifyToken,
  upload.handlePaymentProofUpload,
  employeeDiningCheckController.updateDiningCheckPayment
);

module.exports = router;
