/**
 * Genesis 2 — Firebase Configuration
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com
 * 2. Select your "Genesis" project
 * 3. Go to Project Settings (gear icon) > General > Your apps
 * 4. Click the web icon (</>) to add a web app
 * 5. Name it "Genesis 2" and click "Register app"
 * 6. Copy the firebaseConfig values into the object below
 * 7. Enable Authentication:
 *    - Go to Build > Authentication > Get started
 *    - Enable "Anonymous" sign-in provider
 * 8. Enable Firestore:
 *    - Go to Build > Firestore Database > Create database
 *    - Start in test mode (or production mode with rules below)
 *    - Select a region close to your users
 * 9. Set Firestore Security Rules (in Firebase Console > Firestore > Rules):
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *        match /{document=**} {
 *          allow read, write: if true;
 *        }
 *      }
 *    }
 *
 * Note: These rules allow open read/write access. This is acceptable
 * for a small private app with 2-3 trusted users. Do NOT use these
 * rules for a public-facing application.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

// REPLACE these values with your Firebase project configuration
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
