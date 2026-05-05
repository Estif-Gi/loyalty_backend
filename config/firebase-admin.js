const admin = require('firebase-admin');

// Only initialize once (guard for hot-reload environments)
if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT env var is not set – push notifications will be disabled.');
    } else {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            console.log('[FCM] Firebase Admin SDK initialized ✓');
        } catch (err) {
            console.error('[FCM] Failed to initialize Firebase Admin SDK:', err.message);
        }
    }
}

module.exports = admin;
