const Notification = require('../model/notifcation');
const Restaurant = require('../model/restaurant');
const User = require('../model/users');
const admin = require('../config/firebase-admin');

exports.createNotification = async (req, res) => {
    try {
        const { restaurantId, title, description, url } = req.body;

        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // ── 1. Save notification record ────────────────────────────────────
        const notification = new Notification({ title, description });
        await notification.save();
        restaurant.notifications.push(notification._id);
        await restaurant.save();

        // ── 2. Dispatch FCM push to every opted-in customer ───────────────
        let fcmResult = null;

        if (admin.apps.length) {
            // Find all customers loyal to this restaurant who have an FCM token
            const customers = await User.find({
                'loyalTo.resID': restaurantId,
                fcmToken: { $ne: null, $exists: true },
            }).select('fcmToken').lean();

            const tokens = customers
                .map((c) => c.fcmToken)
                .filter(Boolean);

            if (tokens.length > 0) {
                const multicastMessage = {
                    tokens,
                    // data-only payload so our sw.js onBackgroundMessage handler fires
                    data: {
                        title,
                        body: description,
                        url: url || '/',
                    },
                };

                const response = await admin.messaging().sendEachForMulticast(multicastMessage);
                console.log(
                    `[FCM] Sent ${response.successCount}/${tokens.length} notifications.`
                );

                // Clean up tokens that are no longer valid
                const staleTokens = [];
                response.responses.forEach((r, i) => {
                    if (!r.success) {
                        const code = r.error?.code;
                        if (
                            code === 'messaging/invalid-registration-token' ||
                            code === 'messaging/registration-token-not-registered'
                        ) {
                            staleTokens.push(tokens[i]);
                        }
                    }
                });

                if (staleTokens.length > 0) {
                    await User.updateMany(
                        { fcmToken: { $in: staleTokens } },
                        { $set: { fcmToken: null } }
                    );
                    console.log(`[FCM] Cleared ${staleTokens.length} stale token(s).`);
                }

                fcmResult = {
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    total: tokens.length,
                };
            } else {
                console.log('[FCM] No opted-in customers found for this restaurant.');
                fcmResult = { successCount: 0, failureCount: 0, total: 0 };
            }
        } else {
            console.warn('[FCM] Admin SDK not initialised – skipping push dispatch.');
        }

        res.status(201).json({ notification, fcm: fcmResult });
    } catch (error) {
        console.error('🔥 createNotification error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ createdAt: -1 });
        res.json(notifications);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
