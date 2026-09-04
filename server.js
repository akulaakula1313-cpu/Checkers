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

function generateRoomCode() {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return code;
}

function getAllCaptures(board, color) {
    let captures = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].toLowerCase() === color) {
                captures.push(...getPieceCaptures(board, r, c));
            }
        }
    }
    return captures;
}

function getPieceCaptures(board, r, c) {
    let piece = board[r][c];
    let color = piece.toLowerCase();
    let isKing = (piece === 'W' || piece === 'B');
    let captures = [];
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    if (!isKing) {
        dirs.forEach(([dr, dc]) => {
            let midR = r + dr, midC = c + dc;
            let endR = r + dr * 2, endC = c + dc * 2;
            if (endR >= 0 && endR < 8 && endC >= 0 && endC < 8) {
                let midPiece = board[midR][midC];
                if (midPiece && midPiece.toLowerCase() !== color && board[endR][endC] === null) {
                    captures.push({ from: {r, c}, to: {r: endR, c: endC}, jumped: {r: midR, c: midC} });
                }
            }
        });
    } else {
        dirs.forEach(([dr, dc]) => {
            let foundEnemy = null;
            let steps = 1;
            while (true) {
                let currR = r + dr * steps;
                let currC = c + dc * steps;
                if (currR < 0 || currR >= 8 || currC < 0 || currC >= 8) break;
                let p = board[currR][currC];
                if (p !== null) {
                    if (p.toLowerCase() === color) break;
                    if (foundEnemy) break;
                    foundEnemy = { r: currR, c: currC };
                } else if (foundEnemy) {
                    captures.push({ from: {r, c}, to: {r: currR, c: currC}, jumped: foundEnemy });
                }
                steps++;
            }
        });
    }
    return captures;
}

function getPieceQuietMoves(board, r, c) {
    let piece = board[r][c];
    let color = piece.toLowerCase();
    let isKing = (piece === 'W' || piece === 'B');
    let moves = [];
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    if (!isKing) {
        let forwardDir = (color === 'w') ? -1 : 1;
        [[-1, forwardDir], [1, forwardDir]].forEach(([dc, dr]) => {
            let nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === null) {
                moves.push({ from: {r, c}, to: {r: nr, c: nc} });
            }
        });
    } else {
        dirs.forEach(([dr, dc]) => {
            let steps = 1;
            while (true) {
                let nr = r + dr * steps;
                let nc = c + dc * steps;
                if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
                if (board[nr][nc] !== null) break;
                moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                steps++;
            }
        });
    }
    return moves;
}

function getValidMove(board, from, to, color) {
    let allCaps = getAllCaptures(board, color);
    if (allCaps.length > 0) {
        return allCaps.find(m => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c) || null;
    } else {
        let quietMoves = getPieceQuietMoves(board, from.r, from.c);
        return quietMoves.find(m => m.to.r === to.r && m.to.c === to.c) ? { from, to, jumped: null } : null;
    }
}

function checkGameOver(board, nextTurnColor) {
    let hasWhitePieces = false;
    let hasBlackPieces = false;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c]) {
                if (board[r][c].toLowerCase() === 'w') hasWhitePieces = true;
                if (board[r][c].toLowerCase() === 'b') hasBlackPieces = true;
            }
        }
    }

    if (!hasWhitePieces) return 'b'; 
    if (!hasBlackPieces) return 'w'; 

    let hasMoves = false;
    let captures = getAllCaptures(board, nextTurnColor);
    if (captures.length > 0) {
        hasMoves = true;
    } else {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] && board[r][c].toLowerCase() === nextTurnColor) {
                    if (getPieceQuietMoves(board, r, c).length > 0) {
                        hasMoves = true;
                        break;
                    }
                }
            }
            if (hasMoves) break;
        }
    }

    if (!hasMoves) return nextTurnColor === 'w' ? 'b' : 'w';
    return null;
}

wss.on('connection', (ws) => {
    let currentRoomCode = null;
    let myColor = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'START_GAME' && data.mode === 'bot') {
                currentRoomCode = 'BOT_' + Math.random().toString(36).substring(2, 7);
                myColor = 'w';
                rooms[currentRoomCode] = { mode: 'bot', board: createBoard(), turn: 'w', players: { w: ws }, rematchReady: {} };
                ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', board: rooms[currentRoomCode].board, turn: 'w' }));
            }

            if (data.type === 'CREATE_ROOM') {
                let code = generateRoomCode();
                while (rooms[code]) { code = generateRoomCode(); } 
                currentRoomCode = code;
                myColor = 'w';
                rooms[code] = { mode: 'pvp', board: createBoard(), turn: 'w', players: { w: ws, b: null }, rematchReady: {} };
                ws.send(JSON.stringify({ type: 'WAITING', message: 'Код стола создан', code: code }));
            }

            if (data.type === 'JOIN_ROOM') {
                let code = data.roomCode;
                if (rooms[code] && rooms[code].mode === 'pvp' && !rooms[code].players.b) {
                    currentRoomCode = code;
                    myColor = 'b';
                    rooms[code].players.b = ws;
                    rooms[code].players.w.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'pvp', board: rooms[code].board, turn: 'w' }));
                    rooms[code].players.b.send(JSON.stringify({ type: 'GAME_STARTED', color: 'b', mode: 'pvp', board: rooms[code].board, turn: 'w' }));
                } else {
                    ws.send(JSON.stringify({ type: 'WAITING', message: 'Стол не найден или уже занят!' }));
                }
            }

            if (data.type === 'MAKE_MOVE' && currentRoomCode) {
                const room = rooms[currentRoomCode];
                if (!room || room.turn !== myColor) return;

                const { from, to } = data;
                const validMove = getValidMove(room.board, from, to, myColor);

                if (validMove) {
                    let piece = room.board[from.r][from.c];
                    room.board[to.r][to.c] = piece;
                    room.board[from.r][from.c] = null;

                    if (validMove.jumped) room.board[validMove.jumped.r][validMove.jumped.c] = null;

                    if (myColor === 'w' && to.r === 0) room.board[to.r][to.c] = 'W';
                    if (myColor === 'b' && to.r === 7) room.board[to.r][to.c] = 'B';

                    let nextTurn = room.turn === 'w' ? 'b' : 'w';
                    let winner = checkGameOver(room.board, nextTurn);

                    if (winner) {
                        sendGameOver(room, winner);
                    } else {
                        room.turn = nextTurn;
                        broadcastState(room);

                        if (room.mode === 'bot' && room.turn === 'b') {
                            setTimeout(() => makeBotMove(room), 600);
                        }
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'STATE_UPDATE', board: room.board, turn: room.turn, mode: room.mode }));
                }
            }

            if (data.type === 'REQUEST_REMATCH' && currentRoomCode) {
                const room = rooms[currentRoomCode];
                if (!room) return;

                if (room.mode === 'bot') {
                    room.board = createBoard();
                    room.turn = 'w';
                    ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', board: room.board, turn: 'w' }));
                } else {
                    room.rematchReady[myColor] = true;
                    if (room.rematchReady.w && room.rematchReady.b) {
                        room.board = createBoard();
                        room.turn = 'w';
                        room.rematchReady = {};
                        room.players.w.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'pvp', board: room.board, turn: 'w' }));
                        room.players.b.send(JSON.stringify({ type: 'GAME_STARTED', color: 'b', mode: 'pvp', board: room.board, turn: 'w' }));
                    } else {
                        let oppColor = myColor === 'w' ? 'b' : 'w';
                        if (room.players[oppColor] && room.players[oppColor].readyState === WebSocket.OPEN) {
                            room.players[oppColor].send(JSON.stringify({ type: 'REMATCH_REQUESTED' }));
                        }
                    }
                }
            }
            if (data.type === 'CHAT_MSG' && currentRoomCode) {
                const room = rooms[currentRoomCode];
                if (!room || room.mode !== 'pvp') return;
                const payload = JSON.stringify({
                    type: 'CHAT_MSG',
                    sender: myColor === 'w' ? 'Белый' : 'Черный',
                    text: data.text
                });
                if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payload);
                if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payload);
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (currentRoomCode && rooms[currentRoomCode]) {
            const room = rooms[currentRoomCode];
            const oppColor = myColor === 'w' ? 'b' : 'w';
            if (room.players[oppColor] && room.players[oppColor].readyState === WebSocket.OPEN) {
                room.players[oppColor].send(JSON.stringify({ type: 'OPPONENT_DISCONNECTED' }));
            }
            delete rooms[currentRoomCode];
        }
    });
});

function sendGameOver(room, winner) {
    const payloadW = JSON.stringify({ type: 'GAME_OVER', winner, result: winner === 'w' ? 'WIN' : 'LOSE' });
    const payloadB = JSON.stringify({ type: 'GAME_OVER', winner, result: winner === 'b' ? 'WIN' : 'LOSE' });
    if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payloadW);
    if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payloadB);
}

function broadcastState(room) {
    const payload = JSON.stringify({ type: 'STATE_UPDATE', board: room.board, turn: room.turn, mode: room.mode });
    if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payload);
    if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payload);
}

function makeBotMove(room) {
    let color = 'b';
    let moves = getAllCaptures(room.board, color);
    if (moves.length === 0) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (room.board[r][c] && room.board[r][c].toLowerCase() === color) {
                    moves.push(...getPieceQuietMoves(room.board, r, c));
                }
            }
        }
    }
    if (moves.length > 0) {
        let m = moves[Math.floor(Math.random() * moves.length)];
        let piece = room.board[m.from.r][m.from.c];
        room.board[m.to.r][m.to.c] = piece;
        room.board[m.from.r][m.from.c] = null;
        if (m.jumped) room.board[m.jumped.r][m.jumped.c] = null;
        if (m.to.r === 7) room.board[m.to.r][m.to.c] = 'B';
    }
    let winner = checkGameOver(room.board, 'w');
    if (winner) {
        sendGameOver(room, winner);
    } else {
        room.turn = 'w';
        broadcastState(room);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер ШАШКИ от SANI GROUP запущен на порту ${PORT}`));
