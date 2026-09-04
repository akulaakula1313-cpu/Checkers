const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

let myColor = null;
let currentBoard = null;
let currentTurn = null;
let selectedCell = null;

const menu = document.getElementById('menu');
const gameContainer = document.getElementById('game-container');
const statusDiv = document.getElementById('status');
const roleInfo = document.getElementById('role-info');
const boardDiv = document.getElementById('board');

function startGame(mode) {
    ws.send(JSON.stringify({ type: 'START_GAME', mode }));
    menu.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    statusDiv.innerText = "Инициализация...";
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'WAITING') {
        statusDiv.innerText = data.message;
    } else if (data.type === 'GAME_STARTED') {
        myColor = data.color;
        currentBoard = data.board;
        currentTurn = data.turn;
        roleInfo.innerText = `Вы играете: ${myColor === 'w' ? 'Белыми' : 'Черными'}`;
        renderBoard();
        updateStatus();
    } else if (data.type === 'STATE_UPDATE') {
        currentBoard = data.board;
        currentTurn = data.turn;
        selectedCell = null;
        renderBoard();
        updateStatus();
    } else if (data.type === 'ERROR') {
        alert(data.message);
    } else if (data.type === 'OPPONENT_DISCONNECTED') {
        alert('Соперник отключился от игры!');
        location.reload();
    }
};

function updateStatus() {
    if (currentTurn === myColor) {
        statusDiv.innerText = "Ваш ход!";
        statusDiv.style.color = "#2ecc71";
    } else {
        statusDiv.innerText = "Ход соперника...";
        statusDiv.style.color = "#e74c3c";
    }
}

function renderBoard() {
    boardDiv.innerHTML = '';
    // Если играем черными, можно перевернуть доску, но для простоты рендерим стандартно
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const cell = document.createElement('div');
            cell.className = `cell ${(r + c) % 2 === 1 ? 'dark' : 'light'}`;
            
            const piece = currentBoard[r][c];
            if (piece) {
                const pieceDiv = document.createElement('div');
                const isWhite = piece.toLowerCase() === 'w';
                pieceDiv.className = `piece ${isWhite ? 'white-piece' : 'black-piece'}`;
                if (piece === piece.toUpperCase() && piece !== piece.toLowerCase()) {
                    pieceDiv.innerText = '★'; // Дамка
                }
                cell.appendChild(pieceDiv);
            }

            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
            }

            cell.addEventListener('click', () => handleCellClick(r, c));
            boardDiv.appendChild(cell);
        }
    }
}

function handleCellClick(r, c) {
    if (currentTurn !== myColor) return;

    const piece = currentBoard[r][c];
    if (piece && piece.toLowerCase() === myColor) {
        selectedCell = { r, c };
        renderBoard();
        return;
    }

    if (selectedCell && !piece) {
        // Отправляем ход на сервер
        ws.send(JSON.stringify({
            type: 'MAKE_MOVE',
            from: selectedCell,
            to: { r, c }
        }));
    }
}
