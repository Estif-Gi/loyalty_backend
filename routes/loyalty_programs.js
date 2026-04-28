const express = require('express');
const router = express.Router();
const loyaltyProgramsController = require('../controllers/loyalty_programs');
const { verifyToken, checkRole } = require('../middleware/auth');

// Setup program (owner, manager)
router.post('/', verifyToken, checkRole('owner', 'manager'), loyaltyProgramsController.setupProgram);

// Get programs by restaurant
router.get('/restaurant/:restaurantId', loyaltyProgramsController.getProgramByRestaurant);

// Update program (owner, manager)
router.patch('/:programId', verifyToken, checkRole('owner', 'manager'), loyaltyProgramsController.updateProgram);

// Add a single reward
router.post('/:programId/rewards', verifyToken, checkRole('owner', 'manager'), loyaltyProgramsController.addReward);

// Remove a single reward
router.delete('/:programId/rewards/:rewardId', verifyToken, checkRole('owner', 'manager'), loyaltyProgramsController.removeReward);

module.exports = router;
