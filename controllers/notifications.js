const Notification = require('../model/notifcation');
const Restaurant = require('../model/restaurant');

exports.createNotification = async (req, res) => {
    try {
        const { restaurantId, title, description } = req.body;

        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const notification = new Notification({
            title,
            description
        });

        await notification.save();

        restaurant.notifications.push(notification._id);
        await restaurant.save();

        res.status(201).json(notification);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        // We can get notifications by restaurant if needed
        // Assuming a general fetch for now
        const notifications = await Notification.find().sort({ createdAt: -1 });
        res.json(notifications);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
