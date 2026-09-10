const User = require('../model/users');
const Employee = require('../model/employee');
const Restaurant = require('../model/restaurant');
const LoyaltyProgram = require('../model/loyalty_program');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getIo } = require('../sockets/ioInstance');
const { getLimitsForTier } = require('../utils/billingLimits');
const { validateEthiopianPhone, normalizeEthiopianPhone, ETHIOPIAN_PHONE_ERROR_MESSAGE } = require('../utils/phoneValidation');

exports.register = async (req, res) => {
    try {
        const { name, phone, password, role } = req.body;

        // P0 Security Check: Prevent public privilege escalation
        if (role && role !== 'customer') {
            return res.status(400).json({
                success: false,
                error: "PUBLIC_ROLE_ASSIGNMENT_NOT_ALLOWED",
                message: "Public registration cannot assign privileged account roles.",
                details: {
                    allowedRole: "customer"
                }
            });
        }

        // Validate Ethiopian Phone Number
        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({
                success: false,
                error: "PHONE_NUMBER_REQUIRED",
                message: "Phone number is required."
            });
        }

        const phoneValidation = validateEthiopianPhone(phone);
        if (!phoneValidation.isValid) {
            return res.status(400).json({
                success: false,
                error: "INVALID_ETHIOPIAN_PHONE_NUMBER",
                message: phoneValidation.error || ETHIOPIAN_PHONE_ERROR_MESSAGE
            });
        }

        const normalizedPhone = phoneValidation.normalized;

        // Check if user exists
        let user = await User.findOne({ phone: normalizedPhone });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({
            name,
            phone: normalizedPhone,
            password: hashedPassword,
            role: 'customer' // Force role to customer
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

        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const normalizedPhone = normalizeEthiopianPhone(phone) || phone.trim();

        const user = await User.findOne({
            $or: [{ phone: normalizedPhone }, { phone: phone.trim() }]
        });
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

// Unified profile retrieval for both Users and Employees (Option B)
exports.getProfile = async (req, res) => {
    try {
        // If employee token
        if (req.user.role === 'employee') {
            const employee = await Employee.findById(req.user.id).select('-password').lean();
            if (!employee) {
                return res.status(404).json({ message: 'Employee not found' });
            }
            return res.json({
                _id: employee._id,
                name: employee.name,
                restaurantId: employee.restaurant,
                role: employee.role,
                isActive: employee.isActive
            });
        }

        const user = await User.findById(req.user.id).select('-password').lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role === 'owner') {
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

        // --- HARDENED STAMP AUTHORIZATION CHECKS ---
        if (req.user.role === 'employee') {
            if (!req.employee) {
                return res.status(401).json({
                    success: false,
                    error: "EMPLOYEE_NOT_AUTHENTICATED",
                    message: "Employee authentication is required."
                });
            }
            // Check restaurant isolation
            if (req.employee.restaurantId !== restaurantId.toString()) {
                return res.status(403).json({
                    success: false,
                    error: "EMPLOYEE_RESTAURANT_MISMATCH",
                    message: "The authenticated employee does not belong to the requested restaurant.",
                    details: {
                        employeeRestaurantId: req.employee.restaurantId,
                        requestedRestaurantId: restaurantId.toString()
                    }
                });
            }
            // Check cashier permission
            if (!req.employee.permissions.includes('loyalty:stamps:add')) {
                return res.status(403).json({
                    success: false,
                    error: "EMPLOYEE_PERMISSION_DENIED",
                    message: "The authenticated employee does not have permission to perform this action.",
                    details: {
                        requiredPermission: "loyalty:stamps:add",
                        employeeRole: req.employee.role
                    }
                });
            }
        } else if (req.user.role === 'owner') {
            if (restaurant.owner.toString() !== req.user.id) {
                return res.status(403).json({ message: 'Not authorized' });
            }
        } else if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const loyaltyIndex = customer.loyalTo.findIndex(l => l.resID.toString() === restaurantId);

        let activeProgramId = loyaltyProgram;
        if (!activeProgramId) {
            const defaultProgram = await LoyaltyProgram.findOne({ restaurant: restaurantId });
            if (defaultProgram) {
                activeProgramId = defaultProgram._id;
            }
        }

        if (loyaltyIndex > -1) {
            customer.loyalTo[loyaltyIndex].stamps += stampsToAdd;

            if (!customer.loyalTo[loyaltyIndex].programID && activeProgramId) {
                customer.loyalTo[loyaltyIndex].programID = activeProgramId;
            }
        } else {
            // Enforce customer profiles limit
            const tier = restaurant.billingStatus || 'free';
            const limits = getLimitsForTier(tier);
            const currentCustomers = await User.countDocuments({ 'loyalTo.resID': restaurantId });

            if (currentCustomers >= limits.customers) {
                return res.status(400).json({
                    message: `Customer profile limit reached (${currentCustomers}/${limits.customers} customers) for this restaurant's ${tier.toUpperCase()} tier. Please upgrade your plan.`
                });
            }

            customer.loyalTo.push({
                resID: restaurant._id,
                resName: restaurant.name,
                programID: activeProgramId || null,
                stamps: stampsToAdd
            });
        }

        await customer.save();

        // If we added a new customer, synchronize the customerCount on the Restaurant
        if (loyaltyIndex === -1) {
            const freshCustomerCount = await User.countDocuments({ 'loyalTo.resID': restaurantId });
            restaurant.customerCount = freshCustomerCount;
            await restaurant.save();
        }

        // ── Socket push ──────────────────────────────────────────
        const io = getIo();
        const customerIdStr = customer._id.toString();
        const customerRoom = `customer:${customerIdStr}`;

        if (io) {
            const profilePayload = {
                success: true,
                data: customer.toObject()
            };
            io.to(customerRoom).emit('profileData', profilePayload);
            io.to(customerIdStr).emit('profileData', profilePayload);
            console.log(`📡 Pushed stamp update to customer room ${customerRoom}`);
        } else {
            console.warn(`⚠️ Socket.IO instance not initialized for user ${customer._id}`);
        }

        res.json({ message: 'Stamps added successfully', loyalTo: customer.loyalTo });
    } catch (error) {
        console.error("🔥 Error in addStamps:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
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

// Reusable version for Socket.IO (Option B unified)
exports.getProfileSocket = async (userId) => {
    const User = require('../model/users');
    const Employee = require('../model/employee');
    const Restaurant = require('../model/restaurant');

    // First try user collection
    const user = await User.findById(userId).select('-password').lean();
    if (user) {
        if (user.role === 'owner') {
            const restaurant = await Restaurant.findOne({ owner: userId });
            if (restaurant) user.restaurantId = restaurant._id;
        }
        return user;
    }

    // Try employee collection
    const employee = await Employee.findById(userId).select('-password').lean();
    if (employee) {
        return {
            _id: employee._id,
            name: employee.name,
            restaurantId: employee.restaurant,
            role: employee.role,
            isActive: employee.isActive
        };
    }

    throw new Error('User/Employee not found');
};