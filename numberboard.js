document.addEventListener("DOMContentLoaded", () => {
    const board = document.getElementById("numberBoard");
    const reset = document.getElementById("reset");
    const startGameBtn = document.getElementById("startGame");
    const unlockButton = document.getElementById("unlock");
    const lockKeyInput = document.getElementById("lockKey");
    let isBoardUnlocked = false;

    function getState() {
        return window.BingoApp ? window.BingoApp.state : {};
    }

    function setCallerControlsVisible(visible) {
        const callerControls = document.getElementById("callerControls");
        const boardWrapper = document.querySelector(".board");

        if (callerControls) {
            callerControls.style.display = visible ? "flex" : "none";
        }

        if (boardWrapper) {
            boardWrapper.style.display = visible ? "block" : "none";
        }

        if (reset) {
            reset.style.display = visible ? "flex" : "none";
        }
    }

    function clearNumberBoard() {
        document.querySelectorAll("#numberBoard td").forEach((cell) => {
            cell.classList.remove("called", "disabled");
        });
    }

    function markCalledNumbers(numbers) {
        clearNumberBoard();

        numbers.forEach((number) => {
            const numberCell = Array.from(document.querySelectorAll("#numberBoard td"))
                .find((cell) => cell.textContent.trim() === number.toString());

            if (numberCell) {
                numberCell.classList.add("called");
                numberCell.classList.add("disabled");
            }
        });
    }

    function updateStartButton(roomState) {
        if (!startGameBtn || !roomState) {
            return;
        }

        const isGameStarted = roomState.status === "active";
        startGameBtn.textContent = isGameStarted ? "Stop Game" : "Start Game";
        startGameBtn.classList.toggle("game-active", isGameStarted);
    }

    function applyRoomState(roomState) {
        markCalledNumbers(roomState.calledNumbers || []);
        updateStartButton(roomState);
    }

    async function unlockInput() {
        const callerKey = lockKeyInput ? lockKeyInput.value.trim() : "";
        const state = getState();

        if (!state.roomCode) {
            alert("Create or join a room first.");
            return;
        }

        if (!callerKey) {
            alert("Enter the caller key.");
            return;
        }

        state.callerKey = callerKey;
        sessionStorage.setItem("bingoCallerKey", callerKey);
        isBoardUnlocked = true;

        if (board) {
            board.classList.add("unlocked");
        }

        if (reset) {
            reset.classList.add("unlocked");
        }

        if (startGameBtn) {
            startGameBtn.classList.add("unlocked");
        }

        setCallerControlsVisible(true);
        alert("Caller controls unlocked for this browser.");
    }

    async function toggleGameStatus() {
        const state = getState();

        if (!isBoardUnlocked) {
            alert("Please unlock the board first by entering the caller key.");
            return;
        }

        try {
            const roomState = state.roomStatus === "active"
                ? await BingoApi.stopRoom(state.roomCode, state.callerKey)
                : await BingoApi.startRoom(state.roomCode, state.callerKey);

            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    async function callNumber(number) {
        const state = getState();

        if (!isBoardUnlocked) {
            alert("Please unlock the board first by entering the caller key.");
            return;
        }

        if (state.roomStatus !== "active") {
            alert('Please start the game first by clicking the "Start Game" button.');
            return;
        }

        if ((state.calledNumbers || []).includes(number)) {
            alert("This number has already been called");
            return;
        }

        try {
            const roomState = await BingoApi.callNumber(state.roomCode, state.callerKey, number);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    async function resetGame() {
        const state = getState();

        if (!isBoardUnlocked) {
            alert("Please unlock the board first by entering the caller key.");
            return;
        }

        if (!confirm("Are you sure you want to reset the game? This will clear called numbers and winners.")) {
            return;
        }

        try {
            const roomState = await BingoApi.resetRoom(state.roomCode, state.callerKey);
            window.BingoApp.applyRoomState(roomState);
        } catch (error) {
            alert(error.message);
        }
    }

    if (board) {
        board.addEventListener("click", (event) => {
            const cell = event.target.closest("td");

            if (!cell || cell.textContent.trim() === "") {
                return;
            }

            callNumber(Number(cell.textContent));
        });
    }

    if (reset) {
        reset.addEventListener("click", resetGame);
    }

    if (startGameBtn) {
        startGameBtn.addEventListener("click", toggleGameStatus);
    }

    if (unlockButton) {
        unlockButton.addEventListener("click", unlockInput);
    }

    if (lockKeyInput) {
        lockKeyInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                unlockInput();
            }
        });
    }

    const style = document.createElement("style");
    style.textContent = `
        #numberBoard td.called {
            background-color: #4CAF50;
            color: white;
            font-weight: bold;
        }
        #numberBoard td.disabled {
            background-color: #fff;
            color: red;
            text-decoration: line-through;
            cursor: not-allowed;
        }
        #numberBoard:not(.unlocked) td {
            cursor: not-allowed;
            background-color: #7d9db1;
            color: #7d9db1;
        }
        #numberBoard.unlocked td {
            cursor: pointer;
            background-color: #eaf8f9;
        }
        #startGame {
            color: #999;
            cursor: not-allowed;
        }
        #startGame.unlocked {
            color: #000;
            cursor: pointer;
        }
        #startGame.game-active {
            background-color: #f44336;
            color: white;
        }
    `;
    document.head.appendChild(style);
    setCallerControlsVisible(false);

    window.BingoCaller = {
        applyRoomState,
        markCalledNumbers
    };
});
