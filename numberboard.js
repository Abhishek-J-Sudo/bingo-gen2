document.addEventListener("DOMContentLoaded", () => {
    const board        = document.getElementById("numberBoard");
    const resetBtn     = document.getElementById("reset");
    const startGameBtn = document.getElementById("startGame");
    const transferBtn  = document.getElementById("transferHostBtn");
    const transferSel  = document.getElementById("transferHostSelect");

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
            alert(error.message);
        }
    }

    // ─── Call number ──────────────────────────────────────────

    async function callNumber(number) {
        const appState = window.BingoApp ? window.BingoApp.state : {};

        if (appState.roomStatus !== "active") {
            alert("Start the game first.");
            return;
        }
        if ((appState.calledNumbers || []).includes(number)) return;

        try {
            const roomState = await BingoApi.callNumber(appState.roomCode, appState.sessionId, number);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    // ─── Reset game ───────────────────────────────────────────

    async function resetGame() {
        const appState = window.BingoApp ? window.BingoApp.state : {};
        if (!confirm("Reset the game? This clears all called numbers and winners.")) return;

        try {
            const roomState = await BingoApi.resetRoom(appState.roomCode, appState.sessionId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    // ─── Transfer host ────────────────────────────────────────

    async function transferHost() {
        const appState     = window.BingoApp ? window.BingoApp.state : {};
        const newHostId    = transferSel ? transferSel.value : "";

        if (!newHostId) { alert("Select a player to hand off to."); return; }
        if (!confirm(`Transfer host to this player?`)) return;

        try {
            const roomState = await BingoApi.transferHost(appState.roomCode, appState.sessionId, newHostId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
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
