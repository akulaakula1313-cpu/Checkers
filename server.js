const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
// Раздаем статику из текущей корневой директории
app.use(express.static(__dirname));

let rooms = {};
let waitingPlayer = null;

function createBoard() {
    let board = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 === 1) {
                if (r < 3) board[r][c] = 'b';
                else if (r > 4) board[r][c] = 'w';
            }
        }
    }
    return board;
}

// Простейшая проверка легальности хода для теста графики
function isValidMove(board, r1, c1, r2, c2, color) {
    if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) return false;
    if (board[r2][c2] !== null) return false;
    
    let piece = board[r1][c1];
    if (!piece || piece.toLowerCase() !== color) return false;

    let dr = r2 - r1;
    let dc = c2 - c1;

    // Простой ход на 1 клетку по диагонали вперед
    let forwardDir = (color === 'w') ? -1 : 1;
    if (Math.abs(dc) === 1 && dr === forwardDir) return true;

    // Взятие (прыжок через клетку)
    if (Math.abs(dc) === 2 && Math.abs(dr) === 2) {
        let midR = (r1 + r2) / 2;
        let midC = (c1 + c2) / 2;
        let midPiece = board[midR][midC];
        if (midPiece && midPiece.toLowerCase() !== color) return true;
    }

    return false;
}

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let myColor = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'START_GAME') {
                if (data.mode === 'bot') {
                    currentRoomId = 'bot_' + Math.random().toString(36).substring(2, 9);
                    myColor = 'w';
                    rooms[currentRoomId] = {
                        mode: 'bot',
                        board: createBoard(),
                        turn: 'w',
                        players: { w: ws }
                    };
                    ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', board: rooms[currentRoomId].board, turn: 'w' }));
                } else if (data.mode === 'pvp') {
                    if (waitingPlayer && waitingPlayer.readyState === WebSocket.OPEN) {
                        currentRoomId = 'pvp_' + Math.random().toString(36).substring(2, 9);
                        myColor = 'b';
                        rooms[currentRoomId] = {
                            mode: 'pvp',
                            board: createBoard(),
                            turn: 'w',
                            players: { w: waitingPlayer, b: ws }
                        };
                        waitingPlayer.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'pvp', board: rooms[currentRoomId].board, turn: 'w' }));
                        ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'b', mode: 'pvp', board: rooms[currentRoomId].board, turn: 'w' }));
                        waitingPlayer = null;
                    } else {
                        waitingPlayer = ws;
                        ws.send(JSON.stringify({ type: 'WAITING', message: 'Поиск соперника в сети...' }));
                    }
                }
            }

            if (data.type === 'MAKE_MOVE' && currentRoomId) {
                const room = rooms[currentRoomId];
                if (!room || room.turn !== myColor) return;

                const { from, to } = data;
                if (isValidMove(room.board, from.r, from.c, to.r, to.c, myColor)) {
                    // Передвигаем шашку
                    room.board[to.r][to.c] = room.board[from.r][from.c];
                    room.board[from.r][from.c] = null;

                    // Если был прыжок через противника — удаляем побитую шашку
                    if (Math.abs(to.r - from.r) === 2) {
                        let midR = (from.r + to.r) / 2;
                        let midC = (from.c + to.c) / 2;
                        room.board[midR][midC] = null;
                    }

                    // Превращение в дамку
                    if (myColor === 'w' && to.r === 0) room.board[to.r][to.c] = 'W';
                    if (myColor === 'b' && to.r === 7) room.board[to.r][to.c] = 'B';

                    room.turn = room.turn === 'w' ? 'b' : 'w';

                    // Рассылаем обновление
                    broadcastState(room);

                    // Если игра с ботом и сейчас ход бота
                    if (room.mode === 'bot' && room.turn === 'b') {
                        setTimeout(() => makeBotMove(room), 600);
                    }
                }
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (waitingPlayer === ws) waitingPlayer = null;
        if (currentRoomId && rooms[currentRoomId]) {
            const room = rooms[currentRoomId];
            const oppColor = myColor === 'w' ? 'b' : 'w';
            if (room.players[oppColor] && room.players[oppColor].readyState === WebSocket.OPEN) {
                room.players[oppColor].send(JSON.stringify({ type: 'OPPONENT_DISCONNECTED' }));
            }
            delete rooms[currentRoomId];
        }
    });
});

function broadcastState(room) {
    const payload = JSON.stringify({ type: 'STATE_UPDATE', board: room.board, turn: room.turn });
    if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payload);
    if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payload);
}

function makeBotMove(room) {
    let moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (room.board[r][c] === 'b') {
                [[r+1, c-1], [r+1, c+1], [r+2, c-2], [r+2, c+2]].forEach(([nr, nc]) => {
                    if (isValidMove(room.board, r, c, nr, nc, 'b')) {
                        moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                    }
                });
            }
        }
    }

    if (moves.length > 0) {
        const m = moves[Math.floor(Math.random() * moves.length)];
        room.board[m.to.r][m.to.c] = room.board[m.from.r][m.from.c];
        room.board[m.from.r][m.from.c] = null;
        if (Math.abs(m.to.r - m.from.r) === 2) {
            room.board[(m.from.r + m.to.r)/2][(m.from.c + m.to.c)/2] = null;
        }
        if (m.to.r === 7) room.board[m.to.r][m.to.c] = 'B';
    }
    room.turn = 'w';
    broadcastState(room);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
