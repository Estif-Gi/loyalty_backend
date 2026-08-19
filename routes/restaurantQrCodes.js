const express = require('express');
const router = express.Router();
const qrCodeController = require('../controllers/restaurantQrCodeController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { validateQrParams, validateQrCodeIdParam } = require('../validators/restaurantQrValidator');

router.post(
  '/:restaurantId/tables/:tableId/qr',
  verifyToken,
  checkRole('owner'),
  validateQrParams,
  qrCodeController.generateQrCode
);

router.get(
  '/:restaurantId/tables/:tableId/qr',
  verifyToken,
  checkRole('owner'),
  validateQrParams,
  qrCodeController.getQrCodeMetadata
);

router.patch(
  '/:restaurantId/tables/:tableId/qr/rotate',
  verifyToken,
  checkRole('owner'),
  validateQrParams,
  qrCodeController.rotateQrCode
);

router.patch(
  '/:restaurantId/tables/:tableId/qr/:qrCodeId/revoke',
  verifyToken,
  checkRole('owner'),
  validateQrParams,
  validateQrCodeIdParam,
  qrCodeController.revokeQrCode
);

module.exports = router;
