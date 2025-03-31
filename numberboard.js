document.addEventListener("firebaseReady", function () {
    console.log("🔥 Firebase is ready. You can now use NumberBoard!");

    // Number board functionality
    const board = document.getElementById('numberBoard');
    const reset = document.getElementById('reset');
    const startGameBtn = document.getElementById('startGame');
    let calledNumbers = [];
    let isBoardUnlocked = false;
    let isGameStarted = false;

    // Import additional Firebase functions needed
    window.set = set;
    window.update = update;
    window.get = get;
    window.onValue = onValue;
    window.serverTimestamp = serverTimestamp;

    // Listen to called numbers from Firebase
    onChildAdded(ref(database, 'bingo-game/calledNumbers'), (snapshot) => {
        const number = snapshot.val();
        
        // Mark number on number board using native JavaScript
        const numberCell = Array.from(document.querySelectorAll('#numberBoard td'))
            .find(cell => cell.textContent.trim() === number.toString());
        
        if (numberCell) {
            numberCell.classList.add('called');
            numberCell.classList.add('disabled');
        }

        // Ensure number is in local calledNumbers array
        if (!calledNumbers.includes(number)) {
            calledNumbers.push(number);
            updateCalledNumbersList();
            //highlightNumberOnCard(number);
        }
    });

    // Modified event listener to check board status before allowing clicks
    board.addEventListener('click', function(event) {
        // Check if board is unlocked
        if (!isBoardUnlocked) {
            alert('Please unlock the board first by entering the correct key.');
            return;
        }

        // Check if game is started
        if (!isGameStarted) {
            alert('Please start the game first by clicking the "Start Game" button.');
            return;
        }

        const cell = event.target.closest('td');
        
        // Ignore clicks on already called numbers or outside of table cells
        if (!cell || cell.textContent.trim() === '') return;

        const number = parseInt(cell.textContent);
        
        // Call the number
        callNumber(number, cell);
    });

    // Modified event listener to check board status before allowing reset
    reset.addEventListener('click', function(event) {
        // Check if board is unlocked
        if (!isBoardUnlocked) {
            alert('Please unlock the board first by entering the correct key.');
            return;
        }
        resetGame();
    });

    // Add start game button event listener
    if (startGameBtn) {
        startGameBtn.addEventListener('click', function(event) {
            // Check if board is unlocked
            if (!isBoardUnlocked) {
                alert('Please unlock the board first by entering the correct key.');
                return;
            }
            
            // Toggle game state
            isGameStarted = !isGameStarted;
            
            // Update UI
            if (isGameStarted) {
                startGameBtn.textContent = "Stop Game";
                startGameBtn.classList.add('game-active');
                alert("Game started! Player boards are now locked.");
            } else {
                startGameBtn.textContent = "Start Game";
                startGameBtn.classList.remove('game-active');
                alert("Game stopped! Player boards are now unlocked.");
            }
            
            // Update game status in Firebase
            updateGameStatus(isGameStarted);
        });
    }

    function updateGameStatus(locked) {
        const statusRef = ref(database, 'bingo-game/status');
        update(statusRef, {
            locked: locked,
            lastUpdated: serverTimestamp()
        }).catch((error) => {
            console.error("Error updating game status:", error);
        });
    }

    function callNumber(number, cell) {
        // Prevent calling the same number twice
        if (calledNumbers.includes(number)) {
            alert('This number has already been called');
            return;
        }

        // Mark the number as called
        // Push to Firebase instead of local array
        push(ref(database, 'bingo-game/calledNumbers'), number)
        cell.classList.add('called');
        cell.classList.add('disabled');

        // Update the called numbers list and bingo card
        updateCalledNumbersList();
    }

    // Add event listener for button click
    document.getElementById("unlock").addEventListener("click", function(event){
        window.unlockInput();
    });

    // Add event listener for pressing Enter inside the input field
    document.getElementById("lockKey").addEventListener("keypress", function(event) {
        if (event.key === "Enter") { 
            event.preventDefault(); // Prevent form submission if inside a form
            window.unlockInput();  // Call the function
        }
    });

    window.unlockInput = function() {
        const lockKeyInput = document.getElementById('lockKey');
        const numberBoard = document.getElementById('numberBoard');
        
        if (lockKeyInput.value === MASTER_KEY) {
            isBoardUnlocked = true;
            board.classList.add('unlocked');
            reset.classList.add('unlocked');
            if (startGameBtn) startGameBtn.classList.add('unlocked');
            numberBoard.style.display = 'table';
            
            // Make the caller controls visible
            document.querySelector('.caller-container').style.display = 'flex';
            document.getElementById('callerControls').style.display = 'flex';
            document.querySelector('.board').style.display = 'block';
            document.getElementById('reset').style.display = 'flex';
            
            alert('Number board unlocked successfully!');
        } else {
            isBoardUnlocked = false;
            board.classList.remove('unlocked');
            reset.classList.remove('unlocked');
            if (startGameBtn) startGameBtn.classList.remove('unlocked');
            lockKeyInput.value = '';
            
            // Hide caller controls
            document.getElementById('callerControls').style.display = 'none';
            document.querySelector('.board').style.display = 'none'; 
            document.getElementById('reset').style.display = 'none';
            
            alert('Incorrect key. Access denied.');
        }
    }

    // Add a style to visually indicate the board's unlock status
    const style = document.createElement('style');
    style.textContent = `
        #numberBoard td.called {
            background-color: #4CAF50;
            color: white;
            font-weight: bold;
        }
        #numberBoard td.disabled{
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
        // #callerControls {
        //     display: none;
        //     margin-top: 20px;
        //     padding: 10px;
        //     border: 1px solid #ccc;
        //     background-color: #f9f9f9;
        // }
        .player-count {
            font-weight: bold;
            margin-bottom: 10px;
        }
        .winners-list {
            max-height: 150px;
            overflow-y: auto;
            margin-top: 10px;
        }
    `;
    document.head.appendChild(style);

    // Function to track player count
    function setupPlayerCountListener() {
        const boardsRef = ref(database, 'bingo-game/boards');
        onValue(boardsRef, (snapshot) => {
            let count = 0;
            if (snapshot.exists()) {
                count = Object.keys(snapshot.val()).length;
            }
            
            // Update player count in UI
            const playerCountElement = document.getElementById('playerCount');
            if (playerCountElement) {
                playerCountElement.textContent = `Active Players: ${count}/10`;
                
                // Highlight if over capacity
                if (count > 10) {
                    playerCountElement.style.color = 'red';
                } else {
                    playerCountElement.style.color = '#ddffe0';
                }
            }
        });
    }

    // Function to track winners
    function setupWinnersListener() {
        const winnersRef = ref(database, 'bingo-game/winners');
        onValue(winnersRef, (snapshot) => {
            const winnersListElement = document.getElementById('winnersList');
            if (winnersListElement) {
                winnersListElement.innerHTML = '';
                
                if (snapshot.exists()) {
                    const winners = snapshot.val();
                    Object.entries(winners).forEach(([key, winner]) => {
                        const winnerItem = document.createElement('div');
                        const winnerTime = new Date(winner.timestamp).toLocaleTimeString();
                        winnerItem.textContent = `Winner: ${winner.playerName || winner.boardId.substring(0, 10)}... at ${winnerTime}`;
                        winnersListElement.appendChild(winnerItem);
                    });
                } else {
                    winnersListElement.textContent = 'No winners yet';
                }
            }
        });
    }

    // Modify the existing updateCalledNumbersList function to work with the number board
    function updateCalledNumbersList() {
        const list = document.getElementById('calledNumbersList');
        list.innerHTML = calledNumbers
            .map(num => `<div>${num}</div>`)
            .join('');
    }

    // Reset game functionality
    window.resetGame = function() {
        // Confirm reset
        if (!confirm("Are you sure you want to reset the game? This will reset all player boards.")) {
            return;
        }
        
        // Clear local called numbers
        calledNumbers = [];
        updateCalledNumbersList();

        // Reset number board
        document.querySelectorAll('#numberBoard td').forEach(cell => {
            cell.classList.remove('called', 'disabled');
        });

        // Reset Bingo board
        document.querySelectorAll('#bingoTable td').forEach(cell => {
            cell.classList.remove('marked');
        });

        // Update game status with reset timestamp
        const statusRef = ref(database, 'bingo-game/status');
        update(statusRef, {
            locked: false,
            resetTimestamp: Date.now(),
            lastUpdated: serverTimestamp()
        });
        
        // Reset game started state
        isGameStarted = false;
        if (startGameBtn) {
            startGameBtn.textContent = "Start Game";
            startGameBtn.classList.remove('game-active');
        }

        // Clear Firebase called numbers
        remove(ref(database, 'bingo-game/calledNumbers'));
        
        // Clear winners
        remove(ref(database, 'bingo-game/winners'));

        //Clear Boards
        remove(ref(database, 'bingo-game/boards'))
        
        alert('Game has been reset. All players have been notified.');
    }

    // Set up listeners
    setupPlayerCountListener();
    setupWinnersListener();
    
    // Check if game is already in progress
    const gameStatusRef = ref(database, 'bingo-game/status');
    get(gameStatusRef).then((snapshot) => {
        if (snapshot.exists()) {
            const status = snapshot.val();
            isGameStarted = status.locked || false;
            
            // Update UI to match current game state
            if (startGameBtn) {
                if (isGameStarted) {
                    startGameBtn.textContent = "Stop Game";
                    startGameBtn.classList.add('game-active');
                } else {
                    startGameBtn.textContent = "Start Game";
                    startGameBtn.classList.remove('game-active');
                }
            }
        }
    });
});
