# bingo-gen2

## Node/Postgres setup

The app is now structured as a Node.js backend with a vanilla HTML/CSS/JS
frontend. The backend serves the frontend, API routes, and Socket.IO from one
origin.

1. Install dependencies:

```text
npm install
```

2. Copy `server/.env.example` to `server/.env`.
3. Set `DATABASE_URL` in `server/.env`.
4. Start the app:

```text
npm start
```

The backend serves the existing frontend, API routes, and Socket.IO from one
origin. For Coolify, point `bingogen.apprelay.in` at this Node app and set
`DATABASE_URL`, `NODE_ENV=production`, and `PORT=3000` in the service settings.

Useful commands:

```text
npm run check
npm start
```

## Security notes

The Firebase web API key and the old caller key were committed in earlier history.
Rotate the Firebase web API key in the Google Cloud Console and change the caller
key before using this project again.

Firebase web config is visible to browsers by design. The new Node/Postgres path
keeps database credentials server-side and validates caller actions in backend
routes.

## Coolify/Postgres migration

The app is being migrated away from Firebase into room-based Postgres storage. See
[`docs/coolify-postgres-migration.md`](docs/coolify-postgres-migration.md) for
the room architecture, Postgres schema, API routes, realtime socket events, and
deployment checklist for moving this app to a Coolify VPS.
