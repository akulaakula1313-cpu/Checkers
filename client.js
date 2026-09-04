const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const menuDiv = document.getElementById('menu');

const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

let board = null;
let myColor = null;
let currentTurn = null;
let selectedPiece = null;
const cellSize = 50;

function startGame(mode) {
    menuDiv.style.display = 'none';
    canvas.style.display = 'block';
    ws.send(JSON.stringify({ type: 'START_GAME', mode }));
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'WAITING') {
        statusDiv.innerText = data.message;
    } else if (data.type === 'GAME_STARTED' || data.type === 'STATE_UPDATE') {
        board = data.board;
        currentTurn = data.turn;
        if (data.color) myColor = data.color;

        let roleText = myColor === 'w' ? 'Белые' : 'Черные';
        let turnText = currentTurn === myColor ? 'Ваш ход!' : 'Ход соперника...';
        statusDiv.innerText = `Вы играете за: ${roleText} | ${turnText}`;
        drawBoard();
    } else if (data.type === 'OPPONENT_DISCONNECTED') {
        statusDiv.innerText = 'Соперник отключился от игры.';
    }
};

canvas.addEventListener('click', (e) => {
    if (!board || currentTurn !== myColor) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Переворачиваем доску для черных, чтобы они сидели снизу
    let c = Math.floor(x / cellSize);
    let r = Math.floor(y / cellSize);
    if (myColor === 'b') {
        r = 7 - r;
        c = 7 - c;
    }

    const piece = board[r][c];

    if (piece && piece.toLowerCase() === myColor) {
        selectedPiece = { r, c };
        drawBoard();
    } else if (selectedPiece) {
        ws.send(JSON.stringify({
            type: 'MAKE_MOVE',
            from: selectedPiece,
            to: { r, c }
        }));
        selectedPiece = null;
    }
});

function drawBoard() {
    if (!board) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            // Отрисовка с учетом переворота доски для черного игрока
            let drawR = (myColor === 'b') ? (7 - r) : r;
            let drawC = (myColor === 'b') ? (7 - c) : c;

            // Клетки
            ctx.fillStyle = (r + c) % 2 === 0 ? '#f1f5f9' : '#334155';
            ctx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);

            // Подсветка выбранной шашки
            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
                ctx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
            }

            // Шашки
            const piece = board[r][c];
            if (piece) {
                let cx = drawC * cellSize + cellSize / 2;
                let cy = drawR * cellSize + cellSize / 2;
                let radius = cellSize * 0.38;

                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = piece.toLowerCase() === 'w' ? '#ffffff' : '#0f172a';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = piece.toLowerCase() === 'w' ? '#cbd5e1' : '#475569';
                ctx.stroke();

                // Если дамка — рисуем корону/точку внутри
                if (piece === 'W' || piece === 'B') {
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = piece === 'W' ? '#f59e0b' : '#38bdf8';
                    ctx.fill();
                }
            }
        }
    }
}
