const mongoose = require('mongoose');
const OrderSession = require('../model/orderSession');
const Restaurant = require('../model/restaurant');
const RestaurantTable = require('../model/restaurantTable');
const RestaurantQrCode = require('../model/restaurantQrCode');
const { hashToken } = require('../services/qrCodeService');
const { verifyRestaurantPresence } = require('../services/geofenceService');
const { getExistingActiveSession, enforceSingleActiveSession, refreshSession } = require('../services/orderSessionService');
const { DEFAULT_ORDER_SESSION_MINUTES } = require('../constants/ordering');

exports.createOrderSession = async (req, res) => {
  try {
    // Only customers are allowed to create order sessions
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        success: false,
        error: 'CUSTOMER_ROLE_REQUIRED',
        message: 'Only customer accounts can create order sessions.'
      });
    }

    const { qrToken, location } = req.body;
    const { latitude, longitude, accuracy } = location;

    const tokenHash = hashToken(qrToken);

    // Resolve QR Code
    const qrCode = await RestaurantQrCode.findOne({ tokenHash });
    if (!qrCode) {
      return res.status(404).json({
        success: false,
        error: 'QR_CODE_NOT_FOUND',
        message: 'QR code not found or invalid.'
      });
    }

    if (!qrCode.isActive) {
      const isRevoked = qrCode.revokedAt !== null;
      return res.status(400).json({
        success: false,
        error: isRevoked ? 'QR_CODE_REVOKED' : 'QR_CODE_INACTIVE',
        message: isRevoked ? 'This QR code has been revoked.' : 'This QR code is inactive.'
      });
    }

    // Resolve Table
    const table = await RestaurantTable.findById(qrCode.table);
    if (!table) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: 'Table associated with this QR code does not exist.'
      });
    }

    if (!table.isActive) {
      return res.status(400).json({
        success: false,
        error: 'TABLE_INACTIVE',
        message: 'The table associated with this QR code is inactive.'
      });
    }

    // Verify QR/Table restaurant matching
    if (qrCode.restaurant.toString() !== table.restaurant.toString()) {
      return res.status(400).json({
        success: false,
        error: 'QR_TABLE_MISMATCH',
        message: 'QR code restaurant association does not match the table restaurant.'
      });
    }

    // Resolve Restaurant
    const restaurant = await Restaurant.findById(qrCode.restaurant);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant associated with this QR code not found.'
      });
    }

    // Verify ordering enabled
    if (!restaurant.orderingEnabled) {
      return res.status(400).json({
        success: false,
        error: 'RESTAURANT_ORDERING_DISABLED',
        message: 'Ordering is currently disabled for this restaurant.'
      });
    }

    // Verify geofence physical presence (radius-aware accuracy inside)
    const presence = verifyRestaurantPresence({
      restaurant,
      latitude,
      longitude,
      accuracy
    });

    if (!presence.isPresent) {
      const errorStatus = presence.error === 'OUTSIDE_RESTAURANT_ORDERING_RADIUS' ? 403 : 400;
      return res.status(errorStatus).json({
        success: false,
        error: presence.error,
        message: presence.error === 'OUTSIDE_RESTAURANT_ORDERING_RADIUS'
          ? 'You must be at the restaurant to start an ordering session.'
          : 'Your location could not be verified accurately enough to start restaurant ordering.',
        details: presence.details
      });
    }

    const customerId = req.user.id;
    const restaurantId = restaurant._id;
    const tableId = table._id;

    // Explicitly transition expired sessions first so they do not block unique active index
    await OrderSession.updateMany(
      {
        customer: customerId,
        status: 'active',
        expiresAt: { $lte: new Date() }
      },
      {
        $set: { status: 'expired' }
      }
    );

    // Enforce single active session conflict rules: cancel other restaurants' active sessions
    await enforceSingleActiveSession(customerId, restaurantId);

    // Check if the customer already has an active, non-expired session at this same table
    const existingSession = await getExistingActiveSession(customerId, restaurantId, tableId);

    let session;
    if (existingSession) {
      // Reuse / Refresh existing session
      session = await refreshSession(existingSession, {
        accuracy,
        distanceMeters: presence.distanceMeters
      });
    } else {
      // Create new OrderSession
      const durationMinutes = DEFAULT_ORDER_SESSION_MINUTES;
      const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

      session = new OrderSession({
        customer: customerId,
        restaurant: restaurantId,
        table: tableId,
        qrCode: qrCode._id,
        status: 'active',
        // Strip exact customer lat/lng coordinates (Section 24)
        locationVerification: {
          accuracyMeters: accuracy,
          distanceMeters: presence.distanceMeters,
          verifiedAt: new Date()
        },
        expiresAt
      });

      try {
        await session.save();
      } catch (error) {
        // Concurrency duplicate key violation check (Section 14)
        if (error.code === 11000) {
          const activeSession = await OrderSession.findOne({
            customer: customerId,
            status: 'active'
          });
          
          if (activeSession && activeSession.restaurant.toString() === restaurantId.toString() && activeSession.table.toString() === tableId.toString()) {
            // Same restaurant and table, refresh the session
            session = await refreshSession(activeSession, {
              accuracy,
              distanceMeters: presence.distanceMeters
            });
          } else {
            return res.status(409).json({
              success: false,
              error: 'ORDER_SESSION_CONCURRENCY_CONFLICT',
              message: 'An active ordering session was concurrently created. Please try again.'
            });
          }
        } else {
          throw error;
        }
      }
    }

    res.status(201).json({
      success: true,
      data: {
        session: {
          id: session._id,
          restaurant: {
            id: restaurant._id,
            name: restaurant.name,
            logoURL: restaurant.logoURL
          },
          table: {
            id: table._id,
            name: table.name,
            code: table.code
          },
          expiresAt: session.expiresAt,
          lastVerifiedAt: session.lastVerifiedAt
        }
      }
    });
  } catch (error) {
    console.error('🔥 Error in createOrderSession:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
    });
  }
};

exports.getCurrentSession = async (req, res) => {
  try {
    const customerId = req.user.id;

    // Find customer's active non-expired session
    const session = await OrderSession.findOne({
      customer: customerId,
      status: 'active',
      expiresAt: { $gt: new Date() }
    })
      .populate('restaurant', 'name logoURL')
      .populate('table', 'name code');

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_SESSION_NOT_FOUND',
        message: 'No active ordering session found.'
      });
    }

    res.json({
      success: true,
      data: {
        session: {
          id: session._id,
          restaurant: {
            id: session.restaurant._id,
            name: session.restaurant.name,
            logoURL: session.restaurant.logoURL
          },
          table: {
            id: session.table._id,
            name: session.table.name,
            code: session.table.code
          },
          expiresAt: session.expiresAt,
          lastVerifiedAt: session.lastVerifiedAt
        }
      }
    });
  } catch (error) {
    console.error('🔥 Error in getCurrentSession:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
    });
  }
};

exports.verifySessionLocation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (!mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ORDER_SESSION_ID',
        message: 'Invalid session ID format.'
      });
    }

    const session = await OrderSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_SESSION_NOT_FOUND',
        message: 'Ordering session not found.'
      });
    }

    // Verify session ownership
    if (session.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'ORDER_SESSION_NOT_OWNED',
        message: 'Access denied. You do not own this ordering session.'
      });
    }

    // Verify session active and not expired
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'ORDER_SESSION_INACTIVE',
        message: `Ordering session is inactive (${session.status}).`
      });
    }

    if (session.expiresAt <= new Date()) {
      session.status = 'expired';
      await session.save();
      return res.status(400).json({
        success: false,
        error: 'ORDER_SESSION_EXPIRED',
        message: 'Ordering session has expired.'
      });
    }

    // Resolve restaurant geofence parameters
    const restaurant = await Restaurant.findById(session.restaurant);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'RESTAURANT_NOT_FOUND',
        message: 'Associated restaurant not found.'
      });
    }

    if (!restaurant.orderingEnabled) {
      return res.status(400).json({
        success: false,
        error: 'RESTAURANT_ORDERING_DISABLED',
        message: 'Ordering is currently disabled for this restaurant.'
      });
    }

    const presence = verifyRestaurantPresence({
      restaurant,
      latitude,
      longitude,
      accuracy
    });

    if (!presence.isPresent) {
      const errorStatus = presence.error === 'OUTSIDE_RESTAURANT_ORDERING_RADIUS' ? 403 : 400;
      return res.status(errorStatus).json({
        success: false,
        error: presence.error,
        message: presence.error === 'OUTSIDE_RESTAURANT_ORDERING_RADIUS'
          ? 'You must be at the restaurant to verify ordering location.'
          : 'Your location could not be verified accurately enough.',
        details: presence.details
      });
    }

    // Update session verification timestamps & clean coordinates
    session.locationVerification = {
      accuracyMeters: accuracy,
      distanceMeters: presence.distanceMeters,
      verifiedAt: new Date()
    };
    session.lastVerifiedAt = new Date();
    await session.save();

    res.json({
      success: true,
      message: 'Session location successfully verified.',
      data: {
        distanceMeters: presence.distanceMeters,
        lastVerifiedAt: session.lastVerifiedAt
      }
    });
  } catch (error) {
    console.error('🔥 Error in verifySessionLocation:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
    });
  }
};

exports.cancelSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ORDER_SESSION_ID',
        message: 'Invalid session ID format.'
      });
    }

    const session = await OrderSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_SESSION_NOT_FOUND',
        message: 'Ordering session not found.'
      });
    }

    // Verify session ownership
    if (session.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'ORDER_SESSION_NOT_OWNED',
        message: 'Access denied. You do not own this ordering session.'
      });
    }

    session.status = 'cancelled';
    await session.save();

    res.json({
      success: true,
      message: 'Ordering session successfully cancelled.'
    });
  } catch (error) {
    console.error('🔥 Error in cancelSession:', error);
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
    });
  }
};
