/**
 * Validator middleware for restaurant table requests.
 */

function validateCreateTable(req, res, next) {
  const { name, code, description } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_NAME',
      message: 'Table name is required and must be a valid string.'
    });
  }

  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_CODE',
      message: 'Table code is required and must be a valid string.'
    });
  }

  next();
}

function validateUpdateTable(req, res, next) {
  const { name, code, isActive } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_NAME',
      message: 'Table name must be a valid string.'
    });
  }

  if (code !== undefined && (typeof code !== 'string' || !code.trim())) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_CODE',
      message: 'Table code must be a valid string.'
    });
  }

  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_STATUS',
      message: 'Table isActive status must be a boolean.'
    });
  }

  next();
}

function validateBulkCreateTables(req, res, next) {
  const { tables, count, prefix, startNumber, description } = req.body;

  if (tables === undefined && count === undefined) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_BULK_CREATE_INPUT',
      message: 'Either a "tables" array or a "count" for auto-generation must be provided.'
    });
  }

  if (tables !== undefined) {
    if (!Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLES_ARRAY',
        message: 'The "tables" field must be a non-empty array.'
      });
    }

    if (tables.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'BULK_CREATE_LIMIT_EXCEEDED',
        message: 'Cannot create more than 100 tables at once.'
      });
    }

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (!table || typeof table !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TABLE_OBJECT',
          message: `Table at index ${i} is not a valid object.`
        });
      }
      if (!table.name || typeof table.name !== 'string' || !table.name.trim()) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TABLE_NAME',
          message: `Table at index ${i} has an invalid or missing name.`
        });
      }
      if (!table.code || typeof table.code !== 'string' || !table.code.trim()) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TABLE_CODE',
          message: `Table at index ${i} has an invalid or missing code.`
        });
      }
      if (table.description !== undefined && table.description !== null && typeof table.description !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TABLE_DESCRIPTION',
          message: `Table at index ${i} has an invalid description. It must be a string.`
        });
      }
    }
  } else {
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_COUNT',
        message: 'The "count" field must be a positive integer.'
      });
    }

    if (count > 100) {
      return res.status(400).json({
        success: false,
        error: 'BULK_CREATE_LIMIT_EXCEEDED',
        message: 'Cannot generate more than 100 tables at once.'
      });
    }

    if (prefix !== undefined && (typeof prefix !== 'string' || !prefix.trim())) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PREFIX',
        message: 'The "prefix" field must be a valid non-empty string.'
      });
    }

    if (startNumber !== undefined && (typeof startNumber !== 'number' || !Number.isInteger(startNumber) || startNumber < 0)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_START_NUMBER',
        message: 'The "startNumber" field must be a non-negative integer.'
      });
    }

    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TABLE_DESCRIPTION',
        message: 'The "description" field must be a string.'
      });
    }
  }

  next();
}

module.exports = {
  validateCreateTable,
  validateUpdateTable,
  validateBulkCreateTables
};

