document.addEventListener("firebaseReady", function () {
    console.log("🔥 Firebase is ready. You can now use onChildAdded!");

    // Number board functionality
    const board = document.getElementById('numberBoard');
    const reset = document.getElementById('reset')
    let calledNumbers = [];
    let isBoardUnlocked = false;

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
            highlightNumberOnCard(number);
        }
    });

    // Modified event listener to check board status before allowing clicks
    board.addEventListener('click', function(event) {
        // Check if board is unlocked
        if (!isBoardUnlocked) {
            alert('Please unlock the board first by entering the correct key.');
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
        //highlightNumberOnCard(number);
    }

    // Add event listener for button click
    document.getElementById("unlock").addEventListener("click", window.unlockInput);

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
            numberBoard.style.display = 'table';
            alert('Number board unlocked successfully!');
        } else {
            isBoardUnlocked = false;
            board.classList.remove('unlocked');
            reset.classList.remove('unlocked');
            lockKeyInput.value = '';
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
            color: #fff;
            cursor: not-allowed;
        }
        #reset {
            color: #999;
            cursor: not-allowed;
        }
        #numberBoard:not(.unlocked) td {
            cursor: not-allowed;
            background-color: #fff;
            color: #fff;
        }
        #numberBoard.unlocked td {
            cursor: pointer;
            background-color: #f0f0f0;
        }
    `;
    document.head.appendChild(style);

    // Modify the existing updateCalledNumbersList function to work with the number board
    function updateCalledNumbersList() {
        const list = document.getElementById('calledNumbersList');
        list.innerHTML = calledNumbers
            .sort((a, b) => a - b)
            .map(num => `<div>${num},</div>`)
            .join('');
    }

    // Reset game functionality
    window.resetGame = function() {
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

        // Clear Firebase called numbers
        remove(ref(database, 'bingo-game/calledNumbers'));
        alert('Bingo caller has reset the game, please reload or reset bingo board')
    }

    // Modify generateBingoCard to reset called numbers
    // function generateBingoCard() {
    //     // Reset called numbers and list when generating new card
    //     calledNumbers = [];
    //     updateCalledNumbersList();

    //     // Reset number board
    //     document.querySelectorAll('#numberBoard td').forEach(cell => {
    //         cell.classList.remove('called', 'disabled');
    //     });
    //     isBoardUnlocked = false;
    //     board.classList.remove('unlocked');

    //     remove(ref(database, 'bingo-game/calledNumbers'));
    // }
});
