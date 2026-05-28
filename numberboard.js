document.addEventListener("DOMContentLoaded", () => {
    const board       = document.getElementById("numberBoard");
    const resetBtn    = document.getElementById("reset");
    const startGameBtn = document.getElementById("startGame");
    const lockKeyInput = document.getElementById("lockKey");
    // Game-view unlock button (separate from lobby #unlock)
    const unlockGameBtn = document.getElementById("unlockGame");

    let isBoardUnlocked = false;

    function getState() {
        return window.BingoApp ? window.BingoApp.state : {};
    }

    // ─── Visibility ────────────────────────────────────────

    function setCallerControlsVisible(visible) {
        const unlockStrip = document.getElementById("unlockStrip");
        const callerInner = document.querySelector(".caller-inner");

        if (unlockStrip) unlockStrip.style.display = visible ? "none" : "flex";
        if (callerInner) callerInner.style.display  = visible ? "grid" : "none";
    }

    // ─── Unlock ────────────────────────────────────────────

    function unlockWithKey(key) {
        const appState = getState();
        appState.callerKey = key;
        sessionStorage.setItem("bingoCallerKey", key);
        isBoardUnlocked = true;
        setCallerControlsVisible(true);
    }

    async function unlockInput() {
        const callerKey = lockKeyInput ? lockKeyInput.value.trim() : "";
        const appState  = getState();

        if (!appState.roomCode) {
            alert("Join a room first.");
            return;
        }
        if (!callerKey) {
            alert("Enter your caller key.");
            return;
        }

        unlockWithKey(callerKey);
    }

    // ─── Number board ──────────────────────────────────────

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

    // ─── Start/Stop ────────────────────────────────────────

    function updateStartButton(roomState) {
        if (!startGameBtn || !roomState) return;
        const isActive = roomState.status === "active";
        startGameBtn.textContent = isActive ? "Stop Game" : "Start Game";
        startGameBtn.classList.toggle("stop-game", isActive);
    }

    function applyRoomState(roomState) {
        markCalledNumbers(roomState.calledNumbers || []);
        updateStartButton(roomState);
    }

    async function toggleGameStatus() {
        const appState = getState();

        if (!isBoardUnlocked) {
            alert("Unlock host controls first.");
            return;
        }

        try {
            const roomState = appState.roomStatus === "active"
                ? await BingoApi.stopRoom(appState.roomCode, appState.callerKey)
                : await BingoApi.startRoom(appState.roomCode, appState.callerKey);

            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    // ─── Call number ───────────────────────────────────────

    async function callNumber(number) {
        const appState = getState();

        if (!isBoardUnlocked) {
            alert("Unlock host controls first.");
            return;
        }
        if (appState.roomStatus !== "active") {
            alert("Start the game first.");
            return;
        }
        if ((appState.calledNumbers || []).includes(number)) return;

        try {
            const roomState = await BingoApi.callNumber(appState.roomCode, appState.callerKey, number);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    // ─── Reset game ────────────────────────────────────────

    async function resetGame() {
        const appState = getState();

        if (!isBoardUnlocked) {
            alert("Unlock host controls first.");
            return;
        }
        if (!confirm("Reset the game? This clears all called numbers and winners.")) return;

        try {
            const roomState = await BingoApi.resetRoom(appState.roomCode, appState.callerKey);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    // ─── Event listeners ───────────────────────────────────

    if (board) {
        board.addEventListener("click", (e) => {
            const cell = e.target.closest("td");
            if (!cell || !cell.textContent.trim()) return;
            callNumber(Number(cell.textContent));
        });
    }

    if (resetBtn)     resetBtn.addEventListener("click", resetGame);
    if (startGameBtn) startGameBtn.addEventListener("click", toggleGameStatus);
    if (unlockGameBtn) unlockGameBtn.addEventListener("click", unlockInput);

    if (lockKeyInput) {
        lockKeyInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") { e.preventDefault(); unlockInput(); }
        });
    }

    // ─── Init ──────────────────────────────────────────────

    setCallerControlsVisible(false);

    // ─── Public API ────────────────────────────────────────

    window.BingoCaller = {
        applyRoomState,
        markCalledNumbers,
        unlockWithKey,
        lock() {
            isBoardUnlocked = false;
            setCallerControlsVisible(false);
            if (lockKeyInput) lockKeyInput.value = "";
        }
    };
});
