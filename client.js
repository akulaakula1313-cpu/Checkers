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
const bgMusic = document.getElementById('bgMusic');
const musicToggleBtn = document.getElementById('musicToggleBtn');

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
let lastMoveState = null; 
let mustCapturePieces = []; // Массив для хранения шашек, обязанных бить

const virtualBoardSize = 400;
const cellSize = virtualBoardSize / 8;

function resizeFxCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeFxCanvas);
resizeFxCanvas();

function toggleMusic() {
    if (bgMusic.paused) {
        bgMusic.play().catch(e => console.log(e));
        musicToggleBtn.style.opacity = "1";
        musicToggleBtn.style.background = "linear-gradient(to bottom, #22c55e, #16a34a)"; 
    } else {
        bgMusic.pause();
        musicToggleBtn.style.opacity = "0.6";
        musicToggleBtn.style.background = ""; 
    }
}

function playTurnSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc1 = audioCtx.createOscillator();
        let gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc1.connect(gain1); gain1.connect(audioCtx.destination);
        osc1.start(); osc1.stop(audioCtx.currentTime + 0.15);

        setTimeout(() => {
            let osc2 = audioCtx.createOscillator();
            let gain2 = audioCtx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880, audioCtx.currentTime);
            gain2.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
            osc2.connect(gain2); gain2.connect(audioCtx.destination);
            osc2.start(); osc2.stop(audioCtx.currentTime + 0.25);
        }, 70);
    } catch (e) {}
}

function playErrorSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.type = 'sawtooth'; 
        osc.frequency.setValueAtTime(130, audioCtx.currentTime); 
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    } catch(e){}
}

function playWinSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            let osc = audioCtx.createOscillator();
            let gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.05);
            gain.gain.setValueAtTime(0.06, audioCtx.currentTime + idx * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.8);
        });

        for (let i = 0; i < 40; i++) {
            setTimeout(() => {
                let bufferSize = audioCtx.sampleRate * 0.08;
                let buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                let data = buffer.getChannelData(0);
                for (let j = 0; j < bufferSize; j++) { data[j] = Math.random() * 2 - 1; }
                let noise = audioCtx.createBufferSource();
                noise.buffer = buffer;
                let filter = audioCtx.createBiquadFilter();
                filter.type = 'bandpass'; filter.frequency.value = 1000;
                let noiseGain = audioCtx.createGain();
                noiseGain.gain.setValueAtTime(0.12, audioCtx.currentTime);
                noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
                noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(audioCtx.destination);
                noise.start();
            }, Math.random() * 1500);
        }
    } catch(e){}
}

function playLoseSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(90, audioCtx.currentTime + 0.8); 
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.8);
    } catch(e){}
}

function startGame(mode) {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    chatBox.style.display = mode === 'pvp' ? 'block' : 'none';
    ws.send(JSON.stringify({ type: 'START_GAME', mode }));
    if(bgMusic.paused) { toggleMusic(); }
}

function backToMenu() { window.location.reload(); }
function toggleChat() { chatBox.style.display = chatBox.style.display === 'block' ? 'none' : 'block'; }
function sendChatMessage() {
    const text = chatInput.value.trim();
    if(!text) return;
    ws.send(JSON.stringify({ type: 'CHAT_MSG', text }));
    chatInput.value = '';
}
function sendQuickEmoji(emoji) { ws.send(JSON.stringify({ type: 'CHAT_MSG', text: emoji })); }
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
        menuScreen.style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        
        gameOverScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        stopFireworks();
        
        rematchBtn.innerText = '🔄 ПРЕДЛОЖИТЬ РЕВАНШ';
        rematchBtn.disabled = false;
        rematchBtn.style.background = ''; 

        let oldBoardStr = JSON.stringify(board);
        board = data.board;
        let newBoardStr = JSON.stringify(board);

        if (data.turn !== currentTurn && data.turn === myColor) {
            playTurnSound();
        } 
        else if (currentTurn === myColor && lastMoveState === 'sent' && oldBoardStr === newBoardStr) {
            playErrorSound();
        }
        
        lastMoveState = 'received';
        currentTurn = data.turn;
        if (data.color) myColor = data.color;

        mustCapturePieces = data.mustCapture || [];

        document.getElementById('p1Name').innerText = myColor === 'w' ? 'ВЫ (Белые)' : 'ВЫ (Черные)';
        document.getElementById('p2Name').innerText = data.mode === 'bot' ? 'БОТ ИИ' : 'ИГРОК';

        if (data.isInvalidAttempt && mustCapturePieces.length > 0) {
            statusUpdate.innerText = 'ОБЯЗАТЕЛЬНЫЙ БОЙ! ВЫ ОБЯЗАНЫ БИТЬ!';
            statusUpdate.style.color = '#ef4444'; 
        } else {
            statusUpdate.innerText = currentTurn === myColor ? 'ВАШ ХОД!' : 'ОЖИДАНИЕ ХОДА...';
            statusUpdate.style.color = '#fde047'; 
        }

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
            playWinSound();
            startFireworks();
        } else {
            resultTitle.innerText = '💀 ПОРАЖЕНИЕ 💀';
            resultTitle.className = 'result-title lose-style';
            resultText.innerText = 'В следующий раз точно повезет!';
            playLoseSound();
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
    if (myColor === 'b') { r = 7 - r; c = 7 - c; }
    const piece = board[r][c];
    if (piece && piece.toLowerCase() === myColor) {
        selectedPiece = { r, c };
        drawBoard();
    } else if (selectedPiece) {
        lastMoveState = 'sent';
        ws.send(JSON.stringify({ type: 'MAKE_MOVE', from: selectedPiece, to: { r, c } }));
        let dr = Math.abs(r - selectedPiece.r);
        let dc = Math.abs(c - selectedPiece.c);
        if (dr !== dc || board[r][c] !== null) {
            playErrorSound();
        }
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
            let bx = drawC * cellSize;
            let by = drawR * cellSize;
            if ((r + c) % 2 === 0) {
                ctx.fillStyle = '#fce8c7';
            } else {
                ctx.fillStyle = '#802302';
            }
            ctx.fillRect(bx, by, cellSize, cellSize);
            ctx.save();
            ctx.strokeStyle = (r + c) % 2 === 0 ? 'rgba(180,100,20,0.06)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(virtualBoardSize / 2, virtualBoardSize / 2, Math.abs(bx - 100) + by * 0.4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, cellSize, cellSize);

            if (currentTurn === myColor) {
                const isMustCapture = mustCapturePieces.some(p => p.r === r && p.c === c);
                if (isMustCapture) {
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'; 
                    ctx.fillRect(bx, by, cellSize, cellSize);
                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(bx + 1, by + 1, cellSize - 2, cellSize - 2);
                }
            }

            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                ctx.fillStyle = 'rgba(234, 179, 8, 0.45)';
                ctx.fillRect(bx, by, cellSize, cellSize);
                ctx.strokeStyle = '#eab308';
                ctx.lineWidth = 2;
                ctx.strokeRect(bx + 1, by + 1, cellSize - 2, cellSize - 2);
            }

            const piece = board[r][c];
            if (piece) {
                let cx = bx + cellSize / 2;
                let cy = by + cellSize / 2;
                let r1 = cellSize * 0.38;
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
                ctx.shadowBlur = 5;
                ctx.shadowOffsetY = 3;
                ctx.shadowOffsetX = 1;
                let gradient = ctx.createRadialGradient(cx - r1 * 0.3, cy - r1 * 0.3, r1 * 0.1, cx, cy, r1);
                if (piece.toLowerCase() === 'w') {
                    gradient.addColorStop(0, '#ffffff');
                    gradient.addColorStop(0.6, '#e2e8f0');
                    gradient.addColorStop(1, '#94a3b8');
                } else {
                    gradient.addColorStop(0, '#475569');
                    gradient.addColorStop(0.7, '#1e293b');
                    gradient.addColorStop(1, '#020617');
                }
                ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2);
                ctx.fillStyle = gradient; ctx.fill(); ctx.restore();
                ctx.strokeStyle = piece.toLowerCase() === 'w' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.72, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.48, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, r1 * 0.24, 0, Math.PI * 2); ctx.stroke();
                let bGrd = ctx.createLinearGradient(cx - r1, cy - r1, cx + r1, cy + r1);
                bGrd.addColorStop(0, 'rgba(255,255,255,0.22)');
                bGrd.addColorStop(0.3, 'rgba(255,255,255,0.0)');
                ctx.beginPath(); ctx.arc(cx, cy, r1 - 1, 0, Math.PI * 2); ctx.fillStyle = bGrd; ctx.fill();
                if (piece === 'W' || piece === 'B') {
                    ctx.font = '16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#eab308'; ctx.fillText('👑', cx, cy - 1);
                }
            }
        }
    }
}

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
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.alpha -= 0.015;
        if (p.alpha <= 0) { fireworks.splice(i, 1); continue; }
        fxCtx.save(); fxCtx.globalAlpha = p.alpha; fxCtx.fillStyle = p.color;
        fxCtx.beginPath(); fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); fxCtx.fill(); fxCtx.restore();
    }
    if (fireworks.length > 0 || fireworkTimer !== null) { requestAnimationFrame(updateFireworksLoop); }
}

function startFireworks() {
    if (fireworkTimer !== null) return;
    updateFireworksLoop();
    fireworkTimer = setInterval(() => {
        const rx = Math.random() * fxCanvas.width;
        const ry = Math.random() * (fxCanvas.height * 0.5) + 100;
        createFireworkExplosion(rx, ry);
    }, 450);
}

function stopFireworks() {
    clearInterval(fireworkTimer); fireworkTimer = null; fireworks = [];
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
}
