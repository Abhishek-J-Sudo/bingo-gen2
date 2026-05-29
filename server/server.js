require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, "..");
const ROLL_DURATION_MS = 1800;
const rollingRooms = new Set();
const socketRooms = new Map();         // socket.id → { code, sessionId }
const hostDisconnectTimers = new Map();   // `${sessionId}:${code}` → timer
const playerDisconnectTimers = new Map(); // `${sessionId}:${code}` → timer

const PLAYER_NAMES = [
  "Excel Ninja", "Deadline Daku", "Chill Operator", "Jugaadu Analyst",
  "Masti Manager", "Gentle Ghoster", "PowerPoint Pandit",
  "Reminder Raja", "Thanda TL", "Approval Baba"
];

app.use(express.json({ limit: "64kb" }));

app.use((req, res, next) => {
  const blocked = [
    "/server/", "/package.json", "/package-lock.json",
    "/database.rules.json", "/firebase-config.js", "/firebase-config.example.js"
  ];
  if (blocked.some((p) => req.path === p || req.path.startsWith(p))) {
    return res.sendStatus(404);
  }
  next();
});

app.use(express.static(ROOT_DIR, { extensions: ["html"], index: "index.html" }));

// ─── Helpers ──────────────────────────────────────────────

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 5; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `BINGO-${suffix}`;
}

function generateNumbers() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function pickRandomItem(items) {
  return items[crypto.randomInt(items.length)];
}

function buildRollSequence(remainingNumbers, finalNumber) {
  const sequence = [];
  const pool = remainingNumbers.length ? remainingNumbers : [finalNumber];

  for (let i = 0; i < 14; i++) {
    sequence.push(pickRandomItem(pool));
  }

  sequence.push(finalNumber);
  return sequence;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeSessionId(sessionId) {
  return String(sessionId || "").trim().slice(0, 128);
}

function normalizePlayerName(name) {
  return String(name || "").trim().slice(0, 40);
}

function normalizeMarkedNumbers(markedNumbers) {
  if (!Array.isArray(markedNumbers)) return [];
  return [...new Set(
    markedNumbers
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 25)
  )];
}

function hasBingo(numbers, markedNumbers, calledNumbers) {
  const marked = new Set(markedNumbers);
  const called = new Set(calledNumbers);

  if (!numbers.every((n) => !marked.has(n) || called.has(n))) return false;

  const isMarkedAt = (r, c) => marked.has(numbers[r * 5 + c]);

  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every((c) => isMarkedAt(r, c))) return true;
  }
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every((r) => isMarkedAt(r, c))) return true;
  }
  return [0,1,2,3,4].every((i) => isMarkedAt(i, i)) ||
         [0,1,2,3,4].every((i) => isMarkedAt(i, 4 - i));
}

async function createUniqueRoomCode(client) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const existing = await client.query("select id from rooms where code = $1", [code]);
    if (existing.rowCount === 0) return code;
  }
  throw new Error("Unable to generate a unique room code.");
}

async function getRoomByCode(code) {
  const result = await db.query("select * from rooms where code = $1", [normalizeCode(code)]);
  return result.rows[0] || null;
}

async function getCalledNumbers(roomId) {
  const result = await db.query(
    "select number from called_numbers where room_id = $1 order by id asc",
    [roomId]
  );
  return result.rows.map((r) => r.number);
}

async function getWinners(roomId) {
  const result = await db.query(
    `select winners.id, winners.won_at, players.id as player_id, players.name
     from winners
     join players on players.id = winners.player_id
     where winners.room_id = $1
     order by winners.won_at asc`,
    [roomId]
  );
  return result.rows.map((r) => ({ id: r.id, playerId: r.player_id, name: r.name, wonAt: r.won_at }));
}

async function getRoomState(room) {
  const [calledNumbers, winners, countResult, playersResult, hostPlayerResult] = await Promise.all([
    getCalledNumbers(room.id),
    getWinners(room.id),
    db.query("select count(*)::int as count from players where room_id = $1", [room.id]),
    db.query("select id, name from players where room_id = $1 order by created_at", [room.id]),
    room.host_session_id
      ? db.query("select id from players where room_id = $1 and session_id = $2", [room.id, room.host_session_id])
      : Promise.resolve({ rows: [] })
  ]);

  return {
    roomId:      room.id,
    code:        room.code,
    status:      room.status,
    locked:      room.status === "active",
    calledNumbers,
    winners,
    playerCount: countResult.rows[0].count,
    players:     playersResult.rows.map((p) => ({ id: p.id, name: p.name })),
    hostPlayerId: hostPlayerResult.rows[0]?.id || null
  };
}

// Verifies the request comes from the current host
function assertHost(room, sessionId) {
  const normalized = normalizeSessionId(sessionId);
  if (!room.host_session_id || room.host_session_id !== normalized) {
    const err = new Error("Not authorized as host.");
    err.status = 403;
    throw err;
  }
}

async function emitRoomState(room) {
  const state = await getRoomState(room);
  io.to(room.code).emit("room-state", state);
  return state;
}

// ─── Routes ───────────────────────────────────────────────

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Create room — creator's sessionId becomes the host identity
app.post("/api/rooms", asyncHandler(async (req, res) => {
  const sessionId = normalizeSessionId(req.body.sessionId);

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required." });
  }

  const room = await db.withTransaction(async (client) => {
    const code = await createUniqueRoomCode(client);
    const result = await client.query(
      "insert into rooms (code, host_session_id) values ($1, $2) returning *",
      [code, sessionId]
    );
    return result.rows[0];
  });

  res.status(201).json(await getRoomState(room));
}));

app.get("/api/rooms/:code", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });
  res.json(await getRoomState(room));
}));

app.post("/api/rooms/:code/join", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });

  const sessionId     = normalizeSessionId(req.body.sessionId);
  const requestedName = normalizePlayerName(req.body.name);

  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

  const joined = await db.withTransaction(async (client) => {
    const existing = await client.query(
      `select players.*, boards.id as board_id, boards.numbers, boards.marked_numbers
       from players
       left join boards on boards.player_id = players.id
       where players.room_id = $1 and players.session_id = $2`,
      [room.id, sessionId]
    );

    if (existing.rowCount > 0) {
      const row  = existing.rows[0];
      const name = requestedName || row.name;
      if (name !== row.name) {
        await client.query(
          "update players set name = $1, updated_at = now() where id = $2",
          [name, row.id]
        );
      }
      return { playerId: row.id, playerName: name, boardId: row.board_id, numbers: row.numbers, markedNumbers: row.marked_numbers || [] };
    }

    const countResult = await client.query(
      "select count(*)::int as count from players where room_id = $1",
      [room.id]
    );
    if (countResult.rows[0].count >= 10) {
      const err = new Error("This room is full (10 players max).");
      err.status = 409;
      throw err;
    }

    const takenNames = new Set(
      (await client.query("select name from players where room_id = $1", [room.id])).rows.map((r) => r.name)
    );
    const autoName = PLAYER_NAMES.find((n) => !takenNames.has(n)) || `Player ${crypto.randomInt(100, 999)}`;
    const name = requestedName || autoName;

    const player = (await client.query(
      "insert into players (room_id, name, session_id) values ($1, $2, $3) returning *",
      [room.id, name, sessionId]
    )).rows[0];

    const numbers = generateNumbers();
    const board = (await client.query(
      "insert into boards (room_id, player_id, numbers) values ($1, $2, $3) returning *",
      [room.id, player.id, JSON.stringify(numbers)]
    )).rows[0];

    return { playerId: player.id, playerName: player.name, boardId: board.id, numbers: board.numbers, markedNumbers: board.marked_numbers || [] };
  });

  const state = await emitRoomState(room);
  res.json({ ...joined, room: state });
}));

app.post("/api/rooms/:code/start", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });

  assertHost(room, req.body.sessionId);

  const updated = (await db.query(
    "update rooms set status = 'active', updated_at = now() where id = $1 returning *",
    [room.id]
  )).rows[0];

  const state = await emitRoomState(updated);
  io.to(room.code).emit("game-started", state);
  res.json(state);
}));

app.post("/api/rooms/:code/stop", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });

  assertHost(room, req.body.sessionId);

  if (rollingRooms.has(room.id)) {
    return res.status(409).json({ error: "Wait for the current roll to finish." });
  }

  const updated = (await db.query(
    "update rooms set status = 'waiting', updated_at = now() where id = $1 returning *",
    [room.id]
  )).rows[0];

  const state = await emitRoomState(updated);
  io.to(room.code).emit("game-stopped", state);
  res.json(state);
}));

app.post("/api/rooms/:code/call-number", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) return res.status(404).json({ error: "Room not found." });
  if (room.status !== "active") {
    return res.status(409).json({ error: "Start the game first." });
  }

  assertHost(room, req.body.sessionId);

  if (rollingRooms.has(room.id)) {
    return res.status(409).json({ error: "A roll is already in progress." });
  }

  rollingRooms.add(room.id);

  let calledNumbers;
  try {
    calledNumbers = await getCalledNumbers(room.id);
  } catch (error) {
    rollingRooms.delete(room.id);
    throw error;
  }

  const called = new Set(calledNumbers);
  const remainingNumbers = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !called.has(n));

  if (remainingNumbers.length === 0) {
    rollingRooms.delete(room.id);
    return res.status(409).json({ error: "All numbers have already been called." });
  }

  const number = pickRandomItem(remainingNumbers);
  const sequence = buildRollSequence(remainingNumbers, number);

  io.to(room.code).emit("number-roll", {
    sequence,
    durationMs: ROLL_DURATION_MS
  });

  setTimeout(async () => {
    try {
      await db.query(
        "insert into called_numbers (room_id, number) values ($1, $2) on conflict do nothing",
        [room.id, number]
      );

      const state = await emitRoomState(room);
      io.to(room.code).emit("number-called", { number, calledNumbers: state.calledNumbers });

      if (state.calledNumbers.length === 25 && state.winners.length === 0) {
        await db.query(
          "update rooms set status = 'waiting', updated_at = now() where id = $1",
          [room.id]
        );
        const finalRoom = await getRoomByCode(room.code);
        const finalState = await emitRoomState(finalRoom);
        io.to(room.code).emit("game-over", finalState);
      }
    } catch (error) {
      console.error("Failed to finish number roll:", error);
      io.to(room.code).emit("error", { error: "The number roll failed." });
    } finally {
      rollingRooms.delete(room.id);
    }
  }, ROLL_DURATION_MS);

  res.json({ rolling: true, durationMs: ROLL_DURATION_MS });
}));

app.post("/api/rooms/:code/reset", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });

  assertHost(room, req.body.sessionId);

  if (rollingRooms.has(room.id)) {
    return res.status(409).json({ error: "Wait for the current roll to finish." });
  }

  await db.withTransaction(async (client) => {
    await client.query("delete from winners where room_id = $1", [room.id]);
    await client.query("delete from called_numbers where room_id = $1", [room.id]);
    await client.query("update boards set marked_numbers = '[]'::jsonb, updated_at = now() where room_id = $1", [room.id]);
    await client.query("update rooms set status = 'waiting', updated_at = now() where id = $1", [room.id]);
  });

  const updatedRoom = await getRoomByCode(room.code);
  const state = await emitRoomState(updatedRoom);
  io.to(room.code).emit("game-reset", state);
  res.json(state);
}));

// Transfer host to another player in the room
app.post("/api/rooms/:code/transfer-host", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found." });

  assertHost(room, req.body.sessionId);

  const newHostPlayerId = String(req.body.newHostPlayerId || "").trim();
  if (!newHostPlayerId) {
    return res.status(400).json({ error: "newHostPlayerId is required." });
  }

  const [playerResult, fromHostResult] = await Promise.all([
    db.query("select session_id from players where id = $1 and room_id = $2", [newHostPlayerId, room.id]),
    db.query("select name from players where room_id = $1 and session_id = $2", [room.id, room.host_session_id])
  ]);

  if (playerResult.rowCount === 0) {
    return res.status(404).json({ error: "Player not found in this room." });
  }

  await db.query(
    "update rooms set host_session_id = $1, updated_at = now() where id = $2",
    [playerResult.rows[0].session_id, room.id]
  );

  const updatedRoom = await getRoomByCode(room.code);
  const state = await emitRoomState(updatedRoom);
  const fromName = fromHostResult.rows[0]?.name || null;
  io.to(room.code).emit("host-transferred", { ...state, fromName });
  res.json(state);
}));

app.post("/api/boards/:boardId/reset", asyncHandler(async (req, res) => {
  const boardResult = await db.query(
    `select boards.*, rooms.status, rooms.code
     from boards
     join rooms on rooms.id = boards.room_id
     join players on players.id = boards.player_id
     where boards.id = $1 and players.session_id = $2`,
    [req.params.boardId, normalizeSessionId(req.body.sessionId)]
  );

  if (boardResult.rowCount === 0) return res.status(404).json({ error: "Board not found." });

  const board = boardResult.rows[0];
  if (board.status === "active") return res.status(409).json({ error: "Game is active. Board cannot be reset now." });

  const calledCount = await db.query(
    "select count(*)::int as count from called_numbers where room_id = $1",
    [board.room_id]
  );
  if (calledCount.rows[0].count > 0) {
    return res.status(409).json({ error: "A round is paused. Ask the host to Reset Game before getting a new board." });
  }

  const numbers = generateNumbers();
  const result = await db.query(
    "update boards set numbers = $1, marked_numbers = '[]'::jsonb, updated_at = now() where id = $2 returning *",
    [JSON.stringify(numbers), board.id]
  );

  res.json({ boardId: result.rows[0].id, numbers: result.rows[0].numbers, markedNumbers: result.rows[0].marked_numbers || [] });
}));

app.post("/api/boards/:boardId/mark", asyncHandler(async (req, res) => {
  const sessionId     = normalizeSessionId(req.body.sessionId);
  const markedNumbers = normalizeMarkedNumbers(req.body.markedNumbers);

  const boardResult = await db.query(
    `select boards.*, rooms.status
     from boards
     join rooms on rooms.id = boards.room_id
     join players on players.id = boards.player_id
     where boards.id = $1 and players.session_id = $2`,
    [req.params.boardId, sessionId]
  );

  if (boardResult.rowCount === 0) return res.status(404).json({ error: "Board not found." });

  const board = boardResult.rows[0];
  if (board.status !== "active") {
    return res.status(409).json({ error: "Game has not started yet." });
  }

  const calledNumbers = await getCalledNumbers(board.room_id);
  const called = new Set(calledNumbers);
  if (markedNumbers.some((number) => !called.has(number))) {
    return res.status(409).json({ error: "That number has not been called yet." });
  }

  const result = await db.query(
    "update boards set marked_numbers = $1, updated_at = now() where id = $2 returning *",
    [JSON.stringify(markedNumbers), board.id]
  );

  res.json({ boardId: result.rows[0].id, markedNumbers: result.rows[0].marked_numbers || [] });
}));

app.post("/api/boards/:boardId/bingo", asyncHandler(async (req, res) => {
  const sessionId   = normalizeSessionId(req.body.sessionId);
  const boardResult = await db.query(
    `select boards.*, players.name, rooms.code, rooms.status
     from boards
     join players on players.id = boards.player_id
     join rooms on rooms.id = boards.room_id
     where boards.id = $1 and players.session_id = $2`,
    [req.params.boardId, sessionId]
  );

  if (boardResult.rowCount === 0) return res.status(404).json({ error: "Board not found." });

  const board        = boardResult.rows[0];
  const calledNumbers = await getCalledNumbers(board.room_id);
  const winner       = hasBingo(board.numbers, board.marked_numbers || [], calledNumbers);

  if (!winner || board.status !== "active") {
    return res.status(409).json({ error: "Bingo is not valid yet." });
  }

  const insertResult = await db.query(
    "insert into winners (room_id, player_id) values ($1, $2) on conflict do nothing returning id",
    [board.room_id, board.player_id]
  );

  const room = await getRoomByCode(board.code);

  if (insertResult.rowCount === 0) {
    // Player already recorded as winner — return current state, no new event
    return res.json(await getRoomState(room));
  }

  const state = await emitRoomState(room);
  io.to(room.code).emit("winner-added", state);
  res.json(state);
}));

// ─── Socket ───────────────────────────────────────────────

io.on("connection", (socket) => {
  socket.on("join-room", async ({ code, sessionId }) => {
    const room = await getRoomByCode(code);
    if (!room) {
      socket.emit("error", { error: "Room not found." });
      return;
    }

    const normSessionId = normalizeSessionId(sessionId);
    const timerKey = `${normSessionId}:${room.code}`;

    // Cancel any pending disconnect timers for this session
    if (hostDisconnectTimers.has(timerKey)) {
      clearTimeout(hostDisconnectTimers.get(timerKey));
      hostDisconnectTimers.delete(timerKey);
    }
    if (playerDisconnectTimers.has(timerKey)) {
      clearTimeout(playerDisconnectTimers.get(timerKey));
      playerDisconnectTimers.delete(timerKey);
    }

    socketRooms.set(socket.id, { code: room.code, sessionId: normSessionId });
    socket.join(room.code);
    socket.emit("room-state", await getRoomState(room));
  });

  socket.on("disconnect", async () => {
    const info = socketRooms.get(socket.id);
    socketRooms.delete(socket.id);
    if (!info) return;

    // Only act if no other socket for the same session is still in the room
    const hasOtherSocket = [...socketRooms.values()].some(
      (s) => s.code === info.code && s.sessionId === info.sessionId
    );
    if (hasOtherSocket) return;

    let room;
    try { room = await getRoomByCode(info.code); } catch (_) { return; }
    if (!room) return;

    if (room.host_session_id !== info.sessionId) {
      // Non-host disconnected — 3s grace period in case it's a page refresh
      const timerKey = `${info.sessionId}:${info.code}`;
      const timer = setTimeout(async () => {
        playerDisconnectTimers.delete(timerKey);
        try {
          const currentRoom = await getRoomByCode(info.code);
          if (!currentRoom) return;
          await db.query(
            "delete from players where room_id = $1 and session_id = $2",
            [currentRoom.id, info.sessionId]
          );
          const updatedRoom = await getRoomByCode(info.code);
          await emitRoomState(updatedRoom);
        } catch (err) {
          console.error("Player disconnect cleanup failed:", err);
        }
      }, 3000);
      playerDisconnectTimers.set(timerKey, timer);
      return;
    }

    // Grace period: give the host 8 s to reconnect before transferring
    const timerKey = `${info.sessionId}:${info.code}`;
    const timer = setTimeout(async () => {
      hostDisconnectTimers.delete(timerKey);
      try {
        const currentRoom = await getRoomByCode(info.code);
        if (!currentRoom || currentRoom.host_session_id !== info.sessionId) return;

        const next = await db.query(
          "select session_id from players where room_id = $1 and session_id != $2 order by created_at asc limit 1",
          [currentRoom.id, info.sessionId]
        );
        if (next.rowCount === 0) return; // no one else to give it to

        await db.query(
          "update rooms set host_session_id = $1, updated_at = now() where id = $2",
          [next.rows[0].session_id, currentRoom.id]
        );

        const updatedRoom = await getRoomByCode(info.code);
        const state = await emitRoomState(updatedRoom);
        io.to(info.code).emit("host-transferred", state);
      } catch (err) {
        console.error("Auto host transfer failed:", err);
      }
    }, 8000);

    hostDisconnectTimers.set(timerKey, timer);
  });
});

// ─── Error handler ────────────────────────────────────────

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Unexpected server error."
  });
});

// ─── Start ────────────────────────────────────────────────

db.migrate()
  .then(() => {
    server.listen(PORT, () => console.log(`BingoGen listening on port ${PORT}`));
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
