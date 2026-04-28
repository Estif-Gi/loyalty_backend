const express = require('express');
const router = express.Router();
const menusController = require('../controllers/menus');
const { verifyToken, checkRole } = require('../middleware/auth');

// Create menu
router.post('/', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.createMenu);

// Get menu by restaurant
router.get('/restaurant/:restaurantId', menusController.getMenuByRestaurant);

// Add items to a specific menu
router.patch('/:id/items', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.addMenuItems);

//add an item removal method for  menu items 
module.exports = router;
