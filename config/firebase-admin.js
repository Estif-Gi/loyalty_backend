const admin = require('firebase-admin');
// const serviceAccount = require('../loyalty-e883f-firebase-adminsdk-fbsvc-8560d84572.json');

if (!admin.apps.length) {
    const serviceAccount = {
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: 'googleapis.com'
    };

    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log('[FCM] Firebase Admin SDK initialized ✓');
    } catch (err) {
        console.error('[FCM] Failed to initialize Firebase Admin SDK:', err.message);
    }
}

module.exports = admin;