const mongoose = require('mongoose');
const Restaurant = require('../model/restaurant');
const Employee = require('../model/employee');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.createRestaurant = async (req, res) => {
    const { name, phone, location, themeColor } = req.body;
    // User must be an owner to create a restaurant
    const owner = req.user.id;
    const restaurant = new Restaurant({
        name,
        phone,
        location,
        themeColor,
        owner
    });
    try {
        await restaurant.save();
        res.status(201).json(restaurant);
    } catch (error) {
        console.error("🔥 Error in createRestaurant:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getRestaurant = async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }
    try {

        const restaurant = await Restaurant.findById(id)
            .select('-notifications -menu -loyaltyProgram');
            
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }
        res.json(restaurant);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' }); 
    }
};

exports.getEmployees = async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const employees = await Employee.find({ restaurant: id }).select('-password');
        res.json({ restaurantId: id, employees });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateLogo = async (req, res) => {
    try {
        const restaurant = await Restaurant.findById(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (req.file && req.file.path) {
            restaurant.logoURL = req.file.path;
            await restaurant.save();
            return res.json({ message: 'Logo updated', logoURL: restaurant.logoURL });
        } else {
            return res.status(400).json({ message: 'No file uploaded' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateRestaurant = async (req, res) => {
    const { name, phone, location, themeColor } = req.body;
    try {
        const restaurant = await Restaurant.findById(req.params.id);

        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (name) restaurant.name = name;
        if (phone) restaurant.phone = phone;
        if (location) restaurant.location = location;
        if (themeColor) restaurant.themeColor = themeColor;

        await restaurant.save();
        res.json(restaurant);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createEmployee = async (req, res) => {
    const { name, password } = req.body;
    const { id } = req.params;

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const employeeCount = await Employee.countDocuments({ restaurant: id });
        if (employeeCount >= 5) {
            return res.status(400).json({ message: 'Restaurant cannot have more than 5 employees' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const employee = new Employee({
            name,
            restaurant: id,
            password: hashedPassword
        });

        await employee.save();
        res.status(201).json(employee);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getRestaurantByEmployeeId = async (req, res) => {
    const { employeeId } = req.params;
    
    if (!mongoose.isValidObjectId(employeeId)) {
        return res.status(400).json({ message: 'Invalid employee ID format' });
    }

    try {
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const restaurant = await Restaurant.findById(employee.restaurant)
            .select('-notifications -menu -loyaltyProgram');
        
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        res.json(restaurant);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.employeeLogin = async (req, res) => {
    try {
        const { employeeId, password } = req.body;

        if (!employeeId || !password) {
            return res.status(400).json({ message: 'Employee ID and password are required' });
        }

        if (!mongoose.isValidObjectId(employeeId)) {
            return res.status(400).json({ message: 'Invalid employee ID format' });
        }

        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, employee.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const payload = { id: employee._id, role: 'employee' };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({ 
            token, 
            employee: { 
                id: employee._id, 
                name: employee.name, 
                restaurant: employee.restaurant 
            } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
