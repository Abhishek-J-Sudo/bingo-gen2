require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, "..");
const PLAYER_NAMES = [
  "Excel Ninja",
  "Deadline Daku",
  "Chill Operator",
  "Jugaadu Analyst",
  "Masti Manager",
  "Gentle Ghoster",
  "PowerPoint Pandit",
  "Reminder Raja",
  "Thanda TL",
  "Approval Baba"
];

app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  const blocked = [
    "/server/",
    "/package.json",
    "/package-lock.json",
    "/database.rules.json",
    "/firebase-config.js",
    "/firebase-config.example.js"
  ];

  if (blocked.some((pathPrefix) => req.path === pathPrefix || req.path.startsWith(pathPrefix))) {
    return res.sendStatus(404);
  }

  next();
});
app.use(express.static(ROOT_DIR, {
  extensions: ["html"],
  index: "index.html"
}));

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";

  for (let i = 0; i < 5; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return `BINGO-${suffix}`;
}

function generateNumbers() {
  const numbers = Array.from({ length: 25 }, (_, index) => index + 1);

  for (let i = numbers.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  return numbers;
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
  if (!Array.isArray(markedNumbers)) {
    return [];
  }

  return [...new Set(markedNumbers
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 25))];
}

function hasBingo(numbers, markedNumbers, calledNumbers) {
  const marked = new Set(markedNumbers);
  const called = new Set(calledNumbers);
  const validMarked = numbers.every((number) => !marked.has(number) || called.has(number));

  if (!validMarked) {
    return false;
  }

  const isMarkedAt = (row, column) => marked.has(numbers[(row * 5) + column]);

  for (let row = 0; row < 5; row += 1) {
    if ([0, 1, 2, 3, 4].every((column) => isMarkedAt(row, column))) {
      return true;
    }
  }

  for (let column = 0; column < 5; column += 1) {
    if ([0, 1, 2, 3, 4].every((row) => isMarkedAt(row, column))) {
      return true;
    }
  }

  return [0, 1, 2, 3, 4].every((index) => isMarkedAt(index, index)) ||
    [0, 1, 2, 3, 4].every((index) => isMarkedAt(index, 4 - index));
}

async function createUniqueRoomCode(client) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateRoomCode();
    const existing = await client.query("select id from rooms where code = $1", [code]);

    if (existing.rowCount === 0) {
      return code;
    }
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

  return result.rows.map((row) => row.number);
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

  return result.rows.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    name: row.name,
    wonAt: row.won_at
  }));
}

async function getRoomState(room) {
  const [calledNumbers, winners, playerCountResult] = await Promise.all([
    getCalledNumbers(room.id),
    getWinners(room.id),
    db.query("select count(*)::int as count from players where room_id = $1", [room.id])
  ]);

  return {
    roomId: room.id,
    code: room.code,
    status: room.status,
    locked: room.status === "active",
    calledNumbers,
    winners,
    playerCount: playerCountResult.rows[0].count
  };
}

async function assertCaller(room, callerKey) {
  const ok = await bcrypt.compare(String(callerKey || ""), room.caller_key_hash);

  if (!ok) {
    const error = new Error("Invalid caller key.");
    error.status = 401;
    throw error;
  }
}

async function emitRoomState(room) {
  const state = await getRoomState(room);
  io.to(room.code).emit("room-state", state);
  return state;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/rooms", asyncHandler(async (req, res) => {
  const callerKey = String(req.body.callerKey || "");

  if (callerKey.length < 4) {
    return res.status(400).json({ error: "Caller key must be at least 4 characters." });
  }

  const result = await db.withTransaction(async (client) => {
    const code = await createUniqueRoomCode(client);
    const callerKeyHash = await bcrypt.hash(callerKey, 12);

    const roomResult = await client.query(
      "insert into rooms (code, caller_key_hash) values ($1, $2) returning *",
      [code, callerKeyHash]
    );

    return roomResult.rows[0];
  });

  res.status(201).json(await getRoomState(result));
}));

app.get("/api/rooms/:code", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  res.json(await getRoomState(room));
}));

app.post("/api/rooms/:code/join", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  const sessionId = normalizeSessionId(req.body.sessionId);
  const requestedName = normalizePlayerName(req.body.name);

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required." });
  }

  const joined = await db.withTransaction(async (client) => {
    const existing = await client.query(
      `select players.*, boards.id as board_id, boards.numbers, boards.marked_numbers
       from players
       left join boards on boards.player_id = players.id
       where players.room_id = $1 and players.session_id = $2`,
      [room.id, sessionId]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const name = requestedName || row.name;

      if (name !== row.name) {
        await client.query(
          "update players set name = $1, updated_at = now() where id = $2",
          [name, row.id]
        );
      }

      return {
        playerId: row.id,
        playerName: name,
        boardId: row.board_id,
        numbers: row.numbers,
        markedNumbers: row.marked_numbers || []
      };
    }

    const assignedNames = await client.query(
      "select name from players where room_id = $1",
      [room.id]
    );
    const takenNames = new Set(assignedNames.rows.map((row) => row.name));
    const generatedName = PLAYER_NAMES.find((name) => !takenNames.has(name)) ||
      `Player ${crypto.randomInt(100, 999)}`;
    const name = requestedName || generatedName;

    const playerResult = await client.query(
      "insert into players (room_id, name, session_id) values ($1, $2, $3) returning *",
      [room.id, name, sessionId]
    );
    const player = playerResult.rows[0];
    const numbers = generateNumbers();
    const boardResult = await client.query(
      "insert into boards (room_id, player_id, numbers) values ($1, $2, $3) returning *",
      [room.id, player.id, JSON.stringify(numbers)]
    );
    const board = boardResult.rows[0];

    return {
      playerId: player.id,
      playerName: player.name,
      boardId: board.id,
      numbers: board.numbers,
      markedNumbers: board.marked_numbers || []
    };
  });

  const state = await emitRoomState(room);

  res.json({
    ...joined,
    room: state
  });
}));

app.post("/api/rooms/:code/start", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  await assertCaller(room, req.body.callerKey);
  const result = await db.query(
    "update rooms set status = 'active', updated_at = now() where id = $1 returning *",
    [room.id]
  );
  const state = await emitRoomState(result.rows[0]);

  io.to(room.code).emit("game-started", state);
  res.json(state);
}));

app.post("/api/rooms/:code/stop", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  await assertCaller(room, req.body.callerKey);
  const result = await db.query(
    "update rooms set status = 'waiting', updated_at = now() where id = $1 returning *",
    [room.id]
  );
  const state = await emitRoomState(result.rows[0]);

  io.to(room.code).emit("game-stopped", state);
  res.json(state);
}));

app.post("/api/rooms/:code/call-number", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  const number = Number(req.body.number);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  if (!Number.isInteger(number) || number < 1 || number > 25) {
    return res.status(400).json({ error: "Number must be between 1 and 25." });
  }

  await assertCaller(room, req.body.callerKey);

  await db.query(
    "insert into called_numbers (room_id, number) values ($1, $2) on conflict do nothing",
    [room.id, number]
  );

  const state = await emitRoomState(room);
  io.to(room.code).emit("number-called", { number, calledNumbers: state.calledNumbers });
  res.json(state);
}));

app.post("/api/rooms/:code/reset", asyncHandler(async (req, res) => {
  const room = await getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }

  await assertCaller(room, req.body.callerKey);

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

app.post("/api/boards/:boardId/reset", asyncHandler(async (req, res) => {
  const boardResult = await db.query(
    `select boards.*, rooms.status, rooms.code
     from boards
     join rooms on rooms.id = boards.room_id
     join players on players.id = boards.player_id
     where boards.id = $1 and players.session_id = $2`,
    [req.params.boardId, normalizeSessionId(req.body.sessionId)]
  );

  if (boardResult.rowCount === 0) {
    return res.status(404).json({ error: "Board not found." });
  }

  const board = boardResult.rows[0];

  if (board.status === "active") {
    return res.status(409).json({ error: "Game is active. Board cannot be reset now." });
  }

  const numbers = generateNumbers();
  const result = await db.query(
    "update boards set numbers = $1, marked_numbers = '[]'::jsonb, updated_at = now() where id = $2 returning *",
    [JSON.stringify(numbers), board.id]
  );

  res.json({
    boardId: result.rows[0].id,
    numbers: result.rows[0].numbers,
    markedNumbers: result.rows[0].marked_numbers || []
  });
}));

app.post("/api/boards/:boardId/mark", asyncHandler(async (req, res) => {
  const sessionId = normalizeSessionId(req.body.sessionId);
  const markedNumbers = normalizeMarkedNumbers(req.body.markedNumbers);
  const result = await db.query(
    `update boards
     set marked_numbers = $1, updated_at = now()
     from players
     where boards.id = $2
       and boards.player_id = players.id
       and players.session_id = $3
     returning boards.*`,
    [JSON.stringify(markedNumbers), req.params.boardId, sessionId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Board not found." });
  }

  res.json({
    boardId: result.rows[0].id,
    markedNumbers: result.rows[0].marked_numbers || []
  });
}));

app.post("/api/boards/:boardId/bingo", asyncHandler(async (req, res) => {
  const sessionId = normalizeSessionId(req.body.sessionId);
  const boardResult = await db.query(
    `select boards.*, players.name, rooms.code, rooms.status
     from boards
     join players on players.id = boards.player_id
     join rooms on rooms.id = boards.room_id
     where boards.id = $1 and players.session_id = $2`,
    [req.params.boardId, sessionId]
  );

  if (boardResult.rowCount === 0) {
    return res.status(404).json({ error: "Board not found." });
  }

  const board = boardResult.rows[0];
  const calledNumbers = await getCalledNumbers(board.room_id);
  const winner = hasBingo(board.numbers, board.marked_numbers || [], calledNumbers);

  if (!winner || board.status !== "active") {
    return res.status(409).json({ error: "Bingo is not valid yet." });
  }

  await db.query(
    "insert into winners (room_id, player_id) values ($1, $2) on conflict do nothing",
    [board.room_id, board.player_id]
  );

  const room = await getRoomByCode(board.code);
  const state = await emitRoomState(room);
  io.to(room.code).emit("winner-added", state);
  res.json(state);
}));

io.on("connection", (socket) => {
  socket.on("join-room", async ({ code }) => {
    const room = await getRoomByCode(code);

    if (!room) {
      socket.emit("error", { error: "Room not found." });
      return;
    }

    socket.join(room.code);
    socket.emit("room-state", await getRoomState(room));
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Unexpected server error."
  });
});

db.migrate()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`BingoGen listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
