const User = require('../model/users');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Restaurant = require('../model/restaurant');

exports.register = async (req, res) => {
    try {
        const { name, phone, password, role } = req.body;

        // Check if user exists
        let user = await User.findOne({ phone });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({
            name,
            phone,
            password: hashedPassword,
            role: role || 'customer'
        });

        await user.save();

        const payload = { id: user._id, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ token, user: { id: user._id, name: user.name, role: user.role , loyalTo: user.loyalTo} });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.login = async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        if (!password || !user.password) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const payload = { id: user._id, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ token, user: { id: user._id, name: user.name, role: user.role, loyalTo: user.loyalTo } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password').lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (['owner', 'manager', 'employee'].includes(user.role)) {
            const restaurant = await Restaurant.findOne({ owner: req.user.id });
            if (restaurant) {
                user.restaurantId = restaurant._id;
            }
        }

        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.addStamps = async (req, res) => {
    try {
        const { customerId, restaurantId, stampsToAdd } = req.body;
        
        // Ensure stampsToAdd is positive
        if (!stampsToAdd || stampsToAdd <= 0) {
            return res.status(400).json({ message: 'Invalid stamp amount' });
        }

        const customer = await User.findById(customerId);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        // Find if user already has loyalty record for this restaurant
        const loyaltyIndex = customer.loyalTo.findIndex(l => l.resID.toString() === restaurantId);

        if (loyaltyIndex > -1) {
            // Update existing
            customer.loyalTo[loyaltyIndex].stamps += stampsToAdd;
        } else {
            // Add new record
            customer.loyalTo.push({
                resID: restaurant._id,
                resName: restaurant.name,
                stamps: stampsToAdd
            });
        }

        await customer.save();

        res.json({ message: 'Stamps added successfully', loyalTo: customer.loyalTo });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (error) {
        console.error("🔥 Error in getAllUsers:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error("🔥 Error in getUserById:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
