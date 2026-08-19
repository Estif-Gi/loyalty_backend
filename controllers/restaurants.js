const mongoose = require('mongoose');
const Restaurant = require('../model/restaurant');
const Employee = require('../model/employee');
const LoyaltyProgram = require('../model/loyalty_program');
const RestaurantTable = require('../model/restaurantTable');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getRestaurantAndLimits } = require('../utils/billingLimits');
const { validateWorkflow, WORKFLOW_DEFINITIONS } = require('../utils/workflow');

exports.createRestaurant = async (req, res) => {
    const { name, phone, location, themeColor } = req.body;
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

// Safe Customer Projection
exports.getAllRestaurants = async (req, res) => {
    try {
        const restaurants = await Restaurant.find().select('name phone location logoURL themeColor orderingEnabled');
        res.json(restaurants);
    } catch (error) {
        console.error("🔥 Error in getAllRestaurants:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Safe Customer Projection
exports.getRestaurant = async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }
    try {
        const restaurant = await Restaurant.findById(id).select('name phone location logoURL themeColor orderingEnabled');
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

        if (restaurant.owner.toString() !== req.user.id) {
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

        // Restaurant Employee Proximity Check
        if (restaurant.owner.toString() !== req.user.id) {
            if (req.user.role === 'employee' && req.employee && req.employee.restaurantId === restaurant._id.toString()) {
                // Authorized
            } else {
                return res.status(403).json({ message: 'Not authorized' });
            }
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
    const { name, phone, location, themeColor, billingStatus } = req.body;
    try {
        const restaurant = await Restaurant.findById(req.params.id);

        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Enforce Billing Status Protection
        if (billingStatus !== undefined && billingStatus !== restaurant.billingStatus) {
            return res.status(400).json({
                success: false,
                error: "BILLING_STATUS_NOT_OWNER_EDITABLE",
                message: "Restaurant billing status cannot be modified through the owner restaurant-update endpoint."
            });
        }

        if (name) restaurant.name = name;
        if (phone) restaurant.phone = phone;
        if (location) restaurant.location = location;
        if (themeColor) restaurant.themeColor = themeColor;

        await restaurant.save();
        res.json(restaurant);
    } catch (error) {
        console.error("🔥 Error in updateRestaurant:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.createEmployee = async (req, res) => {
    const { name, password, role } = req.body;
    const { id } = req.params;

    if (!name || !password) {
        return res.status(400).json({ message: 'Name and password are required' });
    }

    const allowedRoles = ["chef", "waiter", "cashier"];
    const employeeRole = role || "waiter";
    if (!allowedRoles.includes(employeeRole)) {
        return res.status(400).json({
            success: false,
            error: "INVALID_EMPLOYEE_ROLE",
            message: "Employee role must be chef, waiter, or cashier.",
            details: { received: role }
        });
    }

    try {
        const { restaurant, limits, tier } = await getRestaurantAndLimits(id);

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Count ONLY active staff against limits
        const activeEmployeeCount = await Employee.countDocuments({ restaurant: id, isActive: true });
        if (activeEmployeeCount >= limits.staff) {
            return res.status(400).json({ 
                message: `Staff account limit reached (${activeEmployeeCount}/${limits.staff} accounts) for the ${tier.toUpperCase()} tier. Please upgrade your subscription.` 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const employee = new Employee({
            name,
            restaurant: id,
            password: hashedPassword,
            role: employeeRole,
            isActive: true
        });

        await employee.save();

        // Update active employee count
        const newActiveCount = await Employee.countDocuments({ restaurant: id, isActive: true });
        restaurant.employeeCount = newActiveCount;
        await restaurant.save();

        const employeeResponse = employee.toObject();
        delete employeeResponse.password;

        res.status(201).json(employeeResponse);
    } catch (error) {
        console.error("🔥 Error in createEmployee:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// GET /api/restaurants/employee/me
exports.getRestaurantByEmployeeId = async (req, res) => {
    try {
        if (req.user.role !== 'employee' || !req.employee) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const employeeId = req.user.id;
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const [restaurant, loyaltyProgram] = await Promise.all([
            Restaurant.findById(employee.restaurant),
            LoyaltyProgram.findOne({ restaurant: employee.restaurant })
        ]);

        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        const loyaltyProgramId = loyaltyProgram?._id ?? null;

        // Secure Response: exclude coordinates, radius, billing, workflow config, internal counts
        res.json({ 
            _id: restaurant._id,
            name: restaurant.name,
            phone: restaurant.phone,
            location: restaurant.location,
            logoURL: restaurant.logoURL,
            themeColor: restaurant.themeColor,
            orderingEnabled: restaurant.orderingEnabled,
            loyaltyProgram: loyaltyProgramId
        });
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

        if (!employee.isActive) {
            return res.status(403).json({
                success: false,
                error: "EMPLOYEE_INACTIVE",
                message: "This employee account is inactive.",
                details: {
                    employeeId: employee._id.toString()
                }
            });
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
                restaurant: employee.restaurant,
                role: employee.role,
                isActive: employee.isActive
            } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getEmployeeDetails = async (req, res) => {
    const { id, employeeId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(employeeId)) {
        return res.status(400).json({ message: 'Invalid restaurant ID or employee ID format' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const employee = await Employee.findOne({ _id: employeeId, restaurant: id }).select('-password');
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found in this restaurant' });
        }

        res.json(employee);
    } catch (error) {
        console.error("🔥 Error in getEmployeeDetails:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateEmployee = async (req, res) => {
    const { id, employeeId } = req.params;
    const { role, isActive } = req.body;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(employeeId)) {
        return res.status(400).json({ message: 'Invalid restaurant ID or employee ID format' });
    }

    if (role !== undefined) {
        const allowedRoles = ["chef", "waiter", "cashier"];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_EMPLOYEE_ROLE",
                message: "Employee role must be chef, waiter, or cashier.",
                details: { received: role }
            });
        }
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const employee = await Employee.findOne({ _id: employeeId, restaurant: id });
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found in this restaurant' });
        }

        if (role !== undefined) {
            employee.role = role;
        }

        if (isActive !== undefined) {
            employee.isActive = isActive;
        }

        await employee.save();

        if (employee.isActive === false) {
            await RestaurantTable.updateMany(
                { assignedWaiter: employeeId },
                { $set: { assignedWaiter: null, waiterAssignedAt: null } }
            );
        }

        // Update active employee count
        const newActiveCount = await Employee.countDocuments({ restaurant: id, isActive: true });
        restaurant.employeeCount = newActiveCount;
        await restaurant.save();

        const responseObj = employee.toObject();
        delete responseObj.password;

        res.json(responseObj);
    } catch (error) {
        console.error("🔥 Error in updateEmployee:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getOrderingConfig = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        const isOwner = restaurant.owner.toString() === req.user.id;
        const isEmpOfRestaurant = req.user.role === 'employee' && req.employee && req.employee.restaurantId === id;

        if (!isOwner && !isEmpOfRestaurant) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json({
            orderingLocation: restaurant.orderingLocation || null,
            orderingRadiusMeters: restaurant.orderingRadiusMeters,
            orderingEnabled: restaurant.orderingEnabled
        });
    } catch (error) {
        console.error("🔥 Error in getOrderingConfig:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateOrderingConfig = async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude, orderingRadiusMeters, orderingEnabled } = req.body;

    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        let newLocation = restaurant.orderingLocation;

        if (latitude !== undefined || longitude !== undefined) {
            if (latitude === undefined || longitude === undefined) {
                return res.status(400).json({
                    success: false,
                    error: "INVALID_RESTAURANT_COORDINATES",
                    message: "Both latitude and longitude must be provided to set ordering location.",
                    details: { latitude, longitude }
                });
            }

            const latNum = Number(latitude);
            const lngNum = Number(longitude);

            if (isNaN(latNum) || isNaN(lngNum) || !isFinite(latNum) || !isFinite(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
                return res.status(400).json({
                    success: false,
                    error: "INVALID_RESTAURANT_COORDINATES",
                    message: "Restaurant latitude and longitude are invalid.",
                    details: { latitude, longitude }
                });
            }

            newLocation = {
                type: "Point",
                coordinates: [lngNum, latNum]
            };
        }

        if (orderingRadiusMeters !== undefined) {
            const radiusNum = Number(orderingRadiusMeters);
            if (isNaN(radiusNum) || radiusNum < 30 || radiusNum > 200) {
                return res.status(400).json({
                    success: false,
                    error: "INVALID_ORDERING_RADIUS",
                    message: "Ordering radius must be between 30 and 200 meters.",
                    details: {
                        received: orderingRadiusMeters,
                        minimum: 30,
                        maximum: 200
                    }
                });
            }
            restaurant.orderingRadiusMeters = radiusNum;
        }

        if (orderingEnabled === true) {
            const hasLocation = newLocation && newLocation.coordinates && newLocation.coordinates.length === 2;
            if (!hasLocation) {
                return res.status(400).json({
                    success: false,
                    error: "ORDERING_LOCATION_REQUIRED",
                    message: "Restaurant ordering cannot be enabled until an ordering location has been configured."
                });
            }
            restaurant.orderingEnabled = true;
        } else if (orderingEnabled === false) {
            restaurant.orderingEnabled = false;
        }

        if (latitude !== undefined || longitude !== undefined) {
            restaurant.orderingLocation = newLocation;
        }

        await restaurant.save();

        res.json({
            message: "Ordering configuration updated successfully.",
            orderingLocation: restaurant.orderingLocation,
            orderingRadiusMeters: restaurant.orderingRadiusMeters,
            orderingEnabled: restaurant.orderingEnabled
        });
    } catch (error) {
        console.error("🔥 Error in updateOrderingConfig:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getWorkflow = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        const isOwner = restaurant.owner.toString() === req.user.id;
        const isEmpOfRestaurant = req.user.role === 'employee' && req.employee && req.employee.restaurantId === id;

        if (!isOwner && !isEmpOfRestaurant) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json({
            orderWorkflow: restaurant.orderWorkflow,
            orderWorkflowVersion: restaurant.orderWorkflowVersion
        });
    } catch (error) {
        console.error("🔥 Error in getWorkflow:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateWorkflow = async (req, res) => {
    const { id } = req.params;
    const { orderWorkflow } = req.body;

    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid restaurant ID format' });
    }

    if (!Array.isArray(orderWorkflow)) {
        return res.status(400).json({ message: 'orderWorkflow must be an array' });
    }

    try {
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        if (restaurant.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Sanitize & Validate workflow steps
        const sanitizedWorkflow = [];
        for (const inputStep of orderWorkflow) {
            const canonical = WORKFLOW_DEFINITIONS[inputStep.key];
            if (!canonical) {
                return res.status(400).json({
                    success: false,
                    error: "INVALID_ORDER_WORKFLOW",
                    message: `Unknown workflow step key '${inputStep.key}'.`,
                    details: { step: inputStep.key }
                });
            }

            // Enforce systemState immutability
            if (inputStep.systemState !== undefined && inputStep.systemState !== canonical.systemState) {
                return res.status(400).json({
                    success: false,
                    error: "WORKFLOW_SYSTEM_FIELD_IMMUTABLE",
                    message: "Workflow system fields cannot be modified by restaurant owners.",
                    details: {
                        field: "systemState",
                        step: inputStep.key
                    }
                });
            }

            // Enforce required immutability
            if (inputStep.required !== undefined && inputStep.required !== canonical.required) {
                return res.status(400).json({
                    success: false,
                    error: "WORKFLOW_SYSTEM_FIELD_IMMUTABLE",
                    message: "Workflow system fields cannot be modified by restaurant owners.",
                    details: {
                        field: "required",
                        step: inputStep.key
                    }
                });
            }

            sanitizedWorkflow.push({
                key: canonical.key,
                systemState: canonical.systemState,
                required: canonical.required,
                label: inputStep.label || canonical.label || inputStep.key,
                enabled: inputStep.enabled !== undefined ? inputStep.enabled : true,
                responsibleRole: inputStep.responsibleRole || null,
                visibleToRoles: inputStep.visibleToRoles || [],
                actionRoles: inputStep.actionRoles || [],
                actionLabel: inputStep.actionLabel || null,
                order: inputStep.order
            });
        }

        const validation = validateWorkflow(sanitizedWorkflow);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: validation.error,
                message: validation.message,
                details: validation.details
            });
        }

        restaurant.orderWorkflow = sanitizedWorkflow;
        restaurant.orderWorkflowVersion += 1;

        await restaurant.save();

        res.json({
            message: "Workflow updated successfully.",
            orderWorkflow: restaurant.orderWorkflow,
            orderWorkflowVersion: restaurant.orderWorkflowVersion
        });
    } catch (error) {
        console.error("🔥 Error in updateWorkflow:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
