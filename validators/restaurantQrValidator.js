const mongoose = require('mongoose');

/**
 * Validates restaurant and table ID parameters for QR operations.
 */
function validateQrParams(req, res, next) {
  const { restaurantId, tableId } = req.params;

  if (restaurantId && !mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_RESTAURANT_ID',
      message: 'Provided restaurant ID is not in a valid format.'
    });
  }

  if (tableId && !mongoose.isValidObjectId(tableId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TABLE_ID',
      message: 'Provided table ID is not in a valid format.'
    });
  }

  next();
}

/**
 * Validates QR code identifier parameter.
 */
function validateQrCodeIdParam(req, res, next) {
  const { qrCodeId } = req.params;

  if (qrCodeId && !mongoose.isValidObjectId(qrCodeId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_QR_CODE_ID',
      message: 'Provided QR code ID is not in a valid format.'
    });
  }

  next();
}

module.exports = {
  validateQrParams,
  validateQrCodeIdParam
};
