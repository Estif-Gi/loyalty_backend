const express = require('express');
const router = express.Router();
const loyaltyProgramsController = require('../controllers/loyalty_programs');
const { verifyToken, checkRole } = require('../middleware/auth');

// Setup program (owner only)
router.post('/', verifyToken, checkRole('owner'), loyaltyProgramsController.setupProgram);

// Get programs by restaurant
router.get('/restaurant/:restaurantId', loyaltyProgramsController.getProgramByRestaurant);

// Update program (owner only)
router.patch('/:programId', verifyToken, checkRole('owner'), loyaltyProgramsController.updateProgram);

// Add a single reward (owner only)
router.post('/:programId/rewards', verifyToken, checkRole('owner'), loyaltyProgramsController.addReward);

// Remove a single reward (owner only)
router.delete('/:programId/rewards/:rewardId', verifyToken, checkRole('owner'), loyaltyProgramsController.removeReward);

module.exports = router;
