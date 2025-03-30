const MASTER_KEY = '123'; // Master key to unlock number input
let boardId = null; // To track the current player's board ID
let isGameLocked = false; // Track if the game is locked
let playerCount = 0; // Track number of active players
let calledNumbers = []; // Define calledNumbers at the global scope

// Wait for Firebase to be ready before attaching event listeners
document.addEventListener("firebaseReady", function() {
    console.log("🔥 Firebase is ready for player board integration!");
    
    // Now that Firebase is ready, attach the event listener for the button
    document.querySelector('.button-6').addEventListener('click', generateBingoCard);
    
    // Make sure global references to Firebase functions are available
    const { ref, set, update, get, onValue, onDisconnect, serverTimestamp } = window;
    
    // Set up game status listener
    setupGameStatusListener();
    
    // Load saved board or create a new one
    loadSavedBoard();
    
    // Listen for called numbers
    setupCalledNumbersListener();
});

function handleCellClick(event) {
    const cell = event.target;
    // Only allow marking if game is locked (started)
    if (isGameLocked) {
        // Toggle the marked state
        cell.classList.toggle('marked');
        
        // Get all marked numbers
        const markedNumbers = Array.from(document.querySelectorAll('#bingoTable td.marked'))
            .map(cell => parseInt(cell.textContent));

        // Update Firebase with marked numbers
        if (boardId) {
            updateBoardInFirebase(boardId, markedNumbers);
        }

        checkBingo();
    } else {
        // Alert the player that the game hasn't started yet
        alert("Game hasn't started yet. Please wait for the caller to start the game.");
    }
}

function generateBingoCard() {
    // Check if the game is locked
    if (isGameLocked) {
        alert("Game is in progress. You cannot generate a new card now.");
        return;
    }
    
    const table = document.getElementById("bingoTable");
    table.innerHTML = "";
    
    const numbers = generateUniqueNumbers(1, 25, 25);
    
    const headerRow = table.insertRow();
    ['B', 'I', 'N', 'G', 'O'].forEach(letter => {
        const th = document.createElement("th");
        th.innerText = letter;
        headerRow.appendChild(th);
    });

    let numberIndex = 0;
    for (let i = 0; i < 5; i++) {
        const row = table.insertRow();
        ['B', 'I', 'N', 'G', 'O'].forEach(() => {
            const cell = row.insertCell();
            cell.innerText = numbers[numberIndex];
            numberIndex++;
            
            // Remove the inline click handler - we'll use the event listener approach
        });
    }

    // Reset called numbers and list when generating new card
    calledNumbers = [];
    
    // Store the board in Firebase
    saveBoardToFirebase(numbers);
    
    // Display player count
    updatePlayerCountDisplay();
    
    // Attach click event listeners to all cells
    attachCellClickListeners();
}

// Function to attach click event listeners to all cells
function attachCellClickListeners() {
    document.querySelectorAll('#bingoTable td').forEach(cell => {
        // Remove any existing event listeners first
        cell.removeEventListener('click', handleCellClick);
        // Add the event listener
        cell.addEventListener('click', handleCellClick);
    });
}

function generateUniqueNumbers(min, max, count) {
    const numbers = new Set();
    while (numbers.size < count) {
        numbers.add(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    return Array.from(numbers);
}

function checkBingo() {
    const table = document.getElementById("bingoTable");
    let bingo = false;
    
    // Check rows
    for (let i = 1; i < 6; i++) {
        if ([...table.rows[i].cells].every(cell => cell.classList.contains("marked"))) {
            bingo = true;
        }
    }
    
    // Check columns
    for (let j = 0; j < 5; j++) {
        if ([...Array(5).keys()].every(i => table.rows[i + 1].cells[j].classList.contains("marked"))) {
            bingo = true;
        }
    }
    
    // Check diagonals
    if ([...Array(5).keys()].every(i => table.rows[i + 1].cells[i].classList.contains("marked")) ||
        [...Array(5).keys()].every(i => table.rows[i + 1].cells[4 - i].classList.contains("marked"))) {
        bingo = true;
    }
    
    if (bingo) {
        if (typeof launchConfetti === 'function') {
            launchConfetti();
        }
        
        // Notify bingo in Firebase if game is locked
        if (isGameLocked && boardId) {
            push(ref(database, 'bingo-game/winners'), {
                boardId: boardId,
                timestamp: Date.now()
            });
        }
    }
}

// Firebase Integration Functions
function saveBoardToFirebase(numbers) {
    // Make sure database and Firebase functions are defined
    if (!window.database || !window.ref || !window.set) {
        console.error("Firebase is not ready yet. Cannot save board.");
        return;
    }
    
    // Remove old board if exists
    if (boardId) {
        remove(ref(database, `bingo-game/boards/${boardId}`));
    }
    
    // Generate unique ID based on timestamp and random number
    const uniqueId = `board_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    boardId = uniqueId;
    
    // Save the board to Firebase
    const boardRef = window.ref(database, `bingo-game/boards/${uniqueId}`);
    const boardData = {
        numbers: numbers,
        markedNumbers: [],
        createdAt: Date.now(),
        lastActive: Date.now()
    };
    
    set(boardRef, boardData)
        .then(() => {
            console.log("Board saved successfully with ID:", uniqueId);
            
            // Store board ID in local storage
            localStorage.setItem('bingoboardId', uniqueId);
            
            // Set up presence system
            const connectedRef = ref(database, '.info/connected');
            onValue(connectedRef, (snap) => {
                if (snap.val() === true) {
                    // When we disconnect, remove this device
                    onDisconnect(ref(database, `bingo-game/boards/${uniqueId}`)).remove();
                }
            });
        })
        .catch((error) => {
            console.error("Error saving board:", error);
        });
}

function updateBoardInFirebase(boardId, markedNumbers) {
    // Make sure Firebase is ready
    if (!window.database || !window.ref || !window.update) {
        console.error("Firebase is not ready yet. Cannot update board.");
        return;
    }
    
    console.log("Updating board in Firebase:", boardId, "with marked numbers:", markedNumbers);
    
    const boardRef = ref(database, `bingo-game/boards/${boardId}`);
    update(boardRef, {
        markedNumbers: markedNumbers,
        lastActive: serverTimestamp()
    }).catch((error) => {
        console.error("Error updating board:", error);
    });
}

function updatePlayerCountDisplay() {
    // Make sure Firebase is ready
    if (!window.database || !window.ref || !window.onValue) {
        console.error("Firebase is not ready yet. Cannot update player count.");
        return;
    }
    
    // Get a reference to the boards in the database
    const boardsRef = ref(database, 'bingo-game/boards');
    
    // Listen for changes to the boards
    onValue(boardsRef, (snapshot) => {
        if (snapshot.exists()) {
            const boards = snapshot.val();
            playerCount = Object.keys(boards).length;
            
            // Update the player count in the UI
            const playerCountElement = document.getElementById('playerCount');
            if (playerCountElement) {
                playerCountElement.textContent = `Players: ${playerCount}/10`;
            }
            
            // If more than 10 players, show warning
            if (playerCount > 10) {
                alert("Warning: More than 10 players are currently connected!");
            }
        } else {
            playerCount = 0;
            
            // Update the player count in the UI
            const playerCountElement = document.getElementById('playerCount');
            if (playerCountElement) {
                playerCountElement.textContent = "Players: 0/10";
            }
        }
    });
}

// Listen for game status changes
function setupGameStatusListener() {
    // Make sure Firebase is ready
    if (!window.database || !window.ref || !window.onValue) {
        console.error("Firebase is not ready yet. Cannot set up game status listener.");
        return;
    }
    
    const gameStatusRef = ref(database, 'bingo-game/status');
    onValue(gameStatusRef, (snapshot) => {
        if (snapshot.exists()) {
            const status = snapshot.val();
            isGameLocked = status.locked;
            
            // Update UI based on game status
            const resetButton = document.querySelector('.button-6');
            const playerReset = document.getElementById('playerReset');
            
            if (isGameLocked) {
                playerReset.classList.add('game-locked');
                resetButton.disabled = true;
                resetButton.style.opacity = '0.5';
                
                // Show game locked message
                const statusElement = document.getElementById('gameStatus');
                if (statusElement) {
                    statusElement.textContent = "Game is in progress - board locked";
                    statusElement.style.color = "red";
                }
            } else {
                playerReset.classList.remove('game-locked');
                resetButton.disabled = false;
                resetButton.style.opacity = '1';
                
                // Show game unlocked message
                const statusElement = document.getElementById('gameStatus');
                if (statusElement) {
                    statusElement.textContent = "Game is ready - you can modify your board";
                    statusElement.style.color = "green";
                }
            }
            
            // If we receive a reset notification, alert the user
            if (status.resetTimestamp && status.resetTimestamp > (window.lastResetTime || 0)) {
                window.lastResetTime = status.resetTimestamp;
                alert("The bingo caller has reset the game. Please refresh your board!");
                
                // Auto-generate a new board
                generateBingoCard();
            }
        }
    });
}

// Check if we have a saved board
function loadSavedBoard() {
    // Make sure Firebase is ready
    if (!window.database || !window.ref || !window.get) {
        console.error("Firebase is not ready yet. Cannot load saved board.");
        return;
    }
    
    const savedBoardId = localStorage.getItem('bingoboardId');
    if (savedBoardId) {
        const boardRef = ref(database, `bingo-game/boards/${savedBoardId}`);
        get(boardRef).then((snapshot) => {
            if (snapshot.exists()) {
                const boardData = snapshot.val();
                boardId = savedBoardId;
                
                // Recreate the board with the saved numbers
                recreateBoardFromSaved(boardData.numbers, boardData.markedNumbers || []);
                
                console.log("Loaded saved board:", savedBoardId);
            } else {
                // Saved board no longer exists, create a new one
                generateBingoCard();
            }
        }).catch((error) => {
            console.error("Error loading saved board:", error);
            generateBingoCard();
        });
    } else {
        // No saved board, create a new one
        generateBingoCard();
    }
}

function recreateBoardFromSaved(numbers, markedNumbers) {
    const table = document.getElementById("bingoTable");
    table.innerHTML = "";
    
    const headerRow = table.insertRow();
    ['B', 'I', 'N', 'G', 'O'].forEach(letter => {
        const th = document.createElement("th");
        th.innerText = letter;
        headerRow.appendChild(th);
    });

    let numberIndex = 0;
    for (let i = 0; i < 5; i++) {
        const row = table.insertRow();
        ['B', 'I', 'N', 'G', 'O'].forEach(() => {
            const cell = row.insertCell();
            const cellNumber = numbers[numberIndex];
            cell.innerText = cellNumber;
            
            // Mark the cell if it was marked before
            if (markedNumbers.includes(cellNumber)) {
                cell.classList.add("marked");
            }
            
            numberIndex++;
            // Remove the inline click handler here too
        });
    }
    
    // Attach click event listeners to all cells
    attachCellClickListeners();
}

function setupCalledNumbersListener() {
    // Make sure Firebase is ready
    if (!window.database || !window.ref || !window.onValue) {
        console.error("Firebase is not ready yet. Cannot set up called numbers listener.");
        return;
    }
    
    onValue(ref(database, 'bingo-game/calledNumbers'), (snapshot) => {
        if (snapshot.exists()) {
            const numbers = Object.values(snapshot.val());
            
            // Clear previously called numbers
            calledNumbers = [];
            document.getElementById('calledNumbersList').innerHTML = '';
            
            // Mark each called number
            numbers.forEach(number => {
                if (!calledNumbers.includes(number)) {
                    calledNumbers.push(number);
                    // highlightNumberOnCard(number);
                }
            });
            
            // Update the called numbers list
            updateCalledNumbersList();
        }
        else{            
            // Clear previously called numbers
            calledNumbers = [];
            document.getElementById('calledNumbersList').innerHTML = '';
        }
    });
}

function updateCalledNumbersList() {
    const list = document.getElementById('calledNumbersList');
    list.innerHTML = calledNumbers
        .map(num => `<div>${num}</div>`)
        .join('');
}

// Add event listener for PlayerReset button
document.addEventListener("DOMContentLoaded", function() {
    const playerResetButton = document.getElementById('playerReset');
    if (playerResetButton) {
        playerResetButton.addEventListener('click', generateBingoCard);
    }
});