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

const firebaseConfig = {
  apiKey: "AIzaSyDPx4rEg02ZNFD68H6ciB0twuhg3WxpOPQ",
  authDomain: "genesis-57b8d.firebaseapp.com",
  projectId: "genesis-57b8d",
  storageBucket: "genesis-57b8d.firebasestorage.app",
  messagingSenderId: "754351877582",
  appId: "1:754351877582:web:66c29c9b054f937db18f9f",
  measurementId: "G-1NEG09CHKV"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
