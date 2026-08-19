const jwt = require('jsonwebtoken');
const Employee = require('../model/employee');
const ROLE_PERMISSIONS = require('../config/permissions');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization; 
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "No token provided, authorization denied" });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Assume token contains at least { id, role }

        // Resolve employee details if role is employee
        if (decoded.role === 'employee') {
            const employee = await Employee.findById(decoded.id);
            if (!employee) {
                return res.status(401).json({ 
                    success: false, 
                    error: "EMPLOYEE_NOT_FOUND", 
                    message: "Employee account no longer exists." 
                });
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

            req.employee = {
                id: employee._id.toString(),
                restaurantId: employee.restaurant.toString(),
                role: employee.role,
                permissions: ROLE_PERMISSIONS[employee.role] || [],
                isActive: employee.isActive
            };
        }

        next();
    } catch (err) {
        console.error("JWT Verification Error:", err.message);
        res.status(401).json({ message: "Token is not valid" });
    }
};

const checkRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: "Access denied. Insufficient permissions." });
        }
        next();
    };
};

const requireEmployeePermission = (permission) => {
    return (req, res, next) => {
        if (!req.employee) {
            return res.status(401).json({
                success: false,
                error: "EMPLOYEE_NOT_AUTHENTICATED",
                message: "Employee authentication is required."
            });
        }
        if (!req.employee.permissions.includes(permission)) {
            return res.status(403).json({
                success: false,
                error: "EMPLOYEE_ROLE_NOT_ALLOWED",
                message: "The authenticated employee does not have permission to perform this action.",
                details: {
                    requiredPermission: permission,
                    employeeRole: req.employee.role
                }
            });
        }
        next();
    };
};

module.exports = {
    verifyToken,
    checkRole,
    requireEmployeePermission
};
