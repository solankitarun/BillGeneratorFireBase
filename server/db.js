const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(path.resolve(__dirname, serviceAccountPath))
        });
        console.log('Firebase Admin SDK initialized successfully.');
    }
} catch (error) {
    console.error('Firebase initialization error:', error);
}

const db = admin.firestore();

function connectDB() {
    // Kept for compatibility, initialization is now at module level
}

module.exports = { db, connectDB };
