document.addEventListener("DOMContentLoaded", () => {
    const rollBtn      = document.getElementById("rollNumberBtn");
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

    function setRollEnabled(enabled) {
        if (rollBtn) {
            rollBtn.disabled = !enabled;
            rollBtn.classList.toggle("rolling", !enabled);
        }
        const rollFab = document.getElementById("rollFab");
        if (rollFab) rollFab.disabled = !enabled;
    }

    function isMobile() {
        return window.innerWidth <= 768;
    }

    function setHostStatus(isHost, players = []) {
        const callerContainer = document.querySelector(".caller-container");
        const callerInner     = document.querySelector(".caller-inner");
        const fab             = document.getElementById("callerFab");
        const rollFab         = document.getElementById("rollFab");

        if (isMobile()) {
            if (callerContainer) callerContainer.style.display = "block";
            if (callerInner) callerInner.style.display = "flex";
            if (fab) fab.style.display = isHost ? "flex" : "none";
            if (rollFab) rollFab.style.display = isHost ? "flex" : "none";
            if (!isHost) closeSheet();
        } else {
            if (callerContainer) callerContainer.style.display = isHost ? "block" : "none";
            if (callerInner) callerInner.style.display = isHost ? "flex" : "none";
            if (fab) fab.style.display = "none";
            if (rollFab) rollFab.style.display = "none";
        }

        if (isHost) populateTransferSelect(players);
    }

    function openSheet() {
        const container = document.querySelector(".caller-container");
        const backdrop  = document.getElementById("callerBackdrop");
        if (container) container.classList.add("sheet-open");
        if (backdrop) backdrop.classList.add("open");
    }

    function closeSheet() {
        const container = document.querySelector(".caller-container");
        const backdrop  = document.getElementById("callerBackdrop");
        if (container) container.classList.remove("sheet-open");
        if (backdrop) backdrop.classList.remove("open");
    }

    document.getElementById("rollFab")?.addEventListener("click", rollNumber);
    document.getElementById("callerFab")?.addEventListener("click", openSheet);
    document.getElementById("callerSheetClose")?.addEventListener("click", closeSheet);
    document.getElementById("callerBackdrop")?.addEventListener("click", closeSheet);

    function populateTransferSelect(players) {
        if (!transferSel) return;

        const appState = window.BingoApp ? window.BingoApp.state : {};
        const others = players.filter((p) => p.id !== appState.playerId);

        transferSel.innerHTML = '<option value="">Hand off to...</option>' +
            others.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

        const section = document.getElementById("transferHostSection");
        if (section) section.style.display = others.length > 0 ? "flex" : "none";
    }

    function updateStartButton(roomState) {
        if (!startGameBtn || !roomState) return;

        const isActive = roomState.status === "active";
        startGameBtn.textContent = isActive ? "Stop Game" : "Start Game";
        startGameBtn.classList.toggle("stop-game", isActive);
    }

    function applyRoomState(roomState, currentPlayerId) {
        updateStartButton(roomState);
        setRollEnabled(roomState.status === "active" && (roomState.calledNumbers || []).length < 25);

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

    async function rollNumber() {
        const appState = window.BingoApp ? window.BingoApp.state : {};

        if (appState.roomStatus !== "active") {
            await showWarning("Start the game first.", "Game Waiting");
            return;
        }

        if ((appState.calledNumbers || []).length >= 25) {
            await showWarning("All numbers have already been called.", "Roll Complete");
            return;
        }

        setRollEnabled(false);

        try {
            await BingoApi.callNumber(appState.roomCode, appState.sessionId);
        } catch (error) {
            setRollEnabled(true);
            await showAlert(error.message, "Could Not Roll");
        }
    }

    async function resetGame() {
        const appState = window.BingoApp ? window.BingoApp.state : {};
        if (!await showConfirm("Reset the game? This clears all called numbers, winners, and everyone's board.", "Reset Game")) return;

        try {
            const roomState = await BingoApi.resetRoom(appState.roomCode, appState.sessionId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Could Not Reset");
        }
    }

    async function transferHost() {
        const appState = window.BingoApp ? window.BingoApp.state : {};
        const newHostId = transferSel ? transferSel.value : "";

        if (!newHostId) {
            await showWarning("Select a player to hand off to.", "Choose Player");
            return;
        }
        if (!await showConfirm("Transfer host to this player?", "Transfer Host")) return;

        try {
            const roomState = await BingoApi.transferHost(appState.roomCode, appState.sessionId, newHostId);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            await showAlert(error.message, "Could Not Transfer");
        }
    }

    if (rollBtn) rollBtn.addEventListener("click", rollNumber);
    if (resetBtn) resetBtn.addEventListener("click", resetGame);
    if (startGameBtn) startGameBtn.addEventListener("click", toggleGameStatus);
    if (transferBtn) transferBtn.addEventListener("click", transferHost);

    setHostStatus(false);
    setRollEnabled(false);

    window.BingoCaller = {
        applyRoomState,
        setHostStatus,
        setRollEnabled
    };
});
