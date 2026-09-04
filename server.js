const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => { res.sendFile(path.resolve(__dirname, 'index.html')); });

const rooms = {};
const RANKS = [
    { rank: '6', value: 6 }, { rank: '7', value: 7 }, { rank: '8', value: 8 },
    { rank: '9', value: 9 }, { rank: '10', value: 10 }, { rank: 'J', value: 11 },
    { rank: 'Q', value: 12 }, { rank: 'K', value: 13 }, { rank: 'A', value: 14 }
];
const SUITS = ['♠', '♥', '♦', '♣'];

io.on('connection', (socket) => {
    socket.on('create_room', (data) => {
        let maxPlayers = 2;
        let playerName = 'Игрок 1';
        
        if (typeof data === 'object' && data !== null) {
            maxPlayers = parseInt(data.maxPlayers) || 2;
            if (data.playerName) playerName = data.playerName.trim().substring(0, 12);
        } else {
            maxPlayers = parseInt(data) || 2;
        }

        maxPlayers = Math.max(2, Math.min(4, maxPlayers));
        let code = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (rooms[code]) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); }
        
        let room = {
            id: code, maxPlayers: maxPlayers,
            players: [{ id: socket.id, isBot: false, name: playerName || 'Игрок 1' }],
            state: null, rematchVotes: new Set(), rematchTimer: null, botTimer: null, botLoopTimeout: null
        };
        rooms[code] = room;
        socket.join(code);
        socket.emit('room_created', { code, maxPlayers });
        updateLobby(room);

        room.botTimer = setTimeout(() => {
            if (room && !room.state && room.players.length < room.maxPlayers) {
                fillRoomWithBots(room); initGameState(room); broadcastState(room); scheduleBotTurn(room);
            }
        }, 60000);
    });

    socket.on('play_with_bots', (data) => {
        let maxPlayers = 2;
        let playerName = 'Вы';

        if (typeof data === 'object' && data !== null) {
            maxPlayers = parseInt(data.maxPlayers) || 2;
            if (data.playerName) playerName = data.playerName.trim().substring(0, 12);
        } else {
            maxPlayers = parseInt(data) || 2;
        }

        maxPlayers = Math.max(2, Math.min(4, maxPlayers));
        let code = 'BOTS_' + Math.random().toString(36).substring(2, 6).toUpperCase();
        
        let room = {
            id: code, maxPlayers: maxPlayers,
            players: [{ id: socket.id, isBot: false, name: playerName || 'Вы' }],
            state: null, rematchVotes: new Set(), rematchTimer: null, botTimer: null, botLoopTimeout: null
        };
        rooms[code] = room;
        socket.join(code);
        fillRoomWithBots(room); initGameState(room); broadcastState(room); scheduleBotTurn(room);
    });

    socket.on('join_room', (data) => {
        let code = '';
        let playerName = '';

        if (typeof data === 'object' && data !== null) {
            code = data.roomCode;
            playerName = data.playerName;
        } else {
            code = data;
        }

        if (!code || typeof code !== 'string') return;
        code = code.trim().toUpperCase();
        let room = rooms[code];
        if (!room) { socket.emit('error_msg', 'Комната не найдена'); return; }
        if (room.state) { socket.emit('error_msg', 'Игра уже началась'); return; }
        if (room.players.length >= room.maxPlayers) { socket.emit('error_msg', 'Комната заполнена'); return; }

        let pName = playerName ? playerName.trim().substring(0, 12) : `Игрок ${room.players.length + 1}`;
        room.players.push({ id: socket.id, isBot: false, name: pName });
        socket.join(code);
        updateLobby(room);

        if (room.players.length === room.maxPlayers) {
            if (room.botTimer) clearTimeout(room.botTimer);
            initGameState(room); broadcastState(room); scheduleBotTurn(room);
        }
    });

    socket.on('send_message', ({ roomCode, message }) => {
        if (!roomCode || !message) return;
        let room = rooms[roomCode];
        if (!room) return;
        let player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        let cleanMsg = message.trim().substring(0, 150);
        if (cleanMsg === '') return;
        io.to(room.id).emit('chat_message', { senderId: socket.id, senderName: player.name, message: cleanMsg });
    });

    socket.on('vote_rematch', (roomCode) => {
        let room = rooms[roomCode];
        if (!room || !room.state || !room.state.isGameOver) return;
        room.rematchVotes.add(socket.id);
        let humanPlayers = room.players.filter(p => !p.isBot);
        io.to(room.id).emit('rematch_voted', { votesCount: room.rematchVotes.size, totalNeeded: humanPlayers.length });
        if (room.rematchVotes.size >= humanPlayers.length) {
            if (room.rematchTimer) clearInterval(room.rematchTimer);
            startRematch(room);
        }
    });

    socket.on('player_action', ({ roomCode, action, cardIdx }) => {
        let room = rooms[roomCode];
        if (!room) { socket.emit('error_msg', 'Комната не найдена'); return; }
        if (!room.state || room.state.isGameOver) return;
        let humanP = room.players.find(p => p.id === socket.id);
        if (!humanP) return;
        
        if (room.botLoopTimeout) clearTimeout(room.botLoopTimeout);

        let success = false;
        if (action === 'play_card') success = handlePlayCard(room, socket.id, cardIdx);
        else if (action === 'take') success = handleTakeIntent(room, socket.id);
        else if (action === 'done' || action === 'pass') success = handlePass(room, socket.id);
        
        if (success) scheduleBotTurn(room);
    });

    socket.on('leave_room', (roomCode) => {
        handlePlayerLeave(socket.id, roomCode);
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            let room = rooms[code];
            let idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                handlePlayerLeave(socket.id, code);
                break;
            }
        }
    });
});

function handlePlayerLeave(socketId, roomCode) {
    let room = rooms[roomCode];
    if (!room) return;
    let idx = room.players.findIndex(p => p.id === socketId);
    if (idx !== -1) {
        if (room.botTimer) clearTimeout(room.botTimer);
        if (room.rematchTimer) clearInterval(room.rematchTimer);
        if (room.botLoopTimeout) clearTimeout(room.botLoopTimeout);
        socket.leave(roomCode);
        room.players.splice(idx, 1);
        let humansLeft = room.players.filter(p => !p.isBot).length;
        if (humansLeft === 0) {
            delete rooms[roomCode];
        } else if (room.state && !room.state.isGameOver) {
            io.to(roomCode).emit('opponent_disconnected');
            delete rooms[roomCode];
        } else {
            updateLobby(room);
        }
    }
}

function fillRoomWithBots(room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    let botNames = ['Бот Валера', 'Бот Степан', 'Бот Гриша'];
    let nameIdx = 0;
    while (room.players.length < room.maxPlayers) {
        room.players.push({ id: 'BOT_' + Math.random().toString(36).substring(2, 8), isBot: true, name: botNames[nameIdx++ % botNames.length] });
    }
}

function updateLobby(room) {
    let humanCount = room.players.filter(p => !p.isBot).length;
    io.to(room.id).emit('lobby_update', { code: room.id, current: room.players.length, max: room.maxPlayers, humanCount });
}

function initGameState(room) {
    let deck = []; let id = 0;
    for (let s of SUITS) { for (let r of RANKS) { deck.push({ id: id++, suit: s, rank: r.rank, value: r.value }); } }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    let trumpCard = deck[deck.length - 1];
    let hands = {};
    room.players.forEach(p => { 
        hands[p.id] = deck.splice(0, 6); 
        sortHand(hands[p.id], trumpCard.suit); 
    });
    
    let firstAttackerIdx = 0; let minTrumpValue = 999;
    room.players.forEach((p, idx) => {
        let trCards = hands[p.id].filter(c => c.suit === trumpCard.suit);
        trCards.forEach(c => { if (c.value < minTrumpValue) { minTrumpValue = c.value; firstAttackerIdx = idx; } });
    });
    
    let defenderIdx = (firstAttackerIdx + 1) % room.players.length;
    room.state = {
        roomCode: room.id, deck, trumpCard, trumpSuit: trumpCard.suit, hands, table: [],
        attackerIdx: firstAttackerIdx, defenderIdx: defenderIdx, currentThrowerIdx: firstAttackerIdx,
        passedThrowers: {},
        defenderTakesIntent: false,
        playersInfo: room.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })),
        isGameOver: false, winner: null
    };
    room.rematchVotes.clear();
}

function resetThrowingRoundState(state) {
    state.passedThrowers = {};
    state.defenderTakesIntent = false;
    state.currentThrowerIdx = state.attackerIdx;
}

function sortHand(hand, trumpSuit) {
    hand.sort((a, b) => {
        let aTr = a.suit === trumpSuit ? 1 : 0; let bTr = b.suit === trumpSuit ? 1 : 0;
        if (aTr !== bTr) return aTr - bTr;
        return a.value - b.value;
    });
}

function canBeat(att, def, trumpSuit) {
    let aTr = att.suit === trumpSuit, dTr = def.suit === trumpSuit;
    if (aTr && !dTr) return false;
    if (aTr && dTr) return def.value > att.value;
    if (!dTr) return att.suit === def.suit && def.value > att.value;
    return true;
}

function getTableRanks(table) {
    let ranks = new Set();
    for (let p of table) { 
        ranks.add(p.attack.rank);
        if (p.defense) ranks.add(p.defense.rank);
    }
    return ranks;
}

function countDefendedPairs(table) { return table.filter(p => p.defense !== null).length; }
function hasAnyCards(state, pId) { return (state.hands[pId] || []).length > 0; }

function getNextActiveThrowerIdx(state, startIdx) {
    let count = state.playersInfo.length;
    let idx = startIdx;
    for (let i = 0; i < count; i++) {
        idx = (idx + 1) % count;
        if (idx !== state.defenderIdx && hasAnyCards(state, state.playersInfo[idx].id)) {
            return idx;
        }
    }
    return -1;
}

function checkAllPassedOrFinished(state) {
    let count = state.playersInfo.length;
    for (let i = 0; i < count; i++) {
        let p = state.playersInfo[i];
        if (i === state.defenderIdx) continue;
        if (!hasAnyCards(state, p.id)) continue;
        let hand = state.hands[p.id] || [];
        let tRanks = getTableRanks(state.table);
        let hasMatching = hand.some(c => tRanks.has(c.rank));
        if (hasMatching && !state.passedThrowers[p.id]) {
            return false;
        }
        if (!p.isBot && !state.passedThrowers[p.id]) {
            return false;
        }
    }
    return true;
}

function handlePlayCard(room, pId, cardIdx) {
    let state = room.state;
    let hand = state.hands[pId];
    if (!hand || cardIdx < 0 || cardIdx >= hand.length) {
        io.to(pId).emit('error_msg', 'Неверная карта');
        return false;
    }
    let card = hand[cardIdx];
    let attackerId = state.playersInfo[state.attackerIdx].id;
    let defenderId = state.playersInfo[state.defenderIdx].id;
    let pIdx = state.playersInfo.findIndex(p => p.id === pId);

    if (pId !== defenderId) {
        if (state.table.length === 0) {
            if (pId !== attackerId) {
                io.to(pId).emit('error_msg', 'Сейчас ход первого атакующего!');
                return false;
            }
        } else {
            let tRanks = getTableRanks(state.table);
            if (!tRanks.has(card.rank)) {
                io.to(pId).emit('error_msg', 'Такой карты нет на столе');
                return false;
            }
            let defHandLen = state.hands[defenderId].length;
            if (state.table.length >= Math.min(6, defHandLen + countDefendedPairs(state.table))) {
                io.to(pId).emit('error_msg', 'У защищающегося нет столько карт');
                return false;
            }
        }
        hand.splice(cardIdx, 1);
        state.table.push({ attack: card, defense: null, attackerId: pId });
        state.passedThrowers = {};
        state.passedThrowers[pId] = true;
        state.currentThrowerIdx = getNextActiveThrowerIdx(state, pIdx);
        if (state.currentThrowerIdx === -1) state.currentThrowerIdx = pIdx;
        checkGameOver(room);
        broadcastState(room);
        return true;
    } else {
        if (state.table.length === 0) {
            io.to(pId).emit('error_msg', 'Стол пуст');
            return false;
        }
        let uncoveredIdx = state.table.findIndex(p => p.defense === null);
        if (uncoveredIdx === -1) {
            io.to(pId).emit('error_msg', 'Все отбито');
            return false;
        }
        let attCard = state.table[uncoveredIdx].attack;
        if (!canBeat(attCard, card, state.trumpSuit)) {
            io.to(pId).emit('error_msg', 'Не бьет карту');
            return false;
        }
        hand.splice(cardIdx, 1);
        state.table[uncoveredIdx].defense = card;
        state.passedThrowers = {};
        state.currentThrowerIdx = state.attackerIdx;
        if (!hasAnyCards(state, state.playersInfo[state.attackerIdx].id)) {
            state.currentThrowerIdx = getNextActiveThrowerIdx(state, state.attackerIdx);
        }
        checkGameOver(room);
        broadcastState(room);
        return true;
    }
}

function handlePass(room, pId) {
    let state = room.state;
    let pIdx = state.playersInfo.findIndex(p => p.id === pId);
    let defenderId = state.playersInfo[state.defenderIdx].id;
    if (pIdx === -1 || pId === defenderId) return false;
    state.passedThrowers[pId] = true;
    let nextIdx = getNextActiveThrowerIdx(state, state.currentThrowerIdx);
    if (nextIdx !== -1) {
        state.currentThrowerIdx = nextIdx;
    }
    if (checkAllPassedOrFinished(state)) {
        if (state.defenderTakesIntent) {
            executeTakeCards(room);
            return true;
        } else {
            let allCovered = state.table.length > 0 && state.table.every(p => p.defense !== null);
            if (allCovered) {
                executeBito(room);
                return true;
            }
        }
    }
    broadcastState(room);
    scheduleBotTurn(room);
    return true;
}

function handleTakeIntent(room, pId) {
    let state = room.state;
    let defenderId = state.playersInfo[state.defenderIdx].id;
    if (pId !== defenderId) {
        io.to(pId).emit('error_msg', 'Брать может только защищающийся');
        return false;
    }
    if (state.table.length === 0) {
        io.to(pId).emit('error_msg', 'На столе нет карт');
        return false;
    }
    state.defenderTakesIntent = true;
    if (checkAllPassedOrFinished(state)) {
        executeTakeCards(room);
    } else {
        broadcastState(room);
        scheduleBotTurn(room);
    }
    return true;
}

function executeTakeCards(room) {
    let state = room.state;
    let defenderId = state.playersInfo[state.defenderIdx].id;
    for (let p of state.table) {
        state.hands[defenderId].push(p.attack);
        if (p.defense) state.hands[defenderId].push(p.defense);
    }
    state.table = [];
    sortHand(state.hands[defenderId], state.trumpSuit);
    refillAllHands(state);
    if (checkGameOver(room)) {
        broadcastState(room);
        return;
    }
    state.attackerIdx = (state.defenderIdx + 1) % state.playersInfo.length;
    state.defenderIdx = (state.attackerIdx + 1) % state.playersInfo.length;
    resetThrowingRoundState(state);
    broadcastState(room);
    scheduleBotTurn(room);
}

function executeBito(room) {
    let state = room.state;
    state.table = [];
    refillAllHands(state);
    if (checkGameOver(room)) {
        broadcastState(room);
        return;
    }
    state.attackerIdx = state.defenderIdx;
    state.defenderIdx = (state.attackerIdx + 1) % state.playersInfo.length;
    resetThrowingRoundState(state);
    broadcastState(room);
    scheduleBotTurn(room);
}

function refillAllHands(state) {
    let count = state.playersInfo.length;
    for (let i = 0; i < count; i++) {
        let idx = (state.attackerIdx + i) % count;
        let pId = state.playersInfo[idx].id;
        if (!state.hands[pId]) state.hands[pId] = [];
        while (state.hands[pId].length < 6 && state.deck.length > 0) {
            state.hands[pId].push(state.deck.pop());
        }
        sortHand(state.hands[pId], state.trumpSuit);
    }
    if (state.deck.length === 0) state.trumpCard = null;
}

function checkGameOver(room) {
    let state = room.state;
    if (state.deck.length > 0) return false;
    let playersWithCards = state.playersInfo.filter(p => state.hands[p.id] && state.hands[p.id].length > 0);
    if (playersWithCards.length <= 1) {
        state.isGameOver = true;
        state.winner = playersWithCards.length === 1 ? playersWithCards.id : null;
        io.to(room.id).emit('game_over', { state: state, winner: state.winner });
        startRematchCountdown(room);
        return true;
    }
    return false;
}

function scheduleBotTurn(room) {
    if (!room || !room.state || room.state.isGameOver) return;
    if (room.botLoopTimeout) clearTimeout(room.botLoopTimeout);
    room.botLoopTimeout = setTimeout(() => { executeBotTurnChain(room); }, 800);
}

function executeBotTurnChain(room) {
    if (!room || !room.state || room.state.isGameOver) return;
    let state = room.state;
    let defP = state.playersInfo[state.defenderIdx];
    let uncoveredIdx = state.table.findIndex(p => p.defense === null);
    let playerCount = state.playersInfo.length;

    if (uncoveredIdx !== -1) {
        if (defP && !defP.isBot) {
            broadcastState(room);
            return;
        }
        if (defP && defP.isBot) {
            let attCard = state.table[uncoveredIdx].attack;
            let botHand = state.hands[defP.id] || [];
            let bestIdx = -1; let minVal = 999;
            for (let i = 0; i < botHand.length; i++) {
                let c = botHand[i];
                if (canBeat(attCard, c, state.trumpSuit)) {
                    let isTr = (c.suit === state.trumpSuit ? 1 : 0);
                    let score = isTr ? 100 + c.value : c.value;
                    if (score < minVal) { minVal = score; bestIdx = i; }
                }
            }
            if (bestIdx !== -1) {
                handlePlayCard(room, defP.id, bestIdx);
                scheduleBotTurn(room);
            } else {
                handleTakeIntent(room, defP.id);
                scheduleBotTurn(room);
            }
        }
        return;
    }

    if (state.table.length === 0) {
        let checkedCount = 0;
        while (checkedCount < playerCount) {
            let attP = state.playersInfo[state.attackerIdx];
            if (hasAnyCards(state, attP.id)) break;
            state.attackerIdx = (state.attackerIdx + 1) % playerCount;
            state.defenderIdx = (state.attackerIdx + 1) % playerCount;
            resetThrowingRoundState(state);
            checkedCount++;
        }
        if (checkGameOver(room)) return;
        let attP = state.playersInfo[state.attackerIdx];
        if (attP && !attP.isBot) {
            broadcastState(room);
            return;
        }
        if (attP && attP.isBot && hasAnyCards(state, attP.id)) {
            let botHand = state.hands[attP.id] || [];
            let nonTrumps = botHand.map((c, idx) => ({c, idx})).filter(o => o.c.suit !== state.trumpSuit);
            let targetIdx = 0;
            if (nonTrumps.length > 0) {
                nonTrumps.sort((a,b) => a.c.value - b.c.value);
                targetIdx = nonTrumps.idx;
            }
            handlePlayCard(room, attP.id, targetIdx);
            scheduleBotTurn(room);
        }
        return;
    }

    if (state.table.length > 0 && uncoveredIdx === -1) {
        if (checkAllPassedOrFinished(state)) {
            if (state.defenderTakesIntent) {
                executeTakeCards(room);
            } else {
                executeBito(room);
            }
            return;
        }
        let curThrower = state.playersInfo[state.currentThrowerIdx];
        if (!curThrower || curThrower.id === defP.id || !hasAnyCards(state, curThrower.id) || state.passedThrowers[curThrower.id]) {
            let nextIdx = getNextActiveThrowerIdx(state, state.currentThrowerIdx);
            if (nextIdx !== -1) {
                state.currentThrowerIdx = nextIdx;
                scheduleBotTurn(room);
            } else {
                if (checkAllPassedOrFinished(state)) {
                    if (state.defenderTakesIntent) executeTakeCards(room);
                    else executeBito(room);
                }
            }
            return;
        }
        if (!curThrower.isBot) {
            broadcastState(room);
            return;
        }
        let hand = state.hands[curThrower.id] || [];
        let tRanks = getTableRanks(state.table);
        let matchObj = hand.map((c, idx) => ({c, idx})).filter(o => tRanks.has(o.c.rank));
        let defLen = (state.hands[defP.id] || []).length;
        let canAdd = state.table.length < Math.min(6, defLen + countDefendedPairs(state.table));
        if (matchObj.length > 0 && canAdd) {
            matchObj.sort((a,b) => {
                let aTr = a.c.suit === state.trumpSuit ? 1 : 0;
                let bTr = b.c.suit === state.trumpSuit ? 1 : 0;
                if (aTr !== bTr) return aTr - bTr;
                return a.c.value - b.c.value;
            });
            handlePlayCard(room, curThrower.id, matchObj.idx);
            scheduleBotTurn(room);
        } else {
            state.passedThrowers[curThrower.id] = true;
            let nextIdx = getNextActiveThrowerIdx(state, state.currentThrowerIdx);
            if (nextIdx !== -1) {
                state.currentThrowerIdx = nextIdx;
            }
            scheduleBotTurn(room);
        }
    }
}

function startRematchCountdown(room) {
    let timeLeft = 15;
    room.rematchVotes.clear();
    if (room.rematchTimer) clearInterval(room.rematchTimer);
    io.to(room.id).emit('rematch_timer', timeLeft);
    room.rematchTimer = setInterval(() => {
        timeLeft--;
        io.to(room.id).emit('rematch_timer', timeLeft);
        if (timeLeft <= 0) {
            clearInterval(room.rematchTimer);
            let humanPlayers = room.players.filter(p => !p.isBot);
            if (room.rematchVotes.size >= humanPlayers.length && humanPlayers.length > 0) startRematch(room);
            else { io.to(room.id).emit('room_expired'); delete rooms[room.id]; }
        }
    }, 1000);
}

function startRematch(room) {
    if (room.rematchTimer) clearInterval(room.rematchTimer);
    initGameState(room);
    io.to(room.id).emit('game_restarted');
    broadcastState(room);
    scheduleBotTurn(room);
}

function broadcastState(room) {
    room.players.forEach(p => {
        if (!p.isBot) {
            let adaptedState = JSON.parse(JSON.stringify(room.state));
            let realHands = {};
            room.players.forEach(targetP => {
                if (targetP.id === p.id) {
                    realHands[p.id] = room.state.hands[p.id] || [];
                } else {
                    realHands[targetP.id] = new Array((room.state.hands[targetP.id] || []).length).fill({});
                }
            });
            adaptedState.hands = realHands;
            adaptedState.playersInfo.forEach(info => {
                if (info.id === p.id) info.name = 'Вы';
            });
            io.to(p.id).emit('game_update', adaptedState);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`[Сервер] Запущен на порту ${PORT}`); });
