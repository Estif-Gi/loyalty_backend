const express = require('express');
const router = express.Router();
const ownerDiningCheckController = require('../controllers/ownerDiningCheckController');
const { verifyToken } = require('../middleware/auth');

// Owner paginated dining check history
router.get(
  '/history',
  verifyToken,
  ownerDiningCheckController.getOwnerDiningChecksHistory
);

// Owner single dining check details
router.get(
  '/:checkId',
  verifyToken,
  ownerDiningCheckController.getOwnerDiningCheckDetails
);

module.exports = router;
