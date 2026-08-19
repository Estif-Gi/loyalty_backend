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

module.exports = {
  validateCreateTable,
  validateUpdateTable
};
