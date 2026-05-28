# Coolify/Postgres Room Migration Plan

This document describes the move from one Firebase-backed shared game into a
room-based app backed by Postgres on a Coolify VPS.

## Implementation Status

The repository now includes the first Node/Postgres implementation:

- `server/server.js` serves the frontend, HTTP API, and Socket.IO.
- `server/db.js` owns the Postgres connection and schema migration.
- `server/schema.sql` creates the room, player, board, called number, and winner
  tables.
- `api.js`, `bingo.js`, and `numberboard.js` call the backend instead of Firebase.

The app still needs a real `DATABASE_URL` before it can run end-to-end locally or
on Coolify.

## Current State

The old app ran as a static frontend and talked directly to Firebase from the
browser.

Current Firebase shape:

```text
bingo-game/status
bingo-game/boards
bingo-game/calledNumbers
bingo-game/winners
bingo-game/assignedNames
```

Because every path was under `bingo-game`, all users were effectively in the same
global game. The caller unlock key also ran in browser code, so it was only a UI
gate unless Firebase security rules enforced the same permissions server-side.

## Target Architecture

Postgres is not accessed directly from browser JavaScript. The browser
should talk to a backend API, and only the backend should connect to Postgres.

```text
Browser frontend
  -> HTTP API and WebSocket events
Node.js backend on Coolify
  -> Postgres database on Coolify
```

Recommended stack:

```text
Node.js
Express
Socket.IO
PostgreSQL
```

Socket.IO is useful because the game needs realtime updates:

- The caller starts or stops a game.
- The caller calls a number.
- Players see called numbers immediately.
- Player counts update while people join or leave.
- Winners appear immediately.
- Resets clear the room for every connected client.

## Proposed Project Structure

```text
bingo-gen2/
  index.html
  bingo.js
  numberboard.js
  confetti.js
  server/
    package.json
    server.js
    db.js
    schema.sql
    .env.example
```

The backend can also serve the existing frontend files, which makes Coolify
deployment simpler:

```text
GET /
GET /bingo.js
GET /numberboard.js
GET /confetti.js
```

## Room Data Model

Every game should live under a room. A room has a short join code, a status, a
caller credential, players, boards, called numbers, and winners.

Suggested Postgres schema:

```sql
create extension if not exists pgcrypto;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  caller_key_hash text not null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  session_id text not null,
  created_at timestamptz not null default now(),
  unique(room_id, session_id)
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  numbers jsonb not null,
  marked_numbers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, player_id)
);

create table called_numbers (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  number int not null check (number between 1 and 25),
  called_at timestamptz not null default now(),
  unique(room_id, number)
);

create table winners (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  won_at timestamptz not null default now(),
  unique(room_id, player_id)
);
```

Room status values:

```text
waiting
active
paused
finished
```

## User Flow

Caller flow:

```text
Create room
  -> backend generates code, for example BINGO-7421
  -> caller shares room code with players
  -> caller starts game
  -> caller calls numbers
  -> caller resets or finishes room
```

Player flow:

```text
Enter room code
  -> enter player name
  -> backend creates/reuses player session
  -> backend creates board
  -> player marks called numbers
  -> backend records marked numbers
  -> backend records winner when bingo is verified
```

## HTTP API

Suggested routes:

```text
POST /api/rooms
GET  /api/rooms/:code
POST /api/rooms/:code/join
POST /api/rooms/:code/start
POST /api/rooms/:code/stop
POST /api/rooms/:code/call-number
POST /api/rooms/:code/reset
POST /api/boards/:boardId/mark
POST /api/boards/:boardId/bingo
```

### `POST /api/rooms`

Creates a new room.

Request:

```json
{
  "callerKey": "private caller key"
}
```

Response:

```json
{
  "roomId": "uuid",
  "code": "BINGO-7421",
  "status": "waiting"
}
```

Store only a hash of `callerKey`, never the raw key.

### `POST /api/rooms/:code/join`

Adds a player to a room and creates or returns their board.

Request:

```json
{
  "name": "Abhishek",
  "sessionId": "browser-session-id"
}
```

Response:

```json
{
  "playerId": "uuid",
  "boardId": "uuid",
  "board": [1, 7, 14, 22, 5, 3, 9, 18, 24, 11, 2, 6, 13, 20, 25, 4, 8, 15, 19, 23, 10, 12, 16, 17, 21],
  "room": {
    "code": "BINGO-7421",
    "status": "waiting"
  }
}
```

### `GET /api/rooms/:code`

Returns the full room state needed to hydrate a client.

Response:

```json
{
  "code": "BINGO-7421",
  "status": "active",
  "calledNumbers": [4, 19, 7],
  "playerCount": 8,
  "winners": [
    {
      "playerId": "uuid",
      "name": "Abhishek",
      "wonAt": "2026-05-28T09:45:00.000Z"
    }
  ]
}
```

### `POST /api/rooms/:code/call-number`

Caller-only route. Records a called number and broadcasts it to everyone in the
room.

Request:

```json
{
  "callerKey": "private caller key",
  "number": 17
}
```

### `POST /api/boards/:boardId/mark`

Stores the player's marked numbers.

Request:

```json
{
  "sessionId": "browser-session-id",
  "markedNumbers": [4, 7, 17]
}
```

## Socket.IO Events

Clients should join only the Socket.IO room matching their bingo room code.

Client to server:

```text
join-room
leave-room
```

Server to client:

```text
room-state
player-count-changed
game-started
game-stopped
number-called
winner-added
game-reset
error
```

Example payloads:

```js
socket.emit("join-room", {
  code: "BINGO-7421",
  playerId: "uuid"
});
```

```js
io.to("BINGO-7421").emit("number-called", {
  number: 17,
  calledNumbers: [4, 19, 7, 17]
});
```

## Frontend Changes

Current Firebase calls should be replaced with API and socket calls.

Main changes:

- Remove Firebase imports and `firebase-config.js`.
- Add a small API client, for example `api.js`.
- Add a Socket.IO client connection.
- Add room UI:
  - Create Room
  - Join Room
  - Room Code display
  - Player name input
- Scope all board, caller, reset, and winner behavior to the active room.
- Keep `sessionId` in `localStorage` so refreshes can reconnect the same player.

Suggested frontend state:

```js
const state = {
  roomCode: null,
  roomStatus: "waiting",
  playerId: null,
  boardId: null,
  sessionId: null,
  board: [],
  markedNumbers: [],
  calledNumbers: [],
  winners: []
};
```

## Security Requirements

Minimum security for the first VPS version:

- Never expose Postgres credentials to the browser.
- Store `DATABASE_URL` only in Coolify environment variables.
- Hash caller keys with bcrypt or argon2.
- Validate caller-only routes on the backend.
- Validate all numbers server-side.
- Prevent duplicate called numbers per room with a database unique constraint.
- Prevent players from updating another player's board.
- Use HTTPS for the public Coolify app URL.

Better production security:

- Replace caller key with login-based authentication.
- Add rate limiting on room creation and join attempts.
- Add room expiry/cleanup.
- Add audit fields for caller actions.
- Add invite-only/private room options.

## Coolify Deployment Plan

1. Create a Postgres service in Coolify.
2. Copy the generated internal database URL.
3. Create a Node.js app in Coolify pointing to this repository.
4. Add environment variables:

```text
DATABASE_URL=postgres://...
NODE_ENV=production
PORT=3000
```

5. Run migrations using `server/schema.sql`.
6. Start the backend with a command such as:

```text
npm start
```

7. Expose the app through Coolify's domain/HTTPS settings.
8. Test from two browser windows:
   - Caller creates room.
   - Player joins room.
   - Caller calls a number.
   - Player receives update without refreshing.

## Migration Checklist

Implementation order:

1. Add `server/` with Express, Socket.IO, and Postgres connection.
2. Add `server/schema.sql`.
3. Implement room creation and join routes.
4. Implement room state route.
5. Implement caller-only start, stop, call number, and reset routes.
6. Implement board mark and bingo routes.
7. Add Socket.IO room joining and broadcasts.
8. Replace Firebase code in `index.html`, `bingo.js`, and `numberboard.js`.
9. Add room create/join UI.
10. Deploy to Coolify with Postgres.
11. Remove Firebase-specific files once the new backend is working.

## Open Decisions

These decisions should be made before implementation:

- Should rooms be public by code only, or protected by a room password?
- Should the caller key be per room or one global admin/caller login?
- Should rooms expire automatically after a few hours or stay forever?
- Should players be limited to 10 per room, matching the current UI?
- Should one browser be allowed to join multiple rooms at the same time?
