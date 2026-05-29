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
    socket: null,
    rollTimer: null,
    celebratedWinnerCount: 0
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

function showAlert(message, title) {
    return window.BingoDialog
        ? window.BingoDialog.alert(message, title)
        : Promise.resolve();
}

function showConfirm(message, title) {
    return window.BingoDialog
        ? window.BingoDialog.confirm(message, title)
        : Promise.resolve(false);
}

function showWarning(message, title) {
    return window.BingoDialog
        ? window.BingoDialog.warning(message, title)
        : showAlert(message, title);
}

// -----------------------------------------------------------------------------

function showLobbyView() {
    document.getElementById("lobby-view").classList.add("active");
    document.getElementById("game-view").classList.remove("active");
}

function showGameView() {
    document.getElementById("lobby-view").classList.remove("active");
    document.getElementById("game-view").classList.add("active");
}

// -----------------------------------------------------------------------------

function setRoomLabel() {
    const el = document.getElementById("roomCodeDisplay");
    if (el) el.textContent = state.roomCode || "-";
}

function updatePlayerNameDisplay() {
    const el = document.getElementById("playerName");
    if (el) el.textContent = state.playerName ? `Name: ${state.playerName}` : "Name: -";
}

function updatePlayerCountDisplay(playerCount = 0) {
    const el = document.getElementById("playerCount");
    if (el) el.textContent = `${playerCount}/10`;
}

function renderPlayers(players = [], hostPlayerId = null) {
    const strip = document.getElementById("playersStrip");
    if (!strip) return;

    strip.innerHTML = "";

    if (players.length > 0) {
        const label = document.createElement("span");
        label.className = "players-label";
        label.textContent = "Players:";
        strip.appendChild(label);
    }

    players.forEach((player, index) => {
        if (index > 0) {
            const separator = document.createElement("span");
            separator.className = "player-separator";
            separator.textContent = ",";
            strip.appendChild(separator);
        }

        const tag = document.createElement("span");
        tag.className = "player-tag";
        tag.classList.toggle("current", player.id === state.playerId);
        tag.classList.toggle("host", player.id === hostPlayerId);

        const name = document.createElement("span");
        name.textContent = player.name;
        tag.appendChild(name);

        const badges = [];
        if (player.id === hostPlayerId) badges.push("Host");
        if (player.id === state.playerId) badges.push("You");

        if (badges.length > 0) {
            const currentBadge = document.createElement("strong");
            currentBadge.textContent = `(${badges.join(", ")})`;
            tag.appendChild(currentBadge);
        }

        strip.appendChild(tag);
    });
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

// -----------------------------------------------------------------------------

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
        await showWarning("Game hasn't started yet. Wait for the host to start the game.", "Game Waiting");
        return;
    }

    if (!isMarked && !state.calledNumbers.includes(number)) {
        await showWarning("That number has not been called yet.", "Not Called");
        return;
    }

    cell.classList.toggle("marked");
    state.markedNumbers = getCellNumbers("#bingoTable td.marked");

    try {
        await BingoApi.markBoard(state.boardId, state.sessionId, state.markedNumbers);
        await checkBingo();
    } catch (error) {
        await showAlert(error.message, "Could Not Mark");
    }
}

async function resetPlayerBoard() {
    if (!state.boardId) { await showWarning("Join a room first.", "No Room"); return; }
    if (state.roomStatus === "active") {
        await showWarning("Game is in progress. You can't reset your board right now.", "Board Locked");
        return;
    }

    try {
        const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
        state.boardNumbers  = data.numbers;
        state.markedNumbers = data.markedNumbers || [];
        renderBoard(state.boardNumbers, state.markedNumbers);
    } catch (error) {
        await showAlert(error.message, "Could Not Reset");
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
        celebrateNewWinners(roomState.winners || []);
    } catch (error) {
        await showAlert(error.message, "Bingo Not Ready");
    }
}

function updateCalledNumbersList() {
    const list = document.getElementById("calledNumbersList");
    if (!list) return;
    list.innerHTML = state.calledNumbers.map((n) => `<div>${n}</div>`).join("");
}

function setRollDisplay(number, status, rolling = false) {
    const rollDisplay = document.getElementById("rollDisplay");
    const numberEl = document.getElementById("rollNumber");
    const statusEl = document.getElementById("rollStatus");

    if (rollDisplay) rollDisplay.classList.toggle("rolling", rolling);
    if (numberEl) numberEl.textContent = number || "--";
    if (statusEl) statusEl.textContent = status;
}

function updateRollDisplayFromState() {
    const latestNumber = state.calledNumbers[state.calledNumbers.length - 1];
    setRollDisplay(
        latestNumber || "--",
        latestNumber ? "Latest called number" : "Waiting for host"
    );
}

function playNumberRoll({ sequence = [], durationMs = 1800 } = {}) {
    if (!sequence.length) return;

    if (state.rollTimer) {
        clearInterval(state.rollTimer);
        state.rollTimer = null;
    }

    let index = 0;
    const intervalMs = Math.max(60, Math.floor(durationMs / sequence.length));

    setRollDisplay(sequence[0], "Rolling...", true);
    if (window.BingoCaller && typeof window.BingoCaller.setRollEnabled === "function") {
        window.BingoCaller.setRollEnabled(false);
    }

    state.rollTimer = setInterval(() => {
        index += 1;
        const value = sequence[Math.min(index, sequence.length - 1)];
        setRollDisplay(value, "Rolling...", true);

        if (index >= sequence.length - 1) {
            clearInterval(state.rollTimer);
            state.rollTimer = null;
        }
    }, intervalMs);
}

function renderWinners() {
    const banner = document.getElementById("winnerBanner");
    const nameEl = document.getElementById("winnerName");
    if (!banner || !nameEl) return;

    if (!state.winners.length) {
        banner.classList.remove("active");
        nameEl.textContent = "No winner yet";
        return;
    }

    banner.classList.add("active");
    nameEl.textContent = state.winners[0].name;
}

function celebrateNewWinners(winners = []) {
    if (winners.length <= state.celebratedWinnerCount) return;

    state.celebratedWinnerCount = winners.length;
    if (typeof launchConfetti === "function") launchConfetti();
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
    renderPlayers(roomState.players || [], roomState.hostPlayerId);
    updateCalledNumbersList();
    if (!state.rollTimer) updateRollDisplayFromState();
    renderWinners();

    // Notify caller module of host status and player list
    if (window.BingoCaller && typeof window.BingoCaller.applyRoomState === "function") {
        window.BingoCaller.applyRoomState(roomState, state.playerId);
    }
}

// -----------------------------------------------------------------------------

function connectSocket(code) {
    if (!code || !window.io) return;

    if (!state.socket) {
        state.socket = window.io();

        state.socket.on("room-state", applyRoomState);

        state.socket.on("number-called", (payload) => {
            if (state.rollTimer) {
                clearInterval(state.rollTimer);
                state.rollTimer = null;
            }

            state.calledNumbers = payload.calledNumbers || state.calledNumbers;
            setRollDisplay(payload.number || state.calledNumbers[state.calledNumbers.length - 1] || "--", "Called number");
            updateCalledNumbersList();
            if (window.BingoCaller && typeof window.BingoCaller.setRollEnabled === "function") {
                window.BingoCaller.setRollEnabled(state.roomStatus === "active" && state.calledNumbers.length < 25);
            }
        });

        state.socket.on("number-roll", playNumberRoll);

        state.socket.on("game-reset", async (roomState) => {
            state.markedNumbers = [];
            state.celebratedWinnerCount = 0;
            applyRoomState(roomState);
            updateRollDisplayFromState();
            if (roomState.hostPlayerId !== state.playerId) {
                showAlert("The host has reset the game. Your board has been refreshed.", "Game Reset");
            }

            if (state.boardId && state.sessionId) {
                try {
                    const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
                    state.boardNumbers  = data.numbers;
                    state.markedNumbers = data.markedNumbers || [];
                } catch (_) {}
            }
            renderBoard(state.boardNumbers, []);
        });

        state.socket.on("host-transferred", applyRoomState);
        state.socket.on("winner-added", (roomState) => {
            applyRoomState(roomState);
            celebrateNewWinners(roomState.winners || []);
        });

        state.socket.on("error", (payload) => {
            if (payload && payload.error) showAlert(payload.error, "Room Error");
        });
    }

    state.socket.emit("join-room", { code });
}

// -----------------------------------------------------------------------------

async function createRoom() {
    try {
        // Create room - sessionId is the host identity
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
        await showAlert(error.message, "Could Not Create Room");
    }
}

async function joinRoom() {
    const code = document.getElementById("roomCodeInput")?.value.trim().toUpperCase() || "";
    const name = document.getElementById("playerNameInput")?.value.trim() || "";

    if (!code) { await showAlert("Enter a room code.", "Room Code Needed"); return; }

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
        await showAlert(error.message, "Could Not Join Room");
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

async function leaveRoom() {
    if (!await showConfirm("Leave this room?", "Leave Room")) return;

    if (state.rollTimer) {
        clearInterval(state.rollTimer);
        state.rollTimer = null;
    }

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
        winners: [], roomStatus: "waiting", rollTimer: null, celebratedWinnerCount: 0
    });

    const table = document.getElementById("bingoTable");
    if (table) table.innerHTML = "";

    updateCalledNumbersList();
    updateRollDisplayFromState();
    renderPlayers();
    renderWinners();
    updatePlayerNameDisplay();
    setRoomLabel();

    if (window.BingoCaller && typeof window.BingoCaller.setHostStatus === "function") {
        window.BingoCaller.setHostStatus(false, []);
    }

    showLobbyView();
}

// -----------------------------------------------------------------------------

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

