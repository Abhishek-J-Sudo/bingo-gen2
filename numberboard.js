// Number board functionality
const board = document.getElementById('numberBoard');
let calledNumbers = [];
let isBoardUnlocked = false;

// Listen to called numbers from Firebase
onChildAdded(ref(database, 'bingo-game/calledNumbers'), (snapshot) => {
    const number = snapshot.val();
    
    // Mark number on number board
    const numberCell = document.querySelector(`#numberBoard td:contains('${number}')`);
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
    if (!cell || cell.classList.contains('disabled') || cell.textContent.trim() === '') return;

    const number = parseInt(cell.textContent);
    
    // Call the number
    callNumber(number, cell);
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
    highlightNumberOnCard(number);
}

function unlockInput() {
    const lockKeyInput = document.getElementById('lockKey');
    const numberBoard = document.getElementById('numberBoard');
    
    if (lockKeyInput.value === MASTER_KEY) {
        isBoardUnlocked = true;
        board.classList.add('unlocked');
        numberBoard.style.display = 'table';
        alert('Number board unlocked successfully!');
    } else {
        isBoardUnlocked = false;
        board.classList.remove('unlocked')
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
    #numberBoard td.disabled {
        background-color: #f0f0f0;
        color: #999;
        cursor: not-allowed;
    }
    #numberBoard:not(.unlocked) td {
        cursor: not-allowed;
        background-color: #f0f0f0;
    }
    #numberBoard.unlocked td {
        cursor: pointer;
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
function resetGame() {
    // Clear local called numbers
    calledNumbers = [];
    updateCalledNumbersList();

    // Reset number board
    document.querySelectorAll('#numberBoard td').forEach(cell => {
        cell.classList.remove('called', 'disabled');
    });

    // Clear Firebase called numbers
    remove(ref(database, 'bingo-game/calledNumbers'));
}

// Modify generateBingoCard to reset called numbers
function generateBingoCard() {
    // ... existing code ...

    // Reset called numbers and list when generating new card
    calledNumbers = [];
    updateCalledNumbersList();

    // Reset number board
    document.querySelectorAll('#numberBoard td').forEach(cell => {
        cell.classList.remove('called', 'disabled');
    });
    isBoardUnlocked = false;
    board.classList.remove('unlocked');

    remove(ref(database, 'bingo-game/calledNumbers'));
}

// Add this to ensure jQuery-like :contains selector works
jQuery.expr[':'].contains = function(a, i, m) {
    return jQuery(a).text().toUpperCase()
        .indexOf(m[3].toUpperCase()) >= 0;
};
