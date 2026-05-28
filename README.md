# bingo-gen2

## Local setup

1. Copy `firebase-config.example.js` to `firebase-config.js`.
2. Fill in your Firebase web app config and caller key in `firebase-config.js`.
3. Do not commit `firebase-config.js`.

## Security notes

The Firebase web API key and the old caller key were committed in earlier history.
Rotate the Firebase web API key in the Google Cloud Console and change the caller
key before using this project again.

Firebase web config is visible to browsers by design. Real protection must come
from Firebase Auth, App Check, and Realtime Database rules. The included
`database.rules.json` blocks caller-only writes by default until you add a real
authenticated caller role.
