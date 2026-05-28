document.addEventListener("DOMContentLoaded", () => {
    const board        = document.getElementById("numberBoard");
    const resetBtn     = document.getElementById("reset");
    const startGameBtn = document.getElementById("startGame");
    const transferBtn  = document.getElementById("transferHostBtn");
    const transferSel  = document.getElementById("transferHostSelect");

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

    // ─── Visibility ──────────────────────────────────────────

    function setHostStatus(isHost, players = []) {
        const callerContainer = document.querySelector(".caller-container");
        const callerInner     = document.querySelector(".caller-inner");

        if (callerContainer) callerContainer.style.display = isHost ? "block" : "none";
        if (callerInner) callerInner.style.display = isHost ? "grid" : "none";

        if (isHost) {
            populateTransferSelect(players);
        }
    }

    function populateTransferSelect(players) {
        if (!transferSel) return;
        const appState   = window.BingoApp ? window.BingoApp.state : {};
        const others     = players.filter((p) => p.id !== appState.playerId);

        transferSel.innerHTML = '<option value="">Hand off to...</option>' +
            others.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

        const section = document.getElementById("transferHostSection");
        if (section) section.style.display = others.length > 0 ? "flex" : "none";
    }

    // ─── Number board ─────────────────────────────────────────

    function clearNumberBoard() {
        document.querySelectorAll("#numberBoard td").forEach((cell) => {
            cell.classList.remove("called", "disabled");
        });
    }

    function markCalledNumbers(numbers) {
        clearNumberBoard();
        numbers.forEach((number) => {
            const cell = Array.from(document.querySelectorAll("#numberBoard td"))
                .find((td) => td.textContent.trim() === number.toString());
            if (cell) cell.classList.add("called", "disabled");
        });
    }

    // ─── Start / Stop ─────────────────────────────────────────

    function updateStartButton(roomState) {
        if (!startGameBtn || !roomState) return;
        const isActive = roomState.status === "active";
        startGameBtn.textContent = isActive ? "Stop Game" : "Start Game";
        startGameBtn.classList.toggle("stop-game", isActive);
    }

    function applyRoomState(roomState, currentPlayerId) {
        markCalledNumbers(roomState.calledNumbers || []);
        updateStartButton(roomState);

        const isHost = !!(roomState.hostPlayerId && roomState.hostPlayerId === currentPlayerId);
        setHostStatus(isHost, roomState.players || []);
    }

    async function toggleGameStatus() {
        const appState = window.BingoApp ? window.BingoApp.state : {};

        try {
            const roomState = appState.roomStatus === "active"
                ? await BingoApi.stopRoom(appState.roomCode, appState.sessionId)
                : await BingoApi.startRoom(appState.roomCode, appState.sessionId);

            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Game Control");
        }
    }

    // ─── Call number ──────────────────────────────────────────

    async function callNumber(number) {
        const appState = window.BingoApp ? window.BingoApp.state : {};

        if (appState.roomStatus !== "active") {
            await showWarning("Start the game first.", "Game Waiting");
            return;
        }
        if ((appState.calledNumbers || []).includes(number)) return;

        try {
            const roomState = await BingoApi.callNumber(appState.roomCode, appState.sessionId, number);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Could Not Call");
        }
    }

    // ─── Reset game ───────────────────────────────────────────

    async function resetGame() {
        const appState = window.BingoApp ? window.BingoApp.state : {};
        if (!await showConfirm("Reset the game? This clears all called numbers and winners.", "Reset Game")) return;

        try {
            const roomState = await BingoApi.resetRoom(appState.roomCode, appState.sessionId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Could Not Reset");
        }
    }

    // ─── Transfer host ────────────────────────────────────────

    async function transferHost() {
        const appState     = window.BingoApp ? window.BingoApp.state : {};
        const newHostId    = transferSel ? transferSel.value : "";

        if (!newHostId) { await showWarning("Select a player to hand off to.", "Choose Player"); return; }
        if (!await showConfirm("Transfer host to this player?", "Transfer Host")) return;

        try {
            const roomState = await BingoApi.transferHost(appState.roomCode, appState.sessionId, newHostId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Could Not Transfer");
        }
    }

    // ─── Event listeners ──────────────────────────────────────

    if (board) {
        board.addEventListener("click", (e) => {
            const cell = e.target.closest("td");
            if (!cell || !cell.textContent.trim()) return;
            callNumber(Number(cell.textContent));
        });
    }

    if (resetBtn)    resetBtn.addEventListener("click", resetGame);
    if (startGameBtn) startGameBtn.addEventListener("click", toggleGameStatus);
    if (transferBtn)  transferBtn.addEventListener("click", transferHost);

    // ─── Init ─────────────────────────────────────────────────

    // Hide caller section by default — shown when host status is confirmed
    setHostStatus(false);

    // ─── Public API ───────────────────────────────────────────

    window.BingoCaller = {
        applyRoomState,
        markCalledNumbers,
        setHostStatus
    };
});
