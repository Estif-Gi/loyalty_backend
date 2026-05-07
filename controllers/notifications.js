// controllers/notifications.js
const Notification = require('../model/notifcation');
const Restaurant = require('../model/restaurant');
const User = require('../model/users');
const admin = require('../config/firebase-admin');

exports.createNotification = async (req, res) => {
  try {
    const { restaurantId, title, description, url } = req.body;

    // ── Validate restaurant & ownership ───────────────────────────────────
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    if (restaurant.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // ── Gather FCM tokens ──────────────────────────────────────────────────
    const customers = await User.find({
      'loyalTo.resID': restaurantId,
      fcmToken: { $exists: true, $ne: null },
    }).select('fcmToken').lean();

    const tokens = customers.map((c) => c.fcmToken).filter(Boolean);

    // ── Save notification record ───────────────────────────────────────────
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

    // ── Dispatch FCM ───────────────────────────────────────────────────────
    let fcmResult = { successCount: 0, failureCount: 0, total: tokens.length };

    if (tokens.length > 0 && admin.apps.length) {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        data: { title, body: description, url: url || '/rewards' },
      });

      console.log(`[FCM] ${response.successCount}/${tokens.length} delivered`);

      // Clean up stale tokens
      const staleTokens = response.responses
        .map((r, i) => (!r.success &&
          ['messaging/invalid-registration-token',
           'messaging/registration-token-not-registered']
          .includes(r.error?.code)) ? tokens[i] : null)
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

      // ── Update notification with delivery results ────────────────────────
      await Notification.findByIdAndUpdate(notification._id, {
        sentCount: response.successCount,
        failedCount: response.failureCount,
        status: response.failureCount === tokens.length ? 'failed' : 'sent',
      });
    } else {
      if (!admin.apps.length) {
        console.warn('[FCM] Admin SDK not initialised – skipping push dispatch.');
      } else {
        console.log('[FCM] No opted-in customers for this restaurant.');
      }

      await Notification.findByIdAndUpdate(notification._id, { status: 'sent' });
    }

    res.status(201).json({ notification, fcm: fcmResult });
  } catch (error) {
    console.error('🔥 createNotification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Scoped to a restaurant, newest first
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