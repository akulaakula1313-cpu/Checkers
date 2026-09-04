const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
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

// Упрощенная валидация и поиск ходов для русских шашек
function getValidMoves(board, color) {
    let simpleMoves = [];
    let captureMoves = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            let piece = board[r][c];
            if (!piece || piece.toLowerCase() !== color) continue;

            const isKing = piece === piece.toUpperCase() && piece !== color; // 'W' или 'B'
            const opponentColor = color === 'w' ? ['b', 'B'] : ['w', 'W'];

            // Направления движения
            const dirs = color === 'w' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
            const allDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

            // Проверка взятий (бой) во все 4 стороны
            allDirs.forEach(([dr, dc]) => {
                let nr = r + dr, nc = c + dc;
                let nnr = r + dr * 2, nnc = c + dc * 2;
                if (nnr >= 0 && nnr < 8 && nnc >= 0 && nnc < 8) {
                    if (board[nr][nc] && opponentColor.includes(board[nr][nc]) && board[nnr][nnc] === null) {
                        captureMoves.push({ from: {r, c}, to: {r: nnr, c: nnc}, capture: {r: nr, c: nc} });
                    }
                }
            });

            // Простые ходы
            const moveDirs = isKing ? allDirs : dirs;
            moveDirs.forEach(([dr, dc]) => {
                let nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === null) {
                    simpleMoves.push({ from: {r, c}, to: {r: nr, c: nc} });
                }
            });
        }
    }

    // Обязательный бой
    if (captureMoves.length > 0) return captureMoves;
    return simpleMoves;
}

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let playerColor = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'START_GAME') {
                if (data.mode === 'bot') {
                    currentRoomId = 'bot_' + Math.random().toString(36).substring(2, 9);
                    playerColor = 'w';
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
                        playerColor = 'b';
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
                        ws.send(JSON.stringify({ type: 'WAITING', message: 'Ожидание соперника...' }));
                    }
                }
            }

            if (data.type === 'MAKE_MOVE' && currentRoomId) {
                const room = rooms[currentRoomId];
                if (!room || room.turn !== playerColor) return;

                const validMoves = getValidMoves(room.board, room.turn);
                const moveMatch = validMoves.find(m => m.from.r === data.from.r && m.from.c === data.from.c && m.to.r === data.to.r && m.to.c === data.to.c);

                if (!moveMatch) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Недопустимый ход!' }));
                    return;
                }

                // Выполняем ход
                let piece = room.board[moveMatch.from.r][moveMatch.from.c];
                room.board[moveMatch.to.r][moveMatch.to.c] = piece;
                room.board[moveMatch.from.r][moveMatch.from.c] = null;

                if (moveMatch.capture) {
                    room.board[moveMatch.capture.r][moveMatch.capture.c] = null;
                }

                // Превращение в дамку
                if (piece === 'w' && moveMatch.to.r === 0) room.board[moveMatch.to.r][moveMatch.to.c] = 'W';
                if (piece === 'b' && moveMatch.to.r === 7) room.board[moveMatch.to.r][moveMatch.to.c] = 'B';

                room.turn = room.turn === 'w' ? 'b' : 'w';

                // Рассылка
                broadcastState(room);

                // Ход бота
                if (room.mode === 'bot' && room.turn === 'b') {
                    setTimeout(() => {
                        const botMoves = getValidMoves(room.board, 'b');
                        if (botMoves.length > 0) {
                            const bm = botMoves[Math.floor(Math.random() * botMoves.length)];
                            let bPiece = room.board[bm.from.r][bm.from.c];
                            room.board[bm.to.r][bm.to.c] = bPiece;
                            room.board[bm.from.r][bm.from.c] = null;
                            if (bm.capture) room.board[bm.capture.r][bm.capture.c] = null;
                            if (bPiece === 'b' && bm.to.r === 7) room.board[bm.to.r][bm.to.c] = 'B';
                        }
                        room.turn = 'w';
                        broadcastState(room);
                    }, 800);
                }
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        if (waitingPlayer === ws) waitingPlayer = null;
        if (currentRoomId && rooms[currentRoomId]) {
            const room = rooms[currentRoomId];
            const oppColor = playerColor === 'w' ? 'b' : 'w';
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

app.get('/api/status', (req, res) => {
    res.json({
        activeRooms: Object.keys(rooms).length,
        waitingPlayer: waitingPlayer ? 1 : 0
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
