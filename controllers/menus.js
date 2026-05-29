const Menu = require('../model/menu');
const Restaurant = require('../model/restaurant');

exports.createMenu = async (req, res) => {
    try {
        const { restaurantId, items } = req.body;

        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const menu = new Menu({
            restaurant: restaurantId,
            items: items || []
        });

        await menu.save();

        // Add menu to restaurant
        restaurant.menu.push(menu._id);
        await restaurant.save();

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
        const menu = await Menu.findById(req.params.id).populate('restaurant');
        
        if (!menu) {
            return res.status(404).json({ message: 'Menu not found' });
        }

        // Authorization check
        const restaurant = menu.restaurant;
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        menu.items.push(...items);
        await menu.save();

        res.json(menu);
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
        if (items) menu.items = items;

        await menu.save();
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
                await restaurant.save();
            }
        }

        res.json({ message: 'Menu deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
