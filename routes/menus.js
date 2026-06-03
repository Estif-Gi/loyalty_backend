const express = require('express');
const router = express.Router();
const menusController = require('../controllers/menus');
const { verifyToken, checkRole } = require('../middleware/auth');

// Create menu
// router.post('/', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.createMenu);

// Get menu by restaurant
router.get('/restaurant/:restaurantId', menusController.getMenuByRestaurant);

// Add items to a specific menu
router.patch('/:id/items', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.addMenuItems);

// Update a specific menu item
router.patch('/:id/items/:itemId', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.updateMenuItem);

// Remove specific items from a menu
router.delete('/:id/items', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.removeMenuItems);

// Update a menu (replace fields like `items`)
router.put('/:id', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.updateMenu);

// Delete a menu
router.delete('/:id', verifyToken, checkRole('owner', 'manager', 'employee'), menusController.deleteMenu);

//add an item removal method for  menu items 
module.exports = router;
