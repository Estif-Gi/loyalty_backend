// controllers/notifications.js
const Notification = require('../model/notifcation');
const Restaurant = require('../model/restaurant');
const User = require('../model/users');
const admin = require('../config/firebase-admin');
const mongoose = require('mongoose');
const { getRestaurantAndLimits } = require('../utils/billingLimits');

const DEFAULT_NOTIFICATION_ICON = 'android-chrome-512x512.png';
const DEFAULT_NOTIFICATION_BADGE = 'favicon-32x32.png';

function buildPublicBaseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
}

function buildNotificationAssets(req) {
  const baseUrl = buildPublicBaseUrl(req);

  return {
    icon: `${baseUrl}/icons/${DEFAULT_NOTIFICATION_ICON}`,
    badge: `${baseUrl}/icons/${DEFAULT_NOTIFICATION_BADGE}`,
  };
}

async function dispatchNotification({ notificationId, tokens, title, description, url, icon, badge }) {
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
    data: {
      title,
      body: description,
      url: url || '/rewards',
      icon,
      badge,
    },
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

async function updateRestaurantPushStats(restaurantId) {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfLastMonth = new Date();
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    startOfLastMonth.setDate(1);
    startOfLastMonth.setHours(0, 0, 0, 0);

    const endOfLastMonth = new Date(startOfMonth.getTime() - 1);

    const thisMonthCount = await Notification.countDocuments({
      restaurantId,
      createdAt: { $gte: startOfMonth }
    });

    const lastMonthCount = await Notification.countDocuments({
      restaurantId,
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
    });

    const totalCount = await Notification.countDocuments({ restaurantId });

    await Restaurant.findByIdAndUpdate(restaurantId, {
      'pushNotificationsStats.thisMonth': thisMonthCount,
      'pushNotificationsStats.lastMonth': lastMonthCount,
      'pushNotificationsStats.total': totalCount
    });
  } catch (error) {
    console.error('🔥 Failed to update push stats:', error);
  }
}

exports.createNotification = async (req, res) => {
  try {
    const { restaurantId, title, description, url } = req.body;
    const { icon, badge } = buildNotificationAssets(req);

    // ── Validate restaurant, billing limits & ownership ──────────────────
    const { restaurant, limits, tier } = await getRestaurantAndLimits(restaurantId);
    if (restaurant.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (limits.notifications === 0) {
      return res.status(400).json({
        message: `Your subscription tier (${tier.toUpperCase()}) does not allow sending push notifications. Please upgrade your plan.`
      });
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const sentThisMonth = await Notification.countDocuments({
      restaurantId,
      createdAt: { $gte: startOfMonth }
    });

    if (sentThisMonth >= limits.notifications) {
      return res.status(400).json({
        message: `Monthly push notification limit reached (${sentThisMonth}/${limits.notifications}) for the ${tier.toUpperCase()} tier. Please upgrade your plan.`
      });
    }

    const userQuery = {
      loyalTo: { $elemMatch: { resID: restaurant._id } },
      fcmToken: { $exists: true, $ne: null },
    };

    // ── Debug log to verify who's being targeted ──────────────────────────
    const matchedCount = await User.countDocuments(userQuery);
    // console.log(`[Notification] Query:`, JSON.stringify(userQuery, null, 2));
    // console.log(`[Notification] Matched ${matchedCount} users`);

    const customers = await User.find(userQuery).select('_id fcmToken').lean();
    const customerIds = customers.map((c) => c._id);
    const tokens = customers.map((c) => c.fcmToken).filter(Boolean);

    // console.log(`[Notification] Tokens collected: ${tokens.length}`);

    // ── Save notification record ──────────────────────────────────────────
    const notification = await Notification.create({
      restaurantId,
      title,
      description,
      url: url || '/rewards',
      icon,
      badge,
      tokens,
      status: 'pending',
    });

    await Restaurant.findByIdAndUpdate(restaurantId, {
      $push: { notifications: notification._id },
    });

    // Synchronize pushStats on Restaurant
    await updateRestaurantPushStats(restaurantId);
    const fcmResult = await dispatchNotification({
      notificationId: notification._id,
      tokens,
      title,
      description,
      url,
      icon,
      badge,
    });

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
    const { icon, badge } = buildNotificationAssets(req);

    if (Number.isNaN(minStampsNumber)) {
      return res.status(400).json({ message: 'minStamps must be a number' });
    }

    // ── Validate restaurant, billing limits & ownership ──────────────────
    const { restaurant, limits, tier } = await getRestaurantAndLimits(restaurantId);
    if (restaurant.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (limits.notifications === 0) {
      return res.status(400).json({
        message: `Your subscription tier (${tier.toUpperCase()}) does not allow sending targeted campaigns. Please upgrade your plan.`
      });
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const sentThisMonth = await Notification.countDocuments({
      restaurantId,
      createdAt: { $gte: startOfMonth }
    });

    if (sentThisMonth >= limits.notifications) {
      return res.status(400).json({
        message: `Monthly targeted campaign limit reached (${sentThisMonth}/${limits.notifications}) for the ${tier.toUpperCase()} tier. Please upgrade your plan.`
      });
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
      icon,
      badge,
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

    // Synchronize pushStats on Restaurant
    await updateRestaurantPushStats(restaurantId);

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
      icon,
      badge,
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
