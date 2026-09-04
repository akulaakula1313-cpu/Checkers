const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');
const statusUpdate = document.getElementById('statusUpdate');
const chatBox = document.getElementById('chatBox');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const gameOverScreen = document.getElementById('gameOverScreen');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const rematchBtn = document.getElementById('rematchBtn');

// Для салютов
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');

const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

let board = null;
let myColor = null;
let currentTurn = null;
let selectedPiece = null;
let fireworks = [];
let fireworkTimer = null;

const virtualBoardSize = 400;
const cellSize = virtualBoardSize / 8;

// Авто-подстройка размера холста салютов под экран устройства
function resizeFxCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeFxCanvas);
resizeFxCanvas();

function playTurnSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc1 = audioCtx.createOscillator();
        let gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        gain1.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc1.connect(gain1); gain1.connect(audioCtx.destination);
        osc1.start(); osc1.stop(audioCtx.currentTime + 0.15);

        setTimeout(() => {
            let osc2 = audioCtx.createOscillator();
            let gain2 = audioCtx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880, audioCtx.currentTime);
            gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
            osc2.connect(gain2); gain2.connect(audioCtx.destination);
            osc2.start(); osc2.stop(audioCtx.currentTime + 0.25);
        }, 70);
    } catch (e) { console.log(e); }
}

function startGame(mode) {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    chatBox.style.display = mode === 'pvp' ? 'block' : 'none';
    ws.send(JSON.stringify({ type: 'START_GAME', mode }));
}

function backToMenu() { window.location.reload(); }
function toggleChat() { chatBox.style.display = chatBox.style.display === 'block' ? 'none' : 'block'; }

function sendChatMessage() {
    const text = chatInput.value.trim();
    if(!text) return;
    ws.send(JSON.stringify({ type: 'CHAT_MSG', text }));
    chatInput.value = '';
}

// Быстрая отправка смайлика по кнопке
function sendQuickEmoji(emoji) {
    ws.send(JSON.stringify({ type: 'CHAT_MSG', text: emoji }));
}

function requestRematch() {
    rematchBtn.innerText = '⏳ ОЖИДАНИЕ СОПЕРНИКА...';
    rematchBtn.disabled = true;
    ws.send(JSON.stringify({ type: 'REQUEST_REMATCH' }));
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'WAITING') {
        statusUpdate.innerText = data.message;
        if(data.code) { document.getElementById('generatedCode').innerText = data.code; }
    } else if (data.type === 'GAME_STARTED' || data.type === 'STATE_UPDATE') {
        document.getElementById('waitingScreen').style.display = 'none';
        gameOverScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        stopFireworks(); // Останавливаем празднование при старте новой игры
        
        rematchBtn.innerText = '🔄 ПРЕДЛОЖИТЬ РЕВАНШ';
        rematchBtn.disabled = false;
        rematchBtn.style.background = ''; 

        board = data.board;
        if (data.turn !== currentTurn && data.turn === myColor) { playTurnSound(); }
        
        currentTurn = data.turn;
        if (data.color) myColor = data.color;

        document.getElementById('p1Name').innerText = myColor === 'w' ? 'ВЫ (Белые)' : 'ВЫ (Черные)';
        document.getElementById('p2Name').innerText = data.mode === 'bot' ? 'БОТ ИИ' : 'ИГРОК';

        statusUpdate.innerText = currentTurn === myColor ? 'ВАШ ХОД!' : 'ОЖИДАНИЕ ХОДА...';
        drawBoard();
    } else if (data.type === 'CHAT_MSG') {
        const msgHtml = `<div><b>${data.sender}:</b> ${data.text}</div>`;
        chatMessages.innerHTML += msgHtml;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'GAME_OVER') {
        gameOverScreen.style.display = 'flex';
        if (data.result === 'WIN') {
            resultTitle.innerText = '🎉 ПОБЕДА! 🎉';
            resultTitle.className = 'result-title win-style';
            resultText.innerText = 'Вы полностью сокрушили соперника!';
            startFireworks(); // Запуск салюта при Вашей победе!
        } else {
            resultTitle.innerText = '💀 ПОРАЖЕНИЕ 💀';
            resultTitle.className = 'result-title lose-style';
            resultText.innerText = 'В следующий раз точно повезет!';
        }
    } else if (data.type === 'REMATCH_REQUESTED') {
        rematchBtn.innerText = '⚡ СОПЕРНИК ХОЧЕТ РЕВАНШ! НАЖМИТЕ';
        rematchBtn.style.background = 'linear-gradient(to bottom, #10b981, #047857)'; 
    } else if (data.type === 'OPPONENT_DISCONNECTED') {
        statusUpdate.innerText = 'Соперник покинул игру.';
        rematchBtn.innerText = '❌ РЕВАНШ НЕВОЗМОЖЕН';
        rematchBtn.disabled = true;
    }
};

// Расчет тапов для мобильных
canvas.addEventListener('click', (e) => {
    if (!board || currentTurn !== myColor) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const scaleX = virtualBoardSize / rect.width;
    const scaleY = virtualBoardSize / rect.height;
    const virtualX = clientX * scaleX;
    const virtualY = clientY * scaleY;
    let c = Math.floor(virtualX / cellSize);
    let r = Math.floor(virtualY / cellSize);
    if (myColor === 'b') {
        r = 7 - r;
        c = 7 - c;
    }
    const piece = board[r][c];
    if (piece && piece.toLowerCase() === myColor) {
        selectedPiece = { r, c };
        drawBoard();
    } else if (selectedPiece) {
        ws.send(JSON.stringify({ type: 'MAKE_MOVE', from: selectedPiece, to: { r, c } }));
        selectedPiece = null;
    }
});

function drawBoard() {
    if (!board) return;
    ctx.clearRect(0, 0, virtualBoardSize, virtualBoardSize);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            let drawR = (myColor === 'b') ? (7 - r) : r;
            let drawC = (myColor === 'b') ? (7 - c) : c;
            ctx.fillStyle = (r + c) % 2 === 0 ? '#ffedd5' : '#9a3412';
            ctx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.strokeRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                ctx.fillStyle = 'rgba(234, 179, 8, 0.5)';
                ctx.fillRect(drawC * cellSize, drawR * cellSize, cellSize, cellSize);
            }
            const piece = board[r][c];
            if (piece) {
                let cx = drawC * cellSize + cellSize / 2;
                let cy = drawR * cellSize + cellSize / 2;
                let r1 = cellSize * 0.4;
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetY = 4;
                let gradient = ctx.createRadialGradient(cx - 2, cy - 2, 2, cx, cy, r1);
                if (piece.toLowerCase() === 'w') {
                    gradient.addColorStop(0, '#ffffff');
                    gradient.addColorStop(0.8, '#e2e8f0');
                    gradient.addColorStop(1, '#cbd5e1');
                } else {
                    gradient.addColorStop(0, '#475569');
                    gradient.addColorStop(0.8, '#1e293b');
                    gradient.addColorStop(1, '#0f172a');
                }
                ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2);
                ctx.fillStyle = gradient; ctx.fill(); ctx.restore();
                ctx.strokeStyle = piece.toLowerCase() === 'w' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.75, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.5, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.25, 0, Math.PI * 2); ctx.stroke();
                if (piece === 'W' || piece === 'B') {
                    ctx.font = '16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#eab308'; ctx.fillText('👑', cx, cy - 1);
                }
            }
        }
    }
}

// ДВИЖОК ЭФФЕКТА КРАСИВЫХ САЛЮТОВ
function createFireworkExplosion(x, y) {
    const colors = ['#eab308', '#f97316', '#ef4444', '#3b82f6', '#10b981', '#a855f7'];
    const pCount = 50;
    const baseColor = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < pCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        fireworks.push({
            x: x, y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1,
            color: baseColor,
            size: Math.random() * 3 + 2
        });
    }
}

function updateFireworksLoop() {
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    for (let i = fireworks.length - 1; i >= 0; i--) {
        let p = fireworks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // Гравитация (падение вниз)
        p.alpha -= 0.015; // Постепенное затухание
        if (p.alpha <= 0) {
            fireworks.splice(i, 1);
            continue;
        }
        fxCtx.save();
        fxCtx.globalAlpha = p.alpha;
        fxCtx.fillStyle = p.color;
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        fxCtx.fill();
        fxCtx.restore();
    }
    if (fireworks.length > 0 || fireworkTimer !== null) {
        requestAnimationFrame(updateFireworksLoop);
    }
}

function startFireworks() {
    if (fireworkTimer !== null) return;
    updateFireworksLoop();
    fireworkTimer = setInterval(() => {
        // Спавним случайный залп салюта в верхней части экрана
        const rx = Math.random() * fxCanvas.width;
        const ry = Math.random() * (fxCanvas.height * 0.5) + 100;
        createFireworkExplosion(rx, ry);
    }, 450);
}

function stopFireworks() {
    clearInterval(fireworkTimer);
    fireworkTimer = null;
    fireworks = [];
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
}