
const MASTER_KEY = 'bingo2025'; // Master key to unlock number input
document.querySelector('.button-6').addEventListener('click', generateBingoCard);

function highlightNumberOnCard(number) {
    const cells = document.querySelectorAll('#bingoTable td');
    cells.forEach(cell => {
        if (parseInt(cell.textContent) === number) {
            cell.classList.add('marked');
        }
    });
    checkBingo();
}

function generateBingoCard() {
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
            cell.onclick = () => {
                cell.classList.toggle("marked");
                checkBingo();
            };
        });
    }

    // Reset called numbers and list when generating new card
    calledNumbers = [];
    // updateCalledNumbersList();
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
    }
}

window.onload = generateBingoCard;
