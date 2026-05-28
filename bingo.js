const state = {
    roomCode:   localStorage.getItem("bingoRoomCode")   || "",
    roomStatus: "waiting",
    callerKey:  sessionStorage.getItem("bingoCallerKey") || "",
    playerId:   localStorage.getItem("bingoPlayerId")   || "",
    boardId:    localStorage.getItem("bingoboardId")    || "",
    sessionId:  localStorage.getItem("bingoSessionId")  || generateSessionId(),
    playerName: localStorage.getItem("bingoPlayerName") || "",
    boardNumbers:  [],
    markedNumbers: [],
    calledNumbers: [],
    winners: [],
    socket: null
};

localStorage.setItem("bingoSessionId", state.sessionId);

function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function getCellNumbers(selector) {
    return Array.from(document.querySelectorAll(selector))
        .map((cell) => Number(cell.textContent))
        .filter((n) => Number.isInteger(n));
}

// ─── View switching ───────────────────────────────────────

function showLobbyView() {
    document.getElementById("lobby-view").classList.add("active");
    document.getElementById("game-view").classList.remove("active");
}

function showGameView() {
    document.getElementById("lobby-view").classList.remove("active");
    document.getElementById("game-view").classList.add("active");

    // Auto-unlock host controls if we already have a caller key
    if (state.callerKey && window.BingoCaller && typeof window.BingoCaller.unlockWithKey === "function") {
        window.BingoCaller.unlockWithKey(state.callerKey);
    }
}

// ─── Display helpers ─────────────────────────────────────

function setRoomLabel() {
    const el = document.getElementById("roomCodeDisplay");
    if (el) el.textContent = state.roomCode || "—";
}

function updatePlayerNameDisplay() {
    const el = document.getElementById("playerName");
    if (el) el.textContent = state.playerName ? `Name: ${state.playerName}` : "Name: —";
}

function updatePlayerCountDisplay(playerCount = 0) {
    const el = document.getElementById("playerCount");
    if (el) el.textContent = `${playerCount}/10`;
}

function updateGameStatusDisplay() {
    const statusEl   = document.getElementById("gameStatus");
    const playerReset = document.getElementById("playerReset");
    const resetBtn   = document.getElementById("reset");
    const locked     = state.roomStatus === "active";

    if (statusEl) {
        statusEl.textContent       = locked ? "In Progress" : "Waiting";
        statusEl.dataset.status    = locked ? "active"      : "waiting";
    }

    if (playerReset) {
        playerReset.classList.toggle("game-locked", locked);
        playerReset.disabled       = !state.boardId || locked;
        playerReset.style.opacity  = playerReset.disabled ? "0.4" : "1";
    }

    if (resetBtn) {
        resetBtn.disabled          = !state.callerKey;
        resetBtn.style.opacity     = resetBtn.disabled ? "0.4" : "1";
    }
}

// ─── Board rendering ─────────────────────────────────────

function renderBoard(numbers, markedNumbers = []) {
    const table = document.getElementById("bingoTable");
    if (!table) return;

    table.innerHTML = "";

    const headerRow = table.insertRow();
    ["B", "I", "N", "G", "O"].forEach((letter) => {
        const th = document.createElement("th");
        th.innerText = letter;
        headerRow.appendChild(th);
    });

    let idx = 0;
    for (let r = 0; r < 5; r++) {
        const row = table.insertRow();
        for (let c = 0; c < 5; c++) {
            const cell   = row.insertCell();
            const number = numbers[idx];
            cell.innerText = number;
            if (markedNumbers.includes(number)) cell.classList.add("marked");
            idx++;
        }
    }

    attachCellClickListeners();
}

function attachCellClickListeners() {
    document.querySelectorAll("#bingoTable td").forEach((cell) => {
        cell.removeEventListener("click", handleCellClick);
        cell.addEventListener("click", handleCellClick);
    });
}

async function handleCellClick(event) {
    const cell = event.target;

    if (state.roomStatus !== "active") {
        alert("Game hasn't started yet. Wait for the host to start the game.");
        return;
    }

    cell.classList.toggle("marked");
    state.markedNumbers = getCellNumbers("#bingoTable td.marked");

    try {
        await BingoApi.markBoard(state.boardId, state.sessionId, state.markedNumbers);
        await checkBingo();
    } catch (error) {
        alert(error.message);
    }
}

async function resetPlayerBoard() {
    if (!state.boardId) {
        alert("Join a room first.");
        return;
    }
    if (state.roomStatus === "active") {
        alert("Game is in progress — you can't reset your board right now.");
        return;
    }

    try {
        const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];
        renderBoard(state.boardNumbers, state.markedNumbers);
    } catch (error) {
        alert(error.message);
    }
}

async function checkBingo() {
    const marked = new Set(state.markedNumbers);
    const called = new Set(state.calledNumbers);

    if (state.markedNumbers.length > 0 && !state.markedNumbers.every((n) => called.has(n))) {
        alert("Number not called");
        return;
    }

    const isMarkedAt = (r, c) => marked.has(state.boardNumbers[r * 5 + c]);
    const idx        = [0, 1, 2, 3, 4];
    const hasWin     =
        idx.some((r) => idx.every((c) => isMarkedAt(r, c))) ||
        idx.some((c) => idx.every((r) => isMarkedAt(r, c))) ||
        idx.every((i) => isMarkedAt(i, i))                  ||
        idx.every((i) => isMarkedAt(i, 4 - i));

    if (!hasWin) return;

    try {
        const roomState = await BingoApi.claimBingo(state.boardId, state.sessionId);
        applyRoomState(roomState);
        if (typeof launchConfetti === "function") launchConfetti();
    } catch (error) {
        alert(error.message);
    }
}

function updateCalledNumbersList() {
    const list = document.getElementById("calledNumbersList");
    if (!list) return;
    list.innerHTML = state.calledNumbers.map((n) => `<div>${n}</div>`).join("");
}

function renderWinners() {
    const el = document.getElementById("winnersList");
    if (!el) return;

    if (!state.winners.length) {
        el.textContent = "No winners yet";
        return;
    }

    el.innerHTML = "";
    state.winners.forEach((winner) => {
        const div = document.createElement("div");
        div.textContent = `${winner.name} — ${new Date(winner.wonAt).toLocaleTimeString()}`;
        el.appendChild(div);
    });
}

function applyRoomState(roomState) {
    if (!roomState) return;

    state.roomCode     = roomState.code          || state.roomCode;
    state.roomStatus   = roomState.status        || state.roomStatus;
    state.calledNumbers = roomState.calledNumbers || [];
    state.winners      = roomState.winners        || [];

    localStorage.setItem("bingoRoomCode", state.roomCode);

    setRoomLabel();
    updateGameStatusDisplay();
    updatePlayerCountDisplay(roomState.playerCount || 0);
    updateCalledNumbersList();
    renderWinners();

    if (window.BingoCaller && typeof window.BingoCaller.applyRoomState === "function") {
        window.BingoCaller.applyRoomState(roomState);
    }
}

// ─── Socket ──────────────────────────────────────────────

function connectSocket(code) {
    if (!code || !window.io) return;

    if (!state.socket) {
        state.socket = window.io();

        state.socket.on("room-state", applyRoomState);

        state.socket.on("number-called", (payload) => {
            state.calledNumbers = payload.calledNumbers || state.calledNumbers;
            updateCalledNumbersList();
            if (window.BingoCaller && typeof window.BingoCaller.markCalledNumbers === "function") {
                window.BingoCaller.markCalledNumbers(state.calledNumbers);
            }
        });

        state.socket.on("game-reset", (roomState) => {
            state.markedNumbers = [];
            applyRoomState(roomState);
            renderBoard(state.boardNumbers, []);
            alert("The host has reset the game.");
        });

        state.socket.on("winner-added", applyRoomState);

        state.socket.on("error", (payload) => {
            if (payload && payload.error) alert(payload.error);
        });
    }

    state.socket.emit("join-room", { code });
}

// ─── Room actions ─────────────────────────────────────────

async function createRoom() {
    const callerKeyInput = document.getElementById("lobbyCallerKey");
    const callerKey      = callerKeyInput ? callerKeyInput.value.trim() : "";

    if (callerKey.length < 4) {
        alert("Caller key must be at least 4 characters.");
        return;
    }

    try {
        // Create the room
        const room = await BingoApi.createRoom(callerKey);
        state.callerKey = callerKey;
        sessionStorage.setItem("bingoCallerKey", callerKey);

        // Auto-join as player so the host also gets a board
        const name = document.getElementById("playerNameInput")?.value.trim() || "";
        const data = await BingoApi.joinRoom(room.code, name, state.sessionId);

        state.roomCode     = data.room.code;
        state.playerId     = data.playerId;
        state.boardId      = data.boardId;
        state.playerName   = data.playerName;
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        localStorage.setItem("bingoRoomCode",    state.roomCode);
        localStorage.setItem("bingoPlayerId",    state.playerId);
        localStorage.setItem("bingoboardId",     state.boardId);
        localStorage.setItem("bingoPlayerName",  state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
        showGameView(); // will auto-unlock since callerKey is now set
    } catch (error) {
        alert(error.message);
    }
}

async function joinRoom() {
    const code = document.getElementById("roomCodeInput")?.value.trim().toUpperCase() || "";
    const name = document.getElementById("playerNameInput")?.value.trim() || "";

    if (!code) {
        alert("Enter a room code.");
        return;
    }

    try {
        const data = await BingoApi.joinRoom(code, name, state.sessionId);

        state.roomCode     = data.room.code;
        state.playerId     = data.playerId;
        state.boardId      = data.boardId;
        state.playerName   = data.playerName;
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        localStorage.setItem("bingoRoomCode",   state.roomCode);
        localStorage.setItem("bingoPlayerId",   state.playerId);
        localStorage.setItem("bingoboardId",    state.boardId);
        localStorage.setItem("bingoPlayerName", state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
        showGameView();
    } catch (error) {
        alert(error.message);
    }
}

// Unlock from the lobby: host enters room code + caller key without a board
async function unlockFromLobby() {
    const code      = document.getElementById("roomCodeInput")?.value.trim().toUpperCase() || state.roomCode;
    const callerKey = document.getElementById("lobbyCallerKey")?.value.trim() || "";

    if (!code) {
        alert("Enter the room code first.");
        return;
    }
    if (!callerKey) {
        alert("Enter your caller key.");
        return;
    }

    // Join the room to restore state (or create a session), then unlock
    try {
        const name = document.getElementById("playerNameInput")?.value.trim() || state.playerName || "";
        const data = await BingoApi.joinRoom(code, name, state.sessionId);

        state.roomCode     = data.room.code;
        state.callerKey    = callerKey;
        state.playerId     = data.playerId;
        state.boardId      = data.boardId;
        state.playerName   = data.playerName;
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        sessionStorage.setItem("bingoCallerKey",  callerKey);
        localStorage.setItem("bingoRoomCode",     state.roomCode);
        localStorage.setItem("bingoPlayerId",     state.playerId);
        localStorage.setItem("bingoboardId",      state.boardId);
        localStorage.setItem("bingoPlayerName",   state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
        showGameView(); // auto-unlocks via callerKey
    } catch (error) {
        alert(error.message);
    }
}

async function restoreRoom() {
    if (!state.roomCode) return; // stay on lobby

    try {
        const data = await BingoApi.joinRoom(state.roomCode, state.playerName, state.sessionId);

        state.playerId     = data.playerId;
        state.boardId      = data.boardId;
        state.playerName   = data.playerName;
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        localStorage.setItem("bingoPlayerId",   state.playerId);
        localStorage.setItem("bingoboardId",    state.boardId);
        localStorage.setItem("bingoPlayerName", state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
        showGameView();
    } catch (error) {
        console.warn("Could not restore room:", error.message);
        // Clear stale state and stay on lobby
        localStorage.removeItem("bingoRoomCode");
        localStorage.removeItem("bingoPlayerId");
        localStorage.removeItem("bingoboardId");
        state.roomCode = "";
        state.playerId = "";
        state.boardId  = "";
    }
}

function leaveRoom() {
    if (!confirm("Leave this room?")) return;

    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }

    ["bingoRoomCode", "bingoPlayerId", "bingoboardId", "bingoPlayerName"].forEach(
        (k) => localStorage.removeItem(k)
    );
    sessionStorage.removeItem("bingoCallerKey");

    Object.assign(state, {
        roomCode: "", playerId: "", boardId: "", playerName: "",
        callerKey: "", boardNumbers: [], markedNumbers: [],
        calledNumbers: [], winners: [], roomStatus: "waiting"
    });

    const table = document.getElementById("bingoTable");
    if (table) table.innerHTML = "";

    updateCalledNumbersList();
    renderWinners();
    updatePlayerNameDisplay();
    setRoomLabel();

    if (window.BingoCaller && typeof window.BingoCaller.lock === "function") {
        window.BingoCaller.lock();
    }

    showLobbyView();
}

// ─── Init ─────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("createRoom")?.addEventListener("click", createRoom);
    document.getElementById("joinRoom")?.addEventListener("click", joinRoom);
    document.getElementById("unlock")?.addEventListener("click", unlockFromLobby);
    document.getElementById("playerReset")?.addEventListener("click", resetPlayerBoard);
    document.getElementById("leaveRoom")?.addEventListener("click", leaveRoom);

    // Enter key shortcuts on lobby inputs
    ["roomCodeInput", "playerNameInput"].forEach((id) => {
        document.getElementById(id)?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") joinRoom();
        });
    });

    document.getElementById("lobbyCallerKey")?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") createRoom();
    });

    restoreRoom();
});

window.BingoApp = {
    state,
    applyRoomState,
    connectSocket,
    updateCalledNumbersList
};
