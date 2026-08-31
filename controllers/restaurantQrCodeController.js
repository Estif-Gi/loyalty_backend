const mongoose = require('mongoose');
const RestaurantTable = require('../model/restaurantTable');
const RestaurantQrCode = require('../model/restaurantQrCode');
const Restaurant = require('../model/restaurant');
const { generateRawToken, hashToken, buildQrUrl } = require('../services/qrCodeService');
const { encryptQrToken, decryptQrToken } = require('../utils/crypto');

/**
 * Helper to verify ownership of the restaurant.
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

exports.generateQrCode = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const table = await RestaurantTable.findOne({ _id: tableId, restaurant: restaurantId });
    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found in this restaurant.'
      });
    }

    if (!table.isActive) {
      return res.status(400).json({
        success: false,
        error: 'TABLE_INACTIVE',
        message: 'Cannot generate QR code for an inactive table.'
      });
    }

    // Inactivate any existing active QR code for this table
    await RestaurantQrCode.updateMany(
      { table: tableId, isActive: true },
      { $set: { isActive: false, revokedAt: new Date() } }
    );

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const encryptedToken = encryptQrToken(rawToken);

    const qrCode = new RestaurantQrCode({
      restaurant: restaurantId,
      table: tableId,
      tokenHash,
      encryptedToken,
      isActive: true,
      createdBy: req.user.id
    });

    await qrCode.save();

    res.status(201).json({
      success: true,
      data: {
        qrCodeId: qrCode._id,
        restaurantId,
        tableId,
        token: rawToken, // Returned exactly once during creation
        url: buildQrUrl(rawToken),
        isActive: qrCode.isActive,
        createdAt: qrCode.createdAt
      }
    });
  } catch (error) {
    console.error('🔥 Error in generateQrCode:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.rotateQrCode = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ADMIN_PERMISSION_REQUIRED',
        message: 'Only a platform administrator can rotate or revoke a table QR code.'
      });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant not found.'
      });
    }

    const table = await RestaurantTable.findOne({ _id: tableId, restaurant: restaurantId });
    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table not found in this restaurant.'
      });
    }

    if (!table.isActive) {
      return res.status(400).json({
        success: false,
        error: 'TABLE_INACTIVE',
        message: 'Cannot rotate QR code for an inactive table.'
      });
    }

    // Inactivate all existing active QR codes for this table
    await RestaurantQrCode.updateMany(
      { table: tableId, isActive: true },
      { $set: { isActive: false, rotatedAt: new Date() } }
    );

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const encryptedToken = encryptQrToken(rawToken);

    const qrCode = new RestaurantQrCode({
      restaurant: restaurantId,
      table: tableId,
      tokenHash,
      encryptedToken,
      isActive: true,
      createdBy: req.user.id
    });

    await qrCode.save();

    res.status(200).json({
      success: true,
      data: {
        qrCodeId: qrCode._id,
        restaurantId,
        tableId,
        token: rawToken, // Returned exactly once during rotation
        url: buildQrUrl(rawToken),
        isActive: qrCode.isActive,
        createdAt: qrCode.createdAt
      }
    });
  } catch (error) {
    console.error('🔥 Error in rotateQrCode:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.revokeQrCode = async (req, res) => {
  try {
    const { restaurantId, tableId, qrCodeId } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'ADMIN_PERMISSION_REQUIRED',
        message: 'Only a platform administrator can rotate or revoke a table QR code.'
      });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant not found.'
      });
    }

    if (!mongoose.isValidObjectId(qrCodeId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QR_CODE_ID',
        message: 'Invalid QR code ID format.'
      });
    }

    const qrCode = await RestaurantQrCode.findOne({
      _id: qrCodeId,
      restaurant: restaurantId,
      table: tableId
    });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        error: 'QR_CODE_NOT_FOUND',
        message: 'QR code not found.'
      });
    }

    if (!qrCode.isActive) {
      return res.status(400).json({
        success: false,
        error: 'QR_CODE_INACTIVE',
        message: 'QR code is already inactive.'
      });
    }

    qrCode.isActive = false;
    qrCode.revokedAt = new Date();
    await qrCode.save();

    res.json({
      success: true,
      message: 'QR code successfully revoked.'
    });
  } catch (error) {
    console.error('🔥 Error in revokeQrCode:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};

exports.getQrCodeMetadata = async (req, res) => {
  try {
    const { restaurantId, tableId } = req.params;

    await verifyRestaurantOwnership(restaurantId, req.user.id);

    const qrCodes = await RestaurantQrCode.find({
      restaurant: restaurantId,
      table: tableId
    });

    const activeQr = qrCodes.find(q => q.isActive);

    if (activeQr) {
      if (!activeQr.encryptedToken) {
        return res.status(400).json({
          success: false,
          error: 'QR_CREDENTIAL_NOT_RECOVERABLE',
          message: 'This QR was created using the previous QR storage format and cannot be reprinted.'
        });
      }

      try {
        const decryptedToken = decryptQrToken(activeQr.encryptedToken);
        const orderingUrl = buildQrUrl(decryptedToken);

        const safeQrCodes = qrCodes.map(q => {
          const obj = q.toObject();
          delete obj.tokenHash;
          delete obj.encryptedToken;
          if (obj.isActive) {
            obj.url = orderingUrl;
          }
          return obj;
        });

        return res.json({
          success: true,
          data: safeQrCodes
        });
      } catch (cryptoErr) {
        console.error('🔥 Crypto decryption failed for active QR:', cryptoErr);
        return res.status(400).json({
          success: false,
          error: 'QR_CREDENTIAL_NOT_RECOVERABLE',
          message: 'This QR was created using the previous QR storage format and cannot be reprinted.'
        });
      }
    }

    const safeQrCodes = qrCodes.map(q => {
      const obj = q.toObject();
      delete obj.tokenHash;
      delete obj.encryptedToken;
      return obj;
    });

    res.json({
      success: true,
      data: safeQrCodes
    });
  } catch (error) {
    console.error('🔥 Error in getQrCodeMetadata:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Server error'
    });
  }
};
