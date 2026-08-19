const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/orderSessionController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { validateCreateSession, validateVerifyLocation } = require('../validators/orderSessionValidator');

router.post(
  '/',
  verifyToken,
  validateCreateSession,
  sessionController.createOrderSession
);

router.get(
  '/current',
  verifyToken,
  sessionController.getCurrentSession
);

router.post(
  '/:sessionId/verify-location',
  verifyToken,
  validateVerifyLocation,
  sessionController.verifySessionLocation
);

router.post(
  '/:sessionId/cancel',
  verifyToken,
  sessionController.cancelSession
);

module.exports = router;
