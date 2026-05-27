// controllers/notifications.js
const Notification = require('../model/notifcation');
const Restaurant = require('../model/restaurant');
const User = require('../model/users');
const admin = require('../config/firebase-admin');
const mongoose = require('mongoose');

async function dispatchNotification({ notificationId, tokens, title, description, url }) {
  let fcmResult = { successCount: 0, failureCount: 0, total: tokens.length };

  if (!admin.apps.length) {
    console.warn('[FCM] Admin SDK not initialised – skipping push dispatch.');
    await Notification.findByIdAndUpdate(notificationId, { status: 'sent' });
    return fcmResult;
  }

  if (tokens.length === 0) {
    console.log('[FCM] No opted-in customers matched the criteria.');
    await Notification.findByIdAndUpdate(notificationId, { status: 'sent' });
    return fcmResult;
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title, body: description, url: url || '/rewards' },
  });

  console.log(`[FCM] ${response.successCount}/${tokens.length} delivered`);

  const staleTokens = response.responses
    .map((r, i) =>
      !r.success &&
      ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code)
        ? tokens[i]
        : null
    )
    .filter(Boolean);

  if (staleTokens.length > 0) {
    await User.updateMany(
      { fcmToken: { $in: staleTokens } },
      { $set: { fcmToken: null } }
    );
    console.log(`[FCM] Cleared ${staleTokens.length} stale token(s)`);
  }

  const fcmResultFinal = {
    successCount: response.successCount,
    failureCount: response.failureCount,
    total: tokens.length,
  };

  await Notification.findByIdAndUpdate(notificationId, {
    sentCount: response.successCount,
    failedCount: response.failureCount,
    status: response.failureCount === tokens.length ? 'failed' : 'sent',
  });

  return fcmResultFinal;
}

exports.createNotification = async (req, res) => {
  try {
    const { restaurantId, title, description, url } = req.body;

    // ── Validate restaurant & ownership ──────────────────────────────────
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    if (restaurant.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const userQuery = {
      loyalTo: { $elemMatch: { resID: restaurant._id } },
      fcmToken: { $exists: true, $ne: null },
    };

    // ── Debug log to verify who's being targeted ──────────────────────────
    const matchedCount = await User.countDocuments(userQuery);
    console.log(`[Notification] Query:`, JSON.stringify(userQuery, null, 2));
    console.log(`[Notification] Matched ${matchedCount} users`);

    const customers = await User.find(userQuery).select('_id fcmToken').lean();
    const customerIds = customers.map((c) => c._id);
    const tokens = customers.map((c) => c.fcmToken).filter(Boolean);

    console.log(`[Notification] Tokens collected: ${tokens.length}`);

    // ── Save notification record ──────────────────────────────────────────
    const notification = await Notification.create({
      restaurantId,
      title,
      description,
      url: url || '/rewards',
      tokens,
      status: 'pending',
    });

    await Restaurant.findByIdAndUpdate(restaurantId, {
      $push: { notifications: notification._id },
    });
    // ── Dispatch FCM ──────────────────────────────────────────────────────
    let fcmResult = { successCount: 0, failureCount: 0, total: tokens.length };

    if (!admin.apps.length) {
      console.warn('[FCM] Admin SDK not initialised – skipping push dispatch.');
      await Notification.findByIdAndUpdate(notification._id, { status: 'sent' });
    } else if (tokens.length === 0) {
      console.log('[FCM] No opted-in customers matched the criteria.');
      await Notification.findByIdAndUpdate(notification._id, { status: 'sent' });
    } else {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        data: { title, body: description, url: url || '/rewards' },
      });

      console.log(`[FCM] ${response.successCount}/${tokens.length} delivered`);

      // Clean up stale/invalid tokens
      const staleTokens = response.responses
        .map((r, i) =>
          !r.success &&
          ['messaging/invalid-registration-token',
           'messaging/registration-token-not-registered'].includes(r.error?.code)
            ? tokens[i]
            : null
        )
        .filter(Boolean);

      if (staleTokens.length > 0) {
        await User.updateMany(
          { fcmToken: { $in: staleTokens } },
          { $set: { fcmToken: null } }
        );
        console.log(`[FCM] Cleared ${staleTokens.length} stale token(s)`);
      }

      fcmResult = {
        successCount: response.successCount,
        failureCount: response.failureCount,
        total: tokens.length,
      };

      await Notification.findByIdAndUpdate(notification._id, {
        sentCount:   response.successCount,
        failedCount: response.failureCount,
        status: response.failureCount === tokens.length ? 'failed' : 'sent',
      });
    }

    res.status(201).json({ notification, fcm: fcmResult, audienceSize: tokens.length });
  } catch (error) {
    console.error('🔥 createNotification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createStampNotification = async (req, res) => {
  try {
    const { restaurantId, title, description, url, minStamps, stampAction } = req.body;
    const minStampsNumber = Number(minStamps);

    if (Number.isNaN(minStampsNumber)) {
      return res.status(400).json({ message: 'minStamps must be a number' });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    if (restaurant.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const customers = await User.find({
      loyalTo: { $elemMatch: { resID: restaurant._id, stamps: { $gte: minStampsNumber } } },
      fcmToken: { $exists: true, $ne: null },
    }).select('_id fcmToken').lean();

    const customerIds = customers.map((c) => c._id);
    const tokens = customers.map((c) => c.fcmToken).filter(Boolean);

    const notificationPayload = {
      restaurantId,
      title,
      description,
      url: url || '/rewards',
      tokens,
      status: 'pending',
      targetMinStamps: minStampsNumber,
    };

    if (stampAction?.type) {
      notificationPayload.stampAction = stampAction;
    }

    const notification = await Notification.create(notificationPayload);

    await Restaurant.findByIdAndUpdate(restaurantId, {
      $push: { notifications: notification._id },
    });

    if (stampAction?.type && customerIds.length > 0) {
      const numeric = Number(stampAction.value) || 0;
      const updateMap = {
        set: { $set: { 'loyalTo.$[elem].stamps': numeric } },
        inc: { $inc: { 'loyalTo.$[elem].stamps': numeric } },
        dec: { $inc: { 'loyalTo.$[elem].stamps': -Math.abs(numeric) } },
      };
      const update = updateMap[stampAction.type];
      if (update) {
        await User.updateMany(
          { _id: { $in: customerIds }, 'loyalTo.resID': restaurant._id },
          update,
          { arrayFilters: [{ 'elem.resID': restaurant._id }] }
        );
      }
    }

    const fcmResult = await dispatchNotification({
      notificationId: notification._id,
      tokens,
      title,
      description,
      url,
    });

    res.status(201).json({
      notification,
      fcm: fcmResult,
      audienceSize: tokens.length,
      filteredByMinStamps: minStampsNumber,
    });
  } catch (error) {
    console.error('🔥 createStampNotification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// ── GET /api/notifications?restaurantId=... ───────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const { restaurantId } = req.query;
    if (!restaurantId) {
      return res.status(400).json({ message: 'restaurantId query param required' });
    }

    const notifications = await Notification.find({ restaurantId })
      .sort({ createdAt: -1 })
      .lean();

    res.json(notifications);
  } catch (error) {
    console.error('🔥 getNotifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};