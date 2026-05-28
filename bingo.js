const state = {
    roomCode: localStorage.getItem("bingoRoomCode") || "",
    roomStatus: "waiting",
    callerKey: sessionStorage.getItem("bingoCallerKey") || "",
    playerId: localStorage.getItem("bingoPlayerId") || "",
    boardId: localStorage.getItem("bingoboardId") || "",
    sessionId: localStorage.getItem("bingoSessionId") || generateSessionId(),
    playerName: localStorage.getItem("bingoPlayerName") || "",
    boardNumbers: [],
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
        .filter((number) => Number.isInteger(number));
}

function setRoomLabel() {
    const roomCodeDisplay = document.getElementById("roomCodeDisplay");
    const roomStatusDisplay = document.getElementById("roomStatusDisplay");

    if (roomCodeDisplay) {
        roomCodeDisplay.textContent = state.roomCode ? `Room: ${state.roomCode}` : "No room joined";
    }

    if (roomStatusDisplay) {
        roomStatusDisplay.textContent = state.roomStatus === "active" ? "Game is in progress" : "Waiting room";
    }
}

function updatePlayerNameDisplay() {
    const playerName = document.getElementById("playerName");

    if (playerName) {
        playerName.textContent = state.playerName ? `Name: ${state.playerName}` : "Name: -";
    }
}

function updatePlayerCountDisplay(playerCount = 0) {
    const playerCountElement = document.getElementById("playerCount");

    if (playerCountElement) {
        playerCountElement.textContent = `Players: ${playerCount}/10`;
        playerCountElement.style.color = playerCount > 10 ? "red" : "#ddffe0";
    }
}

function updateGameStatusDisplay() {
    const statusElement = document.getElementById("gameStatus");
    const playerReset = document.getElementById("playerReset");
    const resetButton = document.getElementById("reset");
    const locked = state.roomStatus === "active";

    if (statusElement) {
        statusElement.textContent = locked
            ? "Game is in progress - board locked"
            : "Game is ready - you can reset your board";
        statusElement.style.color = locked ? "red" : "#94ee84";
    }

    if (playerReset) {
        playerReset.classList.toggle("game-locked", locked);
        playerReset.disabled = !state.boardId || locked;
        playerReset.style.opacity = playerReset.disabled ? "0.5" : "1";
    }

    if (resetButton) {
        resetButton.disabled = !state.callerKey;
        resetButton.style.opacity = resetButton.disabled ? "0.5" : "1";
    }
}

function renderBoard(numbers, markedNumbers = []) {
    const table = document.getElementById("bingoTable");

    if (!table) {
        return;
    }

    table.innerHTML = "";

    const headerRow = table.insertRow();
    ["B", "I", "N", "G", "O"].forEach((letter) => {
        const th = document.createElement("th");
        th.innerText = letter;
        headerRow.appendChild(th);
    });

    let numberIndex = 0;
    for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
        const row = table.insertRow();

        for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
            const cell = row.insertCell();
            const number = numbers[numberIndex];
            cell.innerText = number;

            if (markedNumbers.includes(number)) {
                cell.classList.add("marked");
            }

            numberIndex += 1;
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
        alert("Game hasn't started yet. Please wait for the caller to start the game.");
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
        alert("Game is in progress. You cannot reset your board now.");
        return;
    }

    try {
        const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
        state.boardNumbers = data.numbers;
        state.markedNumbers = data.markedNumbers || [];
        renderBoard(state.boardNumbers, state.markedNumbers);
    } catch (error) {
        alert(error.message);
    }
}

async function checkBingo() {
    const marked = new Set(state.markedNumbers);
    const called = new Set(state.calledNumbers);
    const allMarkedNumbersAreCalled = state.markedNumbers.every((number) => called.has(number));

    if (!allMarkedNumbersAreCalled && state.markedNumbers.length > 0) {
        alert("Number not called");
        return;
    }

    const isMarkedAt = (row, column) => marked.has(state.boardNumbers[(row * 5) + column]);
    const indexes = [0, 1, 2, 3, 4];
    const hasWinningLine =
        indexes.some((row) => indexes.every((column) => isMarkedAt(row, column))) ||
        indexes.some((column) => indexes.every((row) => isMarkedAt(row, column))) ||
        indexes.every((index) => isMarkedAt(index, index)) ||
        indexes.every((index) => isMarkedAt(index, 4 - index));

    if (!hasWinningLine) {
        return;
    }

    try {
        const roomState = await BingoApi.claimBingo(state.boardId, state.sessionId);
        applyRoomState(roomState);

        if (typeof launchConfetti === "function") {
            launchConfetti();
        }
    } catch (error) {
        alert(error.message);
    }
}

function updateCalledNumbersList() {
    const list = document.getElementById("calledNumbersList");

    if (!list) {
        return;
    }

    list.innerHTML = state.calledNumbers
        .map((number) => `<div>${number}</div>`)
        .join("");
}

function renderWinners() {
    const winnersListElement = document.getElementById("winnersList");

    if (!winnersListElement) {
        return;
    }

    winnersListElement.innerHTML = "";

    if (!state.winners.length) {
        winnersListElement.textContent = "No winners yet";
        return;
    }

    state.winners.forEach((winner) => {
        const winnerItem = document.createElement("div");
        const winnerTime = new Date(winner.wonAt).toLocaleTimeString();
        winnerItem.textContent = `Winner: ${winner.name} at ${winnerTime}`;
        winnersListElement.appendChild(winnerItem);
    });
}

function applyRoomState(roomState) {
    if (!roomState) {
        return;
    }

    state.roomCode = roomState.code || state.roomCode;
    state.roomStatus = roomState.status || state.roomStatus;
    state.calledNumbers = roomState.calledNumbers || [];
    state.winners = roomState.winners || [];

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

function connectSocket(code) {
    if (!code || !window.io) {
        return;
    }

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
            alert("The bingo caller has reset the game.");
        });
        state.socket.on("winner-added", applyRoomState);
        state.socket.on("error", (payload) => {
            if (payload && payload.error) {
                alert(payload.error);
            }
        });
    }

    state.socket.emit("join-room", { code });
}

async function createRoom() {
    const callerKeyInput = document.getElementById("lockKey");
    const callerKey = callerKeyInput ? callerKeyInput.value.trim() : "";

    if (callerKey.length < 4) {
        alert("Enter a caller key with at least 4 characters.");
        return;
    }

    try {
        const room = await BingoApi.createRoom(callerKey);
        state.callerKey = callerKey;
        sessionStorage.setItem("bingoCallerKey", callerKey);
        applyRoomState(room);
        connectSocket(room.code);
        alert(`Room created: ${room.code}`);
    } catch (error) {
        alert(error.message);
    }
}

async function joinRoom() {
    const roomCodeInput = document.getElementById("roomCodeInput");
    const playerNameInput = document.getElementById("playerNameInput");
    const code = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : "";
    const name = playerNameInput ? playerNameInput.value.trim() : "";

    if (!code) {
        alert("Enter a room code.");
        return;
    }

    try {
        const data = await BingoApi.joinRoom(code, name, state.sessionId);

        state.roomCode = data.room.code;
        state.playerId = data.playerId;
        state.boardId = data.boardId;
        state.playerName = data.playerName;
        state.boardNumbers = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        localStorage.setItem("bingoRoomCode", state.roomCode);
        localStorage.setItem("bingoPlayerId", state.playerId);
        localStorage.setItem("bingoboardId", state.boardId);
        localStorage.setItem("bingoPlayerName", state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
    } catch (error) {
        alert(error.message);
    }
}

async function restoreRoom() {
    if (!state.roomCode) {
        setRoomLabel();
        updateGameStatusDisplay();
        updatePlayerNameDisplay();
        return;
    }

    const roomCodeInput = document.getElementById("roomCodeInput");
    const playerNameInput = document.getElementById("playerNameInput");

    if (roomCodeInput) {
        roomCodeInput.value = state.roomCode;
    }

    if (playerNameInput) {
        playerNameInput.value = state.playerName;
    }

    try {
        const data = await BingoApi.joinRoom(state.roomCode, state.playerName, state.sessionId);

        state.playerId = data.playerId;
        state.boardId = data.boardId;
        state.playerName = data.playerName;
        state.boardNumbers = data.numbers;
        state.markedNumbers = data.markedNumbers || [];

        localStorage.setItem("bingoPlayerId", state.playerId);
        localStorage.setItem("bingoboardId", state.boardId);
        localStorage.setItem("bingoPlayerName", state.playerName);

        renderBoard(state.boardNumbers, state.markedNumbers);
        updatePlayerNameDisplay();
        applyRoomState(data.room);
        connectSocket(state.roomCode);
    } catch (error) {
        console.warn("Could not restore room:", error.message);
        setRoomLabel();
        updateGameStatusDisplay();
        updatePlayerNameDisplay();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const createRoomButton = document.getElementById("createRoom");
    const joinRoomButton = document.getElementById("joinRoom");
    const playerResetButton = document.getElementById("playerReset");

    if (createRoomButton) {
        createRoomButton.addEventListener("click", createRoom);
    }

    if (joinRoomButton) {
        joinRoomButton.addEventListener("click", joinRoom);
    }

    if (playerResetButton) {
        playerResetButton.addEventListener("click", resetPlayerBoard);
    }

    restoreRoom();
});

window.BingoApp = {
    state,
    applyRoomState,
    connectSocket,
    updateCalledNumbersList
};
