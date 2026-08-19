const mongoose = require('mongoose');
const RestaurantTable = require('../model/restaurantTable');
const Restaurant = require('../model/restaurant');
const Employee = require('../model/employee');

function serializeTable(table) {
  return {
    id: table._id,
    name: table.name,
    code: table.code,
    description: table.description,
    isActive: table.isActive,
    assignedWaiter: table.assignedWaiter ? {
      id: table.assignedWaiter._id || table.assignedWaiter,
      name: table.assignedWaiter.name,
      role: table.assignedWaiter.role
    } : null,
    waiterAssignedAt: table.waiterAssignedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt
  };
}


/**
 * Verifies that the restaurant exists and belongs to the authenticated owner.
 * @param {string} restaurantId 
 * @param {string} ownerId 
 * @returns {Promise<object>} Restaurant document
 */
async function verifyRestaurantOwnership(restaurantId, ownerId) {
  if (!mongoose.isValidObjectId(restaurantId)) {
    const error = new Error('Invalid restaurant ID format');
    error.statusCode = 400;
    error.errorCode = 'INVALID_RESTAURANT_ID';
    throw error;
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) {
    const error = new Error('Restaurant not found');
    error.statusCode = 404;
    error.errorCode = 'RESTAURANT_NOT_FOUND';
    throw error;
  }

  if (restaurant.owner.toString() !== ownerId) {
    const error = new Error('This table does not belong to a restaurant owned by the authenticated owner.');
    error.statusCode = 403;
    error.errorCode = 'TABLE_RESTAURANT_ACCESS_DENIED';
    throw error;
  }

  return restaurant;
}

exports.createTable = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { name, code, description } = req.body;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const tableCode = code.trim().toUpperCase();

    // Check for duplicate code in same restaurant
    const existingTable = await RestaurantTable.findOne({
      restaurant: restaurantId,
      code: tableCode
    });

    if (existingTable) {
      return res.status(400).json({
        success: false,
        error: 'TABLE_CODE_ALREADY_EXISTS',
        message: `A table with code '${tableCode}' already exists in this restaurant.`
      });
    }

    const table = new RestaurantTable({
      restaurant: restaurantId,
      name: name.trim(),
      code: tableCode,
      description: description ? description.trim() : null,
      isActive: true
    });

    await table.save();

    res.status(201).json({
      success: true,
      data: serializeTable(table)
    });
  } catch (error) {
    console.error('🔥 Error in createTable:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.getTables = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    // Owners and Employees of this restaurant are allowed to list tables
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant not found.'
      });
    }

    const isOwner = restaurant.owner.toString() === req.user.id;
    const isEmployee = req.user.role === 'employee' && req.employee && req.employee.restaurantId === restaurantId;

    if (!isOwner && !isEmployee) {
      return res.status(403).json({
        success: false,
        error: 'TABLE_RESTAURANT_ACCESS_DENIED',
        message: 'You are not authorized to view tables for this restaurant.'
      });
    }

    const tables = await RestaurantTable.find({ restaurant: restaurantId }).populate('assignedWaiter', 'name role');

    res.json({
      success: true,
      data: tables.map((t) => serializeTable(t))
    });
  } catch (error) {
    console.error('🔥 Error in getTables:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
    });
  }
};

exports.getTableById = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;

    if (!mongoose.isValidObjectId(tableId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_ID',
        message: 'Invalid table ID format.'
      });
    }

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOne({
      _id: tableId,
      restaurant: restaurantId
    }).populate('assignedWaiter', 'name role');

    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found.'
      });
    }

    res.json({
      success: true,
      data: serializeTable(table)
    });
  } catch (error) {
    console.error('🔥 Error in getTableById:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.updateTable = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;
    const { name, code, description, isActive } = req.body;

    if (!mongoose.isValidObjectId(tableId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_ID',
        message: 'Invalid table ID format.'
      });
    }

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOne({
      _id: tableId,
      restaurant: restaurantId
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found.'
      });
    }

    if (code !== undefined) {
      const tableCode = code.trim().toUpperCase();
      if (tableCode !== table.code) {
        // Enforce uniqueness of table codes
        const duplicate = await RestaurantTable.findOne({
          restaurant: restaurantId,
          code: tableCode
        });

        if (duplicate) {
          return res.status(400).json({
            success: false,
            error: 'TABLE_CODE_ALREADY_EXISTS',
            message: `A table with code '${tableCode}' already exists in this restaurant.`
          });
        }
        table.code = tableCode;
      }
    }

    if (name !== undefined) table.name = name.trim();
    if (description !== undefined) table.description = description ? description.trim() : null;
    if (isActive !== undefined) table.isActive = isActive;

    await table.save();

    const populatedTable = await RestaurantTable.findById(table._id).populate('assignedWaiter', 'name role');

    res.json({
      success: true,
      data: serializeTable(populatedTable)
    });
  } catch (error) {
    console.error('🔥 Error in updateTable:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.deactivateTable = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;
    
    if (!mongoose.isValidObjectId(tableId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_ID',
        message: 'Invalid table ID format.'
      });
    }

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOneAndUpdate(
      { _id: tableId, restaurant: restaurantId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found.'
      });
    }

    const populatedTable = await RestaurantTable.findById(table._id).populate('assignedWaiter', 'name role');

    res.json({
      success: true,
      data: serializeTable(populatedTable)
    });
  } catch (error) {
    console.error('🔥 Error in deactivateTable:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.activateTable = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;
    
    if (!mongoose.isValidObjectId(tableId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_ID',
        message: 'Invalid table ID format.'
      });
    }

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOneAndUpdate(
      { _id: tableId, restaurant: restaurantId },
      { $set: { isActive: true } },
      { new: true }
    );

    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found.'
      });
    }

    res.json({
      success: true,
      data: serializeTable(table)
    });
  } catch (error) {
    console.error('🔥 Error in activateTable:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.assignWaiterToTable = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;
    const { waiterId } = req.body;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOne({ _id: tableId, restaurant: restaurantId });
    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found.'
      });
    }

    if (waiterId !== null && waiterId !== undefined) {
      if (!mongoose.isValidObjectId(waiterId)) {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_NOT_FOUND',
          message: 'The selected waiter does not exist.'
        });
      }

      const waiter = await Employee.findById(waiterId);
      if (!waiter) {
        return res.status(404).json({
          success: false,
          error: 'TABLE_WAITER_NOT_FOUND',
          message: 'The selected waiter does not exist.'
        });
      }

      if (!waiter.isActive || waiter.role !== 'waiter') {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_ROLE_INVALID',
          message: 'Only active employees with the waiter role can be assigned to restaurant tables.',
          details: { employeeRole: waiter.role }
        });
      }

      if (waiter.restaurant.toString() !== restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_RESTAURANT_MISMATCH',
          message: 'The selected waiter does not belong to this restaurant.'
        });
      }

      table.assignedWaiter = waiter._id;
      table.waiterAssignedAt = new Date();
    } else {
      table.assignedWaiter = null;
      table.waiterAssignedAt = null;
    }

    await table.save();

    const populatedTable = await RestaurantTable.findById(table._id).populate('assignedWaiter', 'name role');

    res.json({
      success: true,
      data: serializeTable(populatedTable)
    });
  } catch (error) {
    console.error('🔥 Error in assignWaiterToTable:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.bulkAssignTables = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { waiterId, tableIds } = req.body;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    if (waiterId !== null && waiterId !== undefined) {
      if (!mongoose.isValidObjectId(waiterId)) {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_NOT_FOUND',
          message: 'The selected waiter does not exist.'
        });
      }

      const waiter = await Employee.findById(waiterId);
      if (!waiter) {
        return res.status(404).json({
          success: false,
          error: 'TABLE_WAITER_NOT_FOUND',
          message: 'The selected waiter does not exist.'
        });
      }

      if (!waiter.isActive || waiter.role !== 'waiter') {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_ROLE_INVALID',
          message: 'Only active employees with the waiter role can be assigned to restaurant tables.',
          details: { employeeRole: waiter.role }
        });
      }

      if (waiter.restaurant.toString() !== restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'TABLE_WAITER_RESTAURANT_MISMATCH',
          message: 'The selected waiter does not belong to this restaurant.'
        });
      }
    }

    if (!Array.isArray(tableIds)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_IDS',
        message: 'tableIds must be an array.'
      });
    }

    for (const tId of tableIds) {
      if (!mongoose.isValidObjectId(tId)) {
        return res.status(400).json({
          success: false,
          error: 'TABLE_NOT_FOUND',
          message: `Invalid table ID format: ${tId}`
        });
      }
      const tObj = await RestaurantTable.findOne({ _id: tId, restaurant: restaurantId });
      if (!tObj) {
        return res.status(404).json({
          success: false,
          error: 'TABLE_NOT_FOUND',
          message: `Table with ID ${tId} not found in this restaurant.`
        });
      }
    }

    const updateVal = waiterId ? waiterId : null;
    const dateVal = waiterId ? new Date() : null;

    await RestaurantTable.updateMany(
      { _id: { $in: tableIds }, restaurant: restaurantId },
      { $set: { assignedWaiter: updateVal, waiterAssignedAt: dateVal } }
    );

    res.json({
      success: true,
      message: 'Bulk table assignments updated successfully.'
    });
  } catch (error) {
    console.error('🔥 Error in bulkAssignTables:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.listTableAssignments = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const tables = await RestaurantTable.find({ restaurant: restaurantId }).populate('assignedWaiter', 'name role');

    res.json({
      success: true,
      data: tables.map(t => serializeTable(t))
    });
  } catch (error) {
    console.error('🔥 Error in listTableAssignments:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};
