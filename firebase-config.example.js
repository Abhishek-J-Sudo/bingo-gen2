// Copy this file to firebase-config.js and fill in your Firebase web app config.
// Keep firebase-config.js out of git. Values already committed should be rotated.
window.BINGO_FIREBASE_CONFIG = {
    apiKey: "YOUR_FIREBASE_WEB_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
};

// This only hides the caller key from source control. For production,
// enforce caller permissions with Firebase Auth and Realtime Database rules.
window.BINGO_CALLER_KEY = "CHANGE_THIS_CALLER_KEY";
