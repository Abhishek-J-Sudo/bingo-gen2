const state = {
    roomCode:    localStorage.getItem("bingoRoomCode")  || "",
    roomStatus:  "waiting",
    playerId:    localStorage.getItem("bingoPlayerId")  || "",
    boardId:     localStorage.getItem("bingoboardId")   || "",
    sessionId:   localStorage.getItem("bingoSessionId") || generateSessionId(),
    playerName:  localStorage.getItem("bingoPlayerName") || "",
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
}

// ─── Display helpers ──────────────────────────────────────

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
    const statusEl    = document.getElementById("gameStatus");
    const playerReset = document.getElementById("playerReset");
    const locked      = state.roomStatus === "active";

    if (statusEl) {
        statusEl.textContent    = locked ? "In Progress" : "Waiting";
        statusEl.dataset.status = locked ? "active"      : "waiting";
    }

    if (playerReset) {
        playerReset.classList.toggle("game-locked", locked);
        playerReset.disabled      = !state.boardId || locked;
        playerReset.style.opacity = playerReset.disabled ? "0.4" : "1";
    }
}

// ─── Board rendering ──────────────────────────────────────

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
            const cell = row.insertCell();
            cell.innerText = numbers[idx];
            if (markedNumbers.includes(numbers[idx])) cell.classList.add("marked");
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
    const number = Number(cell.textContent);
    const isMarked = cell.classList.contains("marked");

    if (state.roomStatus !== "active") {
        alert("Game hasn't started yet. Wait for the host to start the game.");
        return;
    }

    if (!isMarked && !state.calledNumbers.includes(number)) {
        alert("That number has not been called yet.");
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
    if (!state.boardId) { alert("Join a room first."); return; }
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

    const isMarkedAt = (r, c) => marked.has(state.boardNumbers[r * 5 + c]);
    const idx = [0, 1, 2, 3, 4];
    const hasWin =
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

    state.roomCode      = roomState.code          || state.roomCode;
    state.roomStatus    = roomState.status        || state.roomStatus;
    state.calledNumbers = roomState.calledNumbers || [];
    state.winners       = roomState.winners       || [];

    localStorage.setItem("bingoRoomCode", state.roomCode);

    setRoomLabel();
    updateGameStatusDisplay();
    updatePlayerCountDisplay(roomState.playerCount || 0);
    updateCalledNumbersList();
    renderWinners();

    // Notify caller module of host status and player list
    if (window.BingoCaller && typeof window.BingoCaller.applyRoomState === "function") {
        window.BingoCaller.applyRoomState(roomState, state.playerId);
    }
}

// ─── Socket ───────────────────────────────────────────────

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

        state.socket.on("host-transferred", applyRoomState);
        state.socket.on("winner-added", applyRoomState);

        state.socket.on("error", (payload) => {
            if (payload && payload.error) alert(payload.error);
        });
    }

    state.socket.emit("join-room", { code });
}

// ─── Room actions ─────────────────────────────────────────

async function createRoom() {
    try {
        // Create room — sessionId is the host identity
        const room = await BingoApi.createRoom(state.sessionId);

        // Auto-join as player so host also gets a board
        const name = document.getElementById("playerNameInput")?.value.trim() || "";
        const data = await BingoApi.joinRoom(room.code, name, state.sessionId);

        state.roomCode      = data.room.code;
        state.playerId      = data.playerId;
        state.boardId       = data.boardId;
        state.playerName    = data.playerName;
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

async function joinRoom() {
    const code = document.getElementById("roomCodeInput")?.value.trim().toUpperCase() || "";
    const name = document.getElementById("playerNameInput")?.value.trim() || "";

    if (!code) { alert("Enter a room code."); return; }

    try {
        const data = await BingoApi.joinRoom(code, name, state.sessionId);

        state.roomCode      = data.room.code;
        state.playerId      = data.playerId;
        state.boardId       = data.boardId;
        state.playerName    = data.playerName;
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

async function restoreRoom() {
    if (!state.roomCode) return;

    try {
        const data = await BingoApi.joinRoom(state.roomCode, state.playerName, state.sessionId);

        state.playerId      = data.playerId;
        state.boardId       = data.boardId;
        state.playerName    = data.playerName;
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

    Object.assign(state, {
        roomCode: "", playerId: "", boardId: "", playerName: "",
        boardNumbers: [], markedNumbers: [], calledNumbers: [],
        winners: [], roomStatus: "waiting"
    });

    const table = document.getElementById("bingoTable");
    if (table) table.innerHTML = "";

    updateCalledNumbersList();
    renderWinners();
    updatePlayerNameDisplay();
    setRoomLabel();

    if (window.BingoCaller && typeof window.BingoCaller.setHostStatus === "function") {
        window.BingoCaller.setHostStatus(false, []);
    }

    showLobbyView();
}

// ─── Init ─────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("createRoom")?.addEventListener("click", createRoom);
    document.getElementById("joinRoom")?.addEventListener("click", joinRoom);
    document.getElementById("playerReset")?.addEventListener("click", resetPlayerBoard);
    document.getElementById("leaveRoom")?.addEventListener("click", leaveRoom);

    ["roomCodeInput", "playerNameInput"].forEach((id) => {
        document.getElementById(id)?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") joinRoom();
        });
    });

    restoreRoom();
});

window.BingoApp = { state, applyRoomState, connectSocket, updateCalledNumbersList };
