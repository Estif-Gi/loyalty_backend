const User = require('../model/users');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Restaurant = require('../model/restaurant');
const { getIo } = require('../sockets/ioInstance');

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

        res.status(201).json({ token, user: { id: user._id, name: user.name, role: user.role, loyalTo: user.loyalTo.map(l => ({ resID: l.resID, resName: l.resName, programID: l.programID, stamps: l.stamps })) } });
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

        res.json({ token, user: { id: user._id, name: user.name, role: user.role, loyalTo: user.loyalTo.map(l => ({ resID: l.resID, resName: l.resName, programID: l.programID, stamps: l.stamps })) } });
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
        const { customerId, restaurantId, stampsToAdd, loyaltyProgram } = req.body;
        // console.log(`📝 addStamps called: customerId=${customerId}, restaurantId=${restaurantId}, stampsToAdd=${stampsToAdd}`);

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

        const loyaltyIndex = customer.loyalTo.findIndex(l => l.resID.toString() === restaurantId);

        if (loyaltyIndex > -1) {
            customer.loyalTo[loyaltyIndex].stamps += stampsToAdd;

            if (!customer.loyalTo[loyaltyIndex].programID && loyaltyProgram) {
                customer.loyalTo[loyaltyIndex].programID = loyaltyProgram;
            }
        } else {
            if (!loyaltyProgram) {
                return res.status(400).json({ message: 'Loyalty program ID is required for new loyalty records' });
            }
            customer.loyalTo.push({
                resID: restaurant._id,
                resName: restaurant.name,
                programID: loyaltyProgram,
                stamps: stampsToAdd
            });
        }

        await customer.save();

        // ── Socket push ──────────────────────────────────────────
        const io = getIo();
        const userRoom = customer._id.toString();

        if (io) {
            io.to(userRoom).emit('profileData', {
                success: true,
                data: customer.toObject()   // already fresh from save()
            });
            console.log(`📡 Pushed stamp update to user room ${userRoom}`);
        } else {
            console.warn(`⚠️ Socket.IO instance not initialized for user ${customer._id}`);
        }
        // ────────────────────────────────────────────────────────

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

/**
 * PATCH /api/users/fcm-token
 * Saves (or refreshes) the caller's FCM registration token so the server
 * can target this device with push notifications.
 */
exports.saveFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) {
            return res.status(400).json({ message: 'fcmToken is required' });
        }
        await User.findByIdAndUpdate(req.user.id, { fcmToken });
        res.json({ message: 'FCM token saved' });
    } catch (error) {
        console.error('🔥 Error in saveFcmToken:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reusable version for Socket.IO (no req/res — returns plain data)
exports.getProfileSocket = async (userId) => {
    const User = require('../model/users');
    const Restaurant = require('../model/restaurant');

    const user = await User.findById(userId).select('-password').lean();
    if (!user) throw new Error('User not found');

    if (['owner', 'manager', 'employee'].includes(user.role)) {
        const restaurant = await Restaurant.findOne({ owner: userId });
        if (restaurant) user.restaurantId = restaurant._id;
    }

    return user;
};