const Menu = require('../model/menu');
const Restaurant = require('../model/restaurant');
const { getRestaurantAndLimits, getLimitsForTier } = require('../utils/billingLimits');

exports.createMenu = async (req, res) => {
    try {
        const { restaurantId, items } = req.body;

        const { restaurant, limits, tier } = await getRestaurantAndLimits(restaurantId);

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const initialCount = items ? items.length : 0;
        if (initialCount > limits.menuItems) {
            return res.status(400).json({
                message: `Menu item limit reached (${initialCount}/${limits.menuItems} items) for the ${tier.toUpperCase()} tier. Please upgrade your plan.`
            });
        }

        const menu = new Menu({
            restaurant: restaurantId,
            items: items || []
        });

        await menu.save();

        // Add menu to restaurant & sync count
        // restaurant.menu.push(menu._id);
        // restaurant.menuItemCount = menu.items.length;
        // await restaurant.save();

        res.status(201).json(menu);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getMenuByRestaurant = async (req, res) => {
    try {
        const menus = await Menu.find({ restaurant: req.params.restaurantId });
        res.json(menus); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.addMenuItems = async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'items must be a non-empty array' });
        }

        // Validate every item has a category
        const missingCategory = items.some(item => !item.category);
        if (missingCategory) {
            return res.status(400).json({ message: 'Every item must include a category field' });
        }

        const menu = await Menu.findById(req.params.id).populate('restaurant');
        if (!menu) {
            return res.status(404).json({ message: 'Menu not found' });
        }

        // Authorization check
        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Duplicate check — block items with the same name already in the menu
        const existingNames = new Set(menu.items.map(i => i.name.toLowerCase()));
        const duplicates = items.filter(i => existingNames.has(i.name.toLowerCase()));
        if (duplicates.length > 0) {
            return res.status(400).json({
                message: `Duplicate items found: ${duplicates.map(i => i.name).join(', ')}. These already exist in the menu.`
            });
        }

        const limits = getLimitsForTier(restaurant.billingStatus || 'free');
        const totalItemsCount = menu.items.length + items.length;
        if (totalItemsCount > limits.menuItems) {
            return res.status(400).json({
                message: `Adding these items would exceed the menu item limit of ${limits.menuItems} for the ${(restaurant.billingStatus || 'free').toUpperCase()} tier. Current: ${menu.items.length}, Requested: ${items.length}. Please upgrade your plan.`
            });
        }

        menu.items.push(...items);
        await menu.save();

        restaurant.menuItemCount = menu.items.length;
        await restaurant.save();

        res.json({items: menu.items , restaurant: restaurant._id});
        // console.log({items: menu.items , restaurant: restaurant._id});
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateMenuItem = async (req, res) => {
    try {
        const { name, description, price } = req.body;
        const menu = await Menu.findById(req.params.id).populate('restaurant');
        if (!menu) return res.status(404).json({ message: 'Menu not found' });

        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const item = menu.items.id(req.params.itemId);
        if (!item) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        if (name !== undefined) item.name = name;
        if (description !== undefined) item.description = description;
        if (price !== undefined) item.price = price;

        await menu.save();
        res.json(menu);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateMenu = async (req, res) => {
    try {
        const menu = await Menu.findById(req.params.id).populate('restaurant');
        if (!menu) return res.status(404).json({ message: 'Menu not found' });

        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const { items } = req.body;
        if (items) {
            const limits = getLimitsForTier(restaurant.billingStatus || 'free');
            if (items.length > limits.menuItems) {
                return res.status(400).json({
                    message: `Updating the menu would exceed the menu item limit of ${limits.menuItems} items for the ${(restaurant.billingStatus || 'free').toUpperCase()} tier. Please upgrade your plan.`
                });
            }
            menu.items = items;
        }

        await menu.save();

        // Sync count
        restaurant.menuItemCount = menu.items.length;
        await restaurant.save();

        res.json(menu);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.removeMenuItems = async (req, res) => {
    try {
        const { itemIds } = req.body; // expect array of subdocument ids
        
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
            return res.status(400).json({ message: 'itemIds must be a non-empty array' });
        }

        const menu = await Menu.findById(req.params.id).populate('restaurant');
        if (!menu) return res.status(404).json({ message: 'Menu not found' });

        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const updatedMenu = await Menu.findByIdAndUpdate(
            req.params.id,
            { $pull: { items: { _id: { $in: itemIds } } } },
            { new: true }
        );

        // Sync count
        restaurant.menuItemCount = updatedMenu.items.length;
        await restaurant.save();

        res.json(updatedMenu);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteMenu = async (req, res) => {
    try {
        const menu = await Menu.findById(req.params.id).populate('restaurant');
        if (!menu) return res.status(404).json({ message: 'Menu not found' });

        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        await Menu.findByIdAndDelete(req.params.id);

        // If restaurant has a menu array, remove reference
        if (restaurant.menu && Array.isArray(restaurant.menu)) {
            const idx = restaurant.menu.findIndex(m => m.toString() === req.params.id);
            if (idx > -1) {
                restaurant.menu.splice(idx, 1);
            }
        }

        // Reset menuItemCount to 0 and save
        restaurant.menuItemCount = 0;
        await restaurant.save();

        res.json({ message: 'Menu deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
