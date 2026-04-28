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
