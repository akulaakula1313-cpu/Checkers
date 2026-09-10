const http = require('http'),
      fs = require('fs'),
      path = require('path'),
      crypto = require('crypto'),
      mongoose = require('mongoose');

const PORT = Number(process.env.PORT || 3000), 
      ROOT = __dirname;

const MONGO_URI = 'mongodb+srv://akulaakula1313_db_user:eVzH0Leb06TWlySA@cluster0.22ubyfp.mongodb.net/checkers_game?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(() => console.log('SANI DB: Успешно подключено к облаку MongoDB Atlas!'))
  .catch(err => console.error('SANI DB: Ошибка подключения к MongoDB:', err));

const UserSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  nameHistory: [String],
  chips: { type: Number, default: 100000 },
  inventory: {
    boards: { type: [String], default: ['classic'] },
    pieces: { type: [String], default: ['classic'] },
    selectedBoard: { type: String, default: 'classic' },
    selectedPieces: { type: String, default: 'classic' }
  },
  vip: { type: Boolean, default: false },
  banned: { type: Boolean, default: false },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  rating: { type: Number, default: 1000 },
  dailyGift: {
    day: { type: Number, default: 1 },
    lastClaimDate: { type: String, default: null }
  },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now }
});

const SessionSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  userId: { type: String, required: true },
  createdAt: { type: Number, required: true },
  lastSeen: { type: Number, required: true }
});

const UserModel = mongoose.model('User', UserSchema);
const SessionModel = mongoose.model('Session', SessionSchema);

const rooms = new Map(), botGames = new Map(), rateBuckets = new Map();

const PLAYER_TIMEOUT = Number(process.env.PLAYER_TIMEOUT_MS || 5000), 
      DISCONNECT_GRACE = Number(process.env.DISCONNECT_GRACE_MS || 55 * 1000), 
      ROOM_TTL = 60 * 60 * 1000, 
      SESSION_TTL = 3650 * 24 * 60 * 60 * 1000, 
      ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000, 
      MAX_STAKE = 1000000000, 
      MAX_BODY = 1e6,
      RATE_WINDOW = 60000;

const DAILY_GIFT_AMOUNTS = [5000, 10000, 15000, 20000, 30000, 50000, 100000];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SaniAdminSecret1313';

const STORE_BOARDS = [['classic','Классика','Дерево и латунь',0],['emerald','Emerald','Изумрудный камень',30000],['midnight','Midnight','Ночной обсидиан',45000],['royal','Royal','Королевское золото',60000],['ice','Ice','Ледяной кристалл',75000],['vip_jewel','💎 Ювелирная VIP','Эксклюзивная ювелирная доска',null,'vip']];
const STORE_PIECES = [['classic','Classic','Классические шашки',0],['neo','Neo','Современный минимализм',25000],['royal','Royal','Премиальные золотые',45000],['glass','Glass','Стеклянные фигуры',65000],['neon','Neon','Неоновый стиль',80000],['vip_gem','💎 Ювелирные VIP','Эксклюзивные ювелирные фигуры',null,'vip']];

function uid() { return crypto.randomBytes(16).toString('hex'); }
function now() { return Date.now(); }

function json(res, code, data) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(),microphone=(),geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  if (res.getHeader('Set-Cookie')) h['Set-Cookie'] = res.getHeader('Set-Cookie');
  if (process.env.NODE_ENV === 'production') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  res.writeHead(code, h);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '', done = false;
    const fail = e => { if (!done) { done = true; reject(e); } };
    req.on('data', c => {
      if (done) return;
      b += c;
      if (b.length > MAX_BODY) { fail(new Error('Слишком большой запрос')); req.destroy(); }
    });
    req.on('end', () => {
      if (done) return;
      try { done = true; resolve(b ? JSON.parse(b) : {}); } catch { fail(new Error('Некорректный JSON')); }
    });
    req.on('error', fail);
  });
}

function sanitizeName(v) { return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24); }
function sanitizeId(v) { return String(v ?? '').replace(/[^a-f0-9]/gi, '').slice(0, 64); }

function serverDateKey(ts = now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function serverDateLabel(ts = now()) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ts));
}
function dailyGiftState(user, dateKey = serverDateKey()) {
  const dg = user.dailyGift || {};
  let day = Number(dg.day);
  if (!Number.isInteger(day) || day < 1 || day > 7) day = 1;
  const lastClaimDate = typeof dg.lastClaimDate === 'string' ? dg.lastClaimDate : null;
  const claimedToday = lastClaimDate === dateKey;
  return {
    serverDate: dateKey, serverDateLabel: serverDateLabel(),
    day, reward: DAILY_GIFT_AMOUNTS[day - 1], claimedToday, lastClaimDate,
    nextDay: claimedToday ? (day === 7 ? 1 : day + 1) : day,
    nextReward: DAILY_GIFT_AMOUNTS[(claimedToday ? (day === 7 ? 1 : day + 1) : day) - 1]
  };
}
function claimDailyGift(user, dateKey = serverDateKey()) {
  const state = dailyGiftState(user, dateKey);
  if (state.claimedToday) return { ok: false, error: 'Ежедневный подарок уже получен сегодня', state };
  const reward = state.reward;
  const nextDay = state.day === 7 ? 1 : state.day + 1;
  user.dailyGift = { day: nextDay, lastClaimDate: dateKey };
  user.chips = Math.min(MAX_STAKE, user.chips + reward);
  user.updatedAt = now();
  return { ok: true, reward, state: { ...state, claimedToday: true, nextDay, nextReward: DAILY_GIFT_AMOUNTS[nextDay - 1], day: state.day } };
}

async function getUser(id) { if (!id) return null; return await UserModel.findOne({ id: id }); }
async function uniqueName(name, except = null) {
  const n = sanitizeName(name); if (!n) return '';
  const query = { name: { $regex: new RegExp(`^${n}$`, 'i') } };
  if (except) query.id = { $ne: except };
  const collision = await UserModel.findOne(query);
  return collision ? '' : n;
}
async function ensureUser(name) {
  const n = await uniqueName(name);
  if (!n) throw Error('Никнейм уже занят или некорректен');
  const u = new UserModel({
    id: uid(), name: n, nameHistory: [n], chips: 100000,
    inventory: { boards: ['classic'], pieces: ['classic'], selectedBoard: 'classic', selectedPieces: 'classic' },
    vip: false, banned: false, wins: 0, losses: 0, draws: 0, rating: 1000,
    createdAt: now(), updatedAt: now(), dailyGift: { day: 1, lastClaimDate: null }
  });
  await u.save(); return u;
}
function userView(u) {
  const inv = JSON.parse(JSON.stringify(u.inventory));
  const gift = dailyGiftState(u);
  if (!u.vip) {
    if (inv.selectedBoard === 'vip_jewel') inv.selectedBoard = 'classic';
    if (inv.selectedPieces === 'vip_gem') inv.selectedPieces = 'classic';
  }
  return {
    id: u.id, name: u.name,
    nameHistory: Array.isArray(u.nameHistory) ? u.nameHistory.slice(-20) : [u.name].filter(Boolean),
    chips: u.chips, inventory: inv, vip: !!u.vip, banned: !!u.banned,
    wins: u.wins, losses: u.losses, draws: u.draws, rating: u.rating, dailyGift: gift
  };
}

function parseCookies(req) {
  const o = {};
  for (const x of String(req.headers.cookie || '').split(';')) {
    const i = x.indexOf('=');
    if (i > 0) o[x.slice(0, i).trim()] = decodeURIComponent(x.slice(i + 1).trim());
  }
  return o;
}
function setCookie(res, n, v, max) {
  res.setHeader('Set-Cookie', `${n}=${encodeURIComponent(v)}; Max-Age=${max}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function clearCookie(res, n) { setCookie(res, n, '', 0); }
function sessionKey(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }

async function persistSession(token, rec) {
  await SessionModel.findOneAndUpdate(
    { key: sessionKey(token) },
    { userId: rec.userId, createdAt: rec.createdAt, lastSeen: rec.lastSeen },
    { upsert: true, new: true }
  );
}
async function dropSession(token) { await SessionModel.deleteOne({ key: sessionKey(token) }); }

async function currentUser(req, res) {
  const token = parseCookies(req).sani_session;
  if (!token) throw Object.assign(new Error('Сессия не найдена'), { status: 401 });
  const s = await SessionModel.findOne({ key: sessionKey(token) });
  if (!s) throw Object.assign(new Error('Сессия не найдена'), { status: 401 });
  if (now() - s.createdAt > SESSION_TTL) {
    await dropSession(token); clearCookie(res, 'sani_session');
    throw Object.assign(new Error('Сессия истекла'), { status: 401 });
  }
  const u = await getUser(s.userId);
  if (!u || u.banned) {
    await dropSession(token); clearCookie(res, 'sani_session');
    throw Object.assign(new Error(u ? 'Пользователь заблокирован' : 'Пользователь не найден'), { status: u ? 403 : 401 });
  }
  s.lastSeen = now();
  await s.save();
  return u;
}

const adminSessions = new Map();
function requireAdmin(req, res) {
  const s = adminSessions.get(parseCookies(req).sani_admin);
  if (!s || now() - s.createdAt > ADMIN_SESSION_TTL) throw Object.assign(new Error('Доступ запрещён'), { status: 401 });
  return true;
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 80); }
function allowRate(key, limit, win) {
  const t = now(), a = (rateBuckets.get(key) || []).filter(x => t - x < win);
  if (a.length >= limit) { rateBuckets.set(key, a); return false; }
  a.push(t); rateBuckets.set(key, a); return true;
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function cleanupTransient() {
  const t = now();
  for (const [k, a] of rateBuckets) {
    const fresh = a.filter(x => t - x < RATE_WINDOW);
    if (fresh.length) rateBuckets.set(k, fresh); else rateBuckets.delete(k);
  }
  await SessionModel.deleteMany({ createdAt: { $lt: t - SESSION_TTL } });
  for (const [k, s] of adminSessions) if (!s?.createdAt || t - s.createdAt > ADMIN_SESSION_TTL) adminSessions.delete(k);
}

// ============================================================================
// CHECKERS ENGINE — Russian-style custom SANI rules
// ============================================================================
function xy(s) { return [s % 8, Math.floor(s / 8)]; }
function at(f, r) { return r * 8 + f; }
function inside(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
function sideOf(p) { return p && p.toLowerCase() === 'w' ? 'w' : p && p.toLowerCase() === 'b' ? 'b' : null; }
function enemy(c) { return c === 'w' ? 'b' : 'w'; }
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const START_POS = 'b1b1b1b1/1b1b1b1b/b1b1b1b1/8/8/1w1w1w1w/w1w1w1w1/1w1w1w1w w';

function parsePos(str) {
  const [placement, side = 'w'] = String(str || START_POS).trim().split(/\s+/), b = Array(64).fill(null);
  let r = 7, f = 0;
  for (const ch of placement) {
    if (ch === '/') { r--; f = 0; }
    else if (/[1-8]/.test(ch)) f += +ch;
    else if (/[wWbB]/.test(ch)) {
      if ((f + r) % 2 === 0) throw Error('Шашка должна стоять на тёмной клетке');
      b[at(f++, r)] = ch;
    } else throw Error('Некорректная позиция');
  }
  if (r !== 0 || f !== 8 || !['w', 'b'].includes(side)) throw Error('Некорректная позиция');
  return { board: b, side, captureFrom: null, history: [] };
}

function pos(st) {
  let p = '';
  for (let r = 7; r >= 0; r--) {
    let e = 0;
    for (let f = 0; f < 8; f++) {
      const x = st.board[at(f, r)];
      if (!x) e++;
      else { if (e) { p += e; e = 0; } p += x; }
    }
    if (e) p += e; if (r) p += '/';
  }
  return p + ' ' + st.side;
}
function clone(st) { return { board: st.board.slice(), side: st.side, captureFrom: st.captureFrom, history: st.history.slice() }; }

function captureMovesFor(st, from) {
  const p = st.board[from], c = sideOf(p);
  if (!p || c !== st.side) return [];
  const [f, r] = xy(from), out = [];
  if (p === 'w' || p === 'b') {
    for (const [df, dr] of DIAG) {
      const mf = f + df, mr = r + dr, tf = f + 2 * df, tr = r + 2 * dr;
      if (inside(tf, tr) && inside(mf, mr)) {
        const mid = st.board[at(mf, mr)], to = at(tf, tr);
        if (mid && sideOf(mid) === enemy(c) && !st.board[to]) out.push({ from, to, capture: at(mf, mr) });
      }
    }
  } else {
    for (const [df, dr] of DIAG) {
      let F = f + df, R = r + dr, seen = -1;
      while (inside(F, R)) {
        const s = at(F, R), q = st.board[s];
        if (q) {
          if (sideOf(q) === c) break;
          if (seen !== -1) break;
          seen = s;
        } else if (seen !== -1) out.push({ from, to: s, capture: seen });
        F += df; R += dr;
      }
    }
  }
  return out;
}

function quietMovesFor(st, from) {
  const p = st.board[from], c = sideOf(p);
  if (!p || c !== st.side) return [];
  const [f, r] = xy(from), out = [];
  if (p === 'w' || p === 'b') {
    const dr = c === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const F = f + df, R = r + dr;
      if (inside(F, R) && !st.board[at(F, R)]) out.push({ from, to: at(F, R) });
    }
  } else {
    for (const [df, dr] of DIAG) {
      let F = f + df, R = r + dr;
      while (inside(F, R) && !st.board[at(F, R)]) {
        out.push({ from, to: at(F, R) });
        F += df; R += dr;
      }
    }
  }
  return out;
}

function allCaptures(st) {
  const out = [];
  for (let i = 0; i < 64; i++) if (sideOf(st.board[i]) === st.side) out.push(...captureMovesFor(st, i));
  return out;
}
function allMoves(st) {
  const caps = allCaptures(st);
  if (caps.length) return caps;
  const out = [];
  for (let i = 0; i < 64; i++) if (sideOf(st.board[i]) === st.side) out.push(...quietMovesFor(st, i));
  return out;
}
function legalMoves(st) {
  if (st.captureFrom != null) return captureMovesFor(st, st.captureFrom);
  return allMoves(st);
}
function applyMove(st, m) {
  const n = clone(st), p = n.board[m.from], c = n.side;
  n.board[m.from] = null;
  if (m.capture != null) n.board[m.capture] = null;
  let q = p; const [, r] = xy(m.to);
  if (p === 'w' && r === 7) q = 'W';
  if (p === 'b' && r === 0) q = 'B';
  n.board[m.to] = q;
  const more = m.capture != null ? captureMovesFor(n, m.to) : [];
  if (m.capture != null && more.length) { n.captureFrom = m.to; } else { n.captureFrom = null; n.side = enemy(c); }
  n.history.push(pos(n));
  return n;
}
function commitCaptureEnd(st) {
  if (st.captureFrom == null) return st;
  const n = clone(st);
  n.captureFrom = null;
  n.side = enemy(n.side);
  n.history.push(pos(n));
  return n;
}
function parseMove(st, from, to) { return legalMoves(st).find(m => m.from === from && m.to === to) || null; }
function gameStatus(st) {
  const pieces = st.board.filter(Boolean);
  if (!pieces.some(p => sideOf(p) === 'w')) return 'b';
  if (!pieces.some(p => sideOf(p) === 'b')) return 'w';
  if (!legalMoves(st).length) return enemy(st.side);
  return null;
}
function moveRecord(m, st) { return { from: m.from, to: m.to, capture: m.capture == null ? null : m.capture, piece: st.board[m.from] }; }
function materialCount(st, c) { let men = 0, kings = 0; for (const p of st.board) if (p && sideOf(p) === c) { if (p === p.toUpperCase()) kings++; else men++; } return { men, kings, total: men + kings }; }

// ============================================================================
// BOT AI (3 уровня)
// ============================================================================
function positionEval(st) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i]; if (!p) continue;
    const [f, r] = xy(i), c = sideOf(p), king = p === p.toUpperCase();
    const sign = c === 'w' ? 1 : -1;
    if (king) {
      score += sign * 430;
      score += sign * (8 - (Math.abs(f - 3.5) + Math.abs(r - 3.5)) * 2) * 9;
      score += sign * (quietMovesFor(st, i).length + captureMovesFor(st, i).length) * 5;
    } else {
      score += sign * 100;
      score += sign * (c === 'w' ? r : 7 - r) * 13;
      score += sign * (7 - (Math.abs(f - 3.5) + Math.abs(r - 3.5))) * 4;
      if ((c === 'w' && r === 0) || (c === 'b' && r === 7)) score += sign * 6;
      if (f === 0 || f === 7) score += sign * 2;
    }
  }
  const w = materialCount(st, 'w'), b = materialCount(st, 'b');
  score += (w.kings - b.kings) * 34;
  score += (w.total - b.total) * 12;
  return score + (st.side === 'w' ? 1 : -1) * legalMoves(st).length * 4;
}
function aiActions(st) { return legalMoves(st).map(move => ({ type: 'move', move })); }
function applyAIAction(st, a) { return a.type === 'end' ? commitCaptureEnd(st) : applyMove(st, a.move); }
function actionKey(a) { return a.type === 'end' ? 'end' : `${a.move.from}-${a.move.to}-${a.move.capture == null ? 'x' : a.move.capture}`; }
function orderActions(st, actions, ttBest) {
  return actions.sort((A, B) => {
    const ka = actionKey(A), kb = actionKey(B);
    if (ttBest === ka) return -1;
    if (ttBest === kb) return 1;
    const va = A.type === 'end' ? 18 : (A.move.capture != null ? 500 : 0) + ((st.board[A.move.from] || '').toUpperCase() === (st.board[A.move.from] || '') ? 30 : 0);
    const vb = B.type === 'end' ? 18 : (B.move.capture != null ? 500 : 0) + ((st.board[B.move.from] || '').toUpperCase() === (st.board[B.move.from] || '') ? 30 : 0);
    return vb - va;
  });
}
function createAI(level) {
  const cfg = BOT_LEVELS[level] || BOT_LEVELS[2];
  const tt = new Map(), nodes = { n: 0 };
  function minimax(x, d, alpha, beta, root, deadline) {
    nodes.n++; if ((nodes.n & 2047) === 0 && Date.now() > deadline) throw new Error('AI_TIMEOUT');
    const winner = gameStatus(x); if (winner) return winner === root ? 10000000 + d : -10000000 - d;
    if (d <= 0) return (root === 'w' ? 1 : -1) * positionEval(x);
    const key = pos(x) + '|' + d + '|' + (x.captureFrom == null ? '' : 'c' + x.captureFrom), hit = tt.get(key);
    if (hit && hit.depth >= d) return hit.value;
    let best = -Infinity; const actions = orderActions(x, aiActions(x), hit?.best);
    for (const a of actions) { const v = minimax(applyAIAction(x, a), d - 1, alpha, beta, root, deadline); if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break; }
    tt.set(key, { depth: d, value: best, best: actions.length ? actionKey(actions[0]) : null });
    if (tt.size > 60000) tt.delete(tt.keys().next().value); return best;
  }
  return {
    choose(st) {
      const actions = aiActions(st); if (!actions.length) return null;
      if (cfg.random) { const captures = actions.filter(a => a.type === 'move' && a.move.capture != null), pool = captures.length && Math.random() < cfg.captureBias ? captures : actions; return pool[Math.floor(Math.random() * pool.length)]; }
      const deadline = Date.now() + cfg.timeMs; let best = actions[0], bestScore = -Infinity;
      for (let d = 1; d <= cfg.depth; d++) {
        try {
          let localBest = best, localScore = -Infinity;
          for (const a of orderActions(st, actions.slice(), null)) {
            const v = minimax(applyAIAction(st, a), d - 1, -Infinity, Infinity, st.side, deadline);
            if (v > localScore) { localScore = v; localBest = a; }
          }
          best = localBest; bestScore = localScore;
          if (Math.abs(bestScore) >= 9000000) break;
        } catch (e) { if (e.message !== 'AI_TIMEOUT') throw e; break; }
      }
      return best;
    }
  };
}

const BOT_LEVELS = {
  1: { name: 'Безразрядник', style: 'Интуитивный новичок', depth: 1, timeMs: 25, random: true, captureBias: .62 },
  2: { name: '1-й разряд', style: 'Тактический', depth: 5, timeMs: 140, random: false },
  3: { name: 'Гроссмейстер', style: 'Позиционно-тактический', depth: 8, timeMs: 380, random: false }
};

const aiCache = new Map();
function chooseBotAction(st, level) { let ai = aiCache.get(level); if (!ai) { ai = createAI(level); aiCache.set(level, ai); } return ai.choose(st); }
function chooseBotMove(st, level) { const a = chooseBotAction(st, level); return a?.type === 'move' ? a.move : null; }
function advanceBot(g, st) {
  const rec = []; let n = st, result = gameStatus(n), guard = 0;
  while (!result && n.side === 'b' && guard++ < 80) {
    const a = chooseBotAction(n, g.level); if (!a) break;
    const before = n; n = applyAIAction(n, a); if (a.type === 'move') rec.push(moveRecord(a.move, before));
    result = gameStatus(n); if (n.side !== 'b') break;
  }
  return { st: n, rec, result };
}

// ============================================================================
// VIP HINT ENGINE — CHAMPION LEVEL
// ============================================================================
const hintCache = new Map();
function coordName(s) { return String.fromCharCode(97 + s % 8) + (8 - Math.floor(s / 8)); }

const VIP_HINT_CFG = {
  depth: 20,
  timeMs: 1500,
  aspiration: 80,
  maxTT: 400000,
  endgameExact: 6
};

function vipEval(st) {
  let score = positionEval(st);
  const w = materialCount(st, 'w'), b = materialCount(st, 'b');

  const savedSide = st.side;
  let wMob = 0, bMob = 0;
  for (const s of ['w', 'b']) {
    st.side = s;
    let moves = allCaptures(st);
    if (!moves.length) { moves = []; for (let i = 0; i < 64; i++) if (sideOf(st.board[i]) === s) moves.push(...quietMovesFor(st, i)); }
    if (s === 'w') wMob = moves.length; else bMob = moves.length;
  }
  st.side = savedSide;
  score += (wMob - bMob) * 6;

  const capsW = (() => { const sv = st.side; st.side = 'w'; const n = allCaptures(st).length; st.side = sv; return n; })();
  const capsB = (() => { const sv = st.side; st.side = 'b'; const n = allCaptures(st).length; st.side = sv; return n; })();
  score += (capsW - capsB) * 40;

  if (w.kings === 0 && b.kings > 0) score -= 180 * b.kings;
  if (b.kings === 0 && w.kings > 0) score += 180 * w.kings;

  for (let i = 0; i < 64; i++) {
    const p = st.board[i]; if (!p || p === p.toUpperCase()) continue;
    const [, r] = xy(i);
    if (p === 'w' && r === 6) score += 45;
    if (p === 'b' && r === 1) score -= 45;
  }
  for (let i = 0; i < 64; i++) {
    const p = st.board[i]; if (!p || p !== p.toUpperCase()) continue;
    const [f, r] = xy(i);
    if (f === r) score += (sideOf(p) === 'w' ? 1 : -1) * 55;
  }
  for (let i = 0; i < 64; i++) {
    const p = st.board[i]; if (!p || p === p.toUpperCase()) continue;
    const [f] = xy(i);
    if (f === 0 || f === 7) score += (sideOf(p) === 'w' ? -1 : 1) * 10;
  }
  return score;
}

function makeVipSearcher(st, deadline, tt) {
  const killers = new Map();
  const history = new Map();
  let nodes = 0;
  let aborted = false;

  function moveKey(a) {
    return a.type === 'end' ? 'end' : `${a.move.from}-${a.move.to}-${a.move.capture ?? 'x'}`;
  }
  function order(x, actions, ply, ttBest) {
    const list = actions.slice();
    list.sort((A, B) => {
      const ka = moveKey(A), kb = moveKey(B);
      if (ttBest === ka) return -1;
      if (ttBest === kb) return 1;
      const capA = A.type === 'move' && A.move.capture != null;
      const capB = B.type === 'move' && B.move.capture != null;
      if (capA !== capB) return capB - capA;
      const kA = killers.get(ply) || [], kB = killers.get(ply) || [];
      const killA = kA.includes(ka) ? 1 : 0, killB = kB.includes(kb) ? 1 : 0;
      if (killA !== killB) return killB - killA;
      return (history.get(kb) || 0) - (history.get(ka) || 0);
    });
    return list;
  }
  function search(x, d, alpha, beta, ply, root) {
    if (aborted) throw new Error('HINT_TIMEOUT');
    if ((++nodes & 1023) === 0 && Date.now() > deadline) { aborted = true; throw new Error('HINT_TIMEOUT'); }
    const winner = gameStatus(x);
    if (winner) return winner === root ? 10000000 + d : -10000000 - d;
    if (d <= 0) return (root === 'w' ? 1 : -1) * vipEval(x);
    const key = pos(x) + '|' + d + '|' + (x.captureFrom ?? '') + '|' + x.side;
    const hit = tt.get(key);
    if (hit && hit.depth >= d && hit.flag !== 'EXACT') {
      if (hit.flag === 'LOWER' && hit.value >= beta) return hit.value;
      if (hit.flag === 'UPPER' && hit.value <= alpha) return hit.value;
    }
    const actions = order(x, aiActions(x), ply, hit?.best);
    let best = -Infinity, bestKey = null, flag = 'UPPER';
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const next = applyAIAction(x, a);
      let v;
      if (i === 0) v = -search(next, d - 1, -beta, -alpha, ply + 1, root);
      else {
        v = -search(next, d - 1, -alpha - 1, -alpha, ply + 1, root);
        if (v > alpha && v < beta) v = -search(next, d - 1, -beta, -alpha, ply + 1, root);
      }
      if (v > best) { best = v; bestKey = moveKey(a); }
      if (best > alpha) { alpha = best; flag = 'EXACT'; }
      if (alpha >= beta) {
        flag = 'LOWER';
        if (a.type === 'move' && a.move.capture == null) {
          const k = killers.get(ply) || [];
          k.unshift(moveKey(a));
          killers.set(ply, k.slice(0, 2));
          history.set(moveKey(a), (history.get(moveKey(a)) || 0) + d * d);
        }
        break;
      }
    }
    tt.set(key, { depth: d, value: best, flag, best: bestKey });
    if (tt.size > VIP_HINT_CFG.maxTT) { const it = tt.keys(); tt.delete(it.next().value); }
    return best;
  }
  return { search, getNodes: () => nodes };
}

function endgameSolve(st, deadline, maxDepth) {
  const tt = new Map();
  let nodes = 0, aborted = false;
  function solve(x, d) {
    if (aborted) throw new Error('HINT_TIMEOUT');
    if ((++nodes & 511) === 0 && Date.now() > deadline) { aborted = true; throw new Error('HINT_TIMEOUT'); }
    const winner = gameStatus(x);
    if (winner) return winner === st.side ? 10000000 - d : -10000000 + d;
    if (d <= 0) return 0;
    const key = pos(x) + '|' + d;
    if (tt.has(key)) return tt.get(key);
    let best = -Infinity;
    for (const a of aiActions(x)) {
      const v = -solve(applyAIAction(x, a), d - 1);
      if (v > best) best = v;
      if (best >= 9000000) break;
    }
    tt.set(key, best);
    return best;
  }
  return solve(st, maxDepth);
}

function isBlunder(st, action) {
  if (action.type === 'end') return false;
  const after = applyAIAction(st, action);
  if (gameStatus(after)) return false;
  const replies = allCaptures(after);
  if (!replies.length) return false;
  let worst = 0;
  for (const r of replies) {
    const afterReply = applyMove(after, r);
    const mat = materialCount(afterReply, st.side).total;
    const my = materialCount(after, st.side).total;
    worst = Math.max(worst, my - mat);
  }
  return worst >= 2;
}

function vipChoose(st) {
  const actions = aiActions(st);
  if (!actions.length) return null;
  const deadline = Date.now() + VIP_HINT_CFG.timeMs;
  const tt = new Map();
  const searcher = makeVipSearcher(st, deadline, tt);

  const pieces = st.board.filter(Boolean).length;
  if (pieces <= VIP_HINT_CFG.endgameExact) {
    try {
      const exactDepth = Math.min(30, pieces * 3 + 6);
      for (const a of actions) {
        const v = -endgameSolve(applyAIAction(st, a), deadline, exactDepth - 1);
        if (v >= 9000000) return { action: a, score: v, exact: true, nodes: 0 };
      }
    } catch (e) { if (e.message !== 'HINT_TIMEOUT') throw e; }
  }

  let best = actions[0], bestScore = -Infinity, lastCompleted = 0;
  for (let d = 2; d <= VIP_HINT_CFG.depth; d++) {
    try {
      const ordered = actions.slice().sort((A, B) => {
        const ka = A.type === 'end' ? 'end' : `${A.move.from}-${A.move.to}`;
        const kb = B.type === 'end' ? 'end' : `${B.move.from}-${B.move.to}`;
        const pk = best.type === 'end' ? 'end' : `${best.move.from}-${best.move.to}`;
        if (ka === pk) return -1; if (kb === pk) return 1;
        const ca = A.type === 'move' && A.move.capture != null ? 1 : 0;
        const cb = B.type === 'move' && B.move.capture != null ? 1 : 0;
        return cb - ca;
      });
      let localBest = ordered[0], localScore = -Infinity;
      let alpha = -Infinity, beta = Infinity;
      if (d >= 4 && bestScore > -Infinity) { alpha = bestScore - VIP_HINT_CFG.aspiration; beta = bestScore + VIP_HINT_CFG.aspiration; }
      for (const a of ordered) {
        const next = applyAIAction(st, a);
        let v = -searcher.search(next, d - 1, -beta, -alpha, 1, st.side);
        if (v > alpha) v = -searcher.search(next, d - 1, -Infinity, -alpha, 1, st.side);
        if (v > localScore) { localScore = v; localBest = a; }
        if (localScore > alpha) alpha = localScore;
      }
      best = localBest; bestScore = localScore; lastCompleted = d;
      if (Math.abs(bestScore) >= 9000000) break;
    } catch (e) { if (e.message !== 'HINT_TIMEOUT') throw e; break; }
  }
  return { action: best, score: bestScore, depth: lastCompleted, nodes: searcher.getNodes() };
}

function chooseHint(st) {
  const key = pos(st) + (st.captureFrom != null ? '|c' + st.captureFrom : '');
  const hit = hintCache.get(key);
  if (hit) return hit;
  const chosen = vipChoose(st);
  if (!chosen || !chosen.action) return null;
  const a = chosen.action;

  if (a.type === 'end') {
    const r = {
      from: null, to: null, fromName: '—', toName: '—',
      move: { type: 'end-capture', side: st.side },
      reason: 'Продолжение серии сейчас невыгодно — лучше закончить.',
      threat: 'Позиция сохраняется выигрышной.',
      score: chosen.score, confidence: 'СТОП-СЕРИЯ',
      depth: chosen.depth, nodes: chosen.nodes
    };
    hintCache.set(key, r);
    if (hintCache.size > 512) hintCache.delete(hintCache.keys().next().value);
    return r;
  }
  const m = a.move;
  const fromName = coordName(m.from), toName = coordName(m.to);
  const piece = st.board[m.from] || '';
  const isKing = piece === piece.toUpperCase();
  const pieceName = isKing ? 'Дамка' : 'Шашка';
  const sideName = st.side === 'w' ? 'белых' : 'чёрных';
  const scoreAbs = Math.abs(chosen.score);
  let confidence, reason, threat;

  if (chosen.exact && scoreAbs >= 9000000) {
    confidence = 'МАТ';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: точная форсированная победа (решатель эндшпиля).`;
    threat = 'Соперник не имеет защиты — победа гарантирована.';
  } else if (scoreAbs >= 9000000) {
    confidence = 'МАТ';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: форсированный выигрыш.`;
    threat = 'Защиты нет.';
  } else if (scoreAbs > 1500) {
    confidence = 'ПОБЕДА';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: выигрывает решающий материал.`;
    threat = 'Соперник теряет ключевые фигуры.';
  } else if (scoreAbs > 600) {
    confidence = 'ПЕРЕВЕС';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: устойчивый перевес.`;
    threat = 'Инициатива на нашей стороне.';
  } else if (m.capture != null) {
    confidence = 'ВЗЯТИЕ';
    const more = captureMovesFor(applyMove(st, m), m.to);
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: взятие фигуры.`;
    threat = more.length ? 'Доступно продолжение серии — можно взять ещё.' : 'Серия завершается.';
  } else if (isBlunder(st, a)) {
    confidence = 'РИСК';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: лучший из доступных.`;
    threat = 'Позиция сложная, но других сильных ходов нет.';
  } else {
    confidence = 'ТОЧНО';
    reason = `${pieceName} ${sideName} ${fromName} → ${toName}: чемпионский ход.`;
    threat = 'Ограничивает соперника и сохраняет инициативу.';
  }

  const r = {
    from: m.from, to: m.to, fromName, toName,
    move: moveRecord(m, st),
    reason, threat, score: chosen.score, confidence,
    depth: chosen.depth || VIP_HINT_CFG.depth,
    nodes: chosen.nodes || 0, exact: !!chosen.exact
  };
  hintCache.set(key, r);
  if (hintCache.size > 512) hintCache.delete(hintCache.keys().next().value);
  return r;
}

// ============================================================================
// Rooms / bot games / settle
// ============================================================================
function createRoom(stake) {
  let id;
  do { id = String(crypto.randomInt(1000, 10000)); } while (rooms.has(id));
  return rooms.set(id, { id, status: 'waiting', players: {}, createdAt: now(), lastActivity: now(), pos: START_POS, turn: 'w', captureFrom: null, result: null, winner: null, drawReason: null, drawOffer: null, lastMove: null, moves: [], chat: [], stake, bank: 0, revision: 0, paid: false, rematchOffers: {}, rematchRoomId: null }).get(id);
}
async function createRematchRoom(oldRoom) {
  const ps = Object.values(oldRoom.players);
  if (ps.length !== 2) return null;
  const stake = Math.floor(oldRoom.stake || 0);
  const users = [];
  for (const p of ps) {
    const u = await getUser(p.accountId);
    if (!u || u.banned || u.chips < stake) return null;
    users.push(u);
  }
  for (const u of users) { u.chips -= stake; u.updatedAt = now(); await u.save(); }
  const r = createRoom(stake);
  r.status = 'playing'; r.bank = stake * 2; r.rematchOf = oldRoom.id;
  for (const p of ps) {
    const id = uid();
    const u = await getUser(p.accountId);
    r.players[id] = { uid: id, name: u.name, side: p.side, lastSeen: now(), accountId: p.accountId };
  }
  r.lastActivity = now();
  oldRoom.rematchRoomId = r.id; oldRoom.rematchReady = true; oldRoom.revision++;
  return r;
}
function roomState(room) { const st = parsePos(room.pos); st.captureFrom = room.captureFrom; return st; }
function saveRoomState(room, st) { room.pos = pos(st); room.turn = st.side; room.captureFrom = st.captureFrom; }
function sanitizeRoom(room, pid) {
  return {
    id: room.id, status: room.status, turn: room.turn, captureFrom: room.captureFrom,
    players: Object.values(room.players).map(p => ({ uid: p.uid, name: p.name, side: p.side, online: now() - p.lastSeen < PLAYER_TIMEOUT, disconnectDeadline: p.disconnectDeadline || null })),
    position: room.pos, result: room.result, winner: room.winner, drawReason: room.drawReason, drawOffer: room.drawOffer, lastMove: room.lastMove, moves: room.moves || [], revision: room.revision, chat: room.chat.slice(-30), stake: room.stake, bank: room.bank, selfSide: room.players[pid]?.side || null, rematchOffered: !!room.rematchOffers?.[room.players[pid]?.accountId], rematchReady: !!room.rematchRoomId, rematchRoomId: room.rematchRoomId || null,
    forfeitReason: room.resignPlayer ? `Игрок «${room.resignPlayer}» сдался` : room.leavePlayer ? `Игрок «${room.leavePlayer}» покинул стол` : room.disconnectPlayer ? `Игрок «${room.disconnectPlayer}» не вернулся в течение 1 минуты` : null
  };
}
async function settleWinner(room) {
  if (room.paid) return; room.paid = true;
  const ps = Object.values(room.players), w = ps.find(p => p.side === room.winner), l = ps.find(p => p.side !== room.winner);
  const wu = w && await getUser(w.accountId), lu = l && await getUser(l.accountId);
  if (wu) { wu.chips += room.bank; wu.wins++; wu.rating += 25; wu.updatedAt = now(); await wu.save(); }
  if (lu) { lu.losses++; lu.rating = Math.max(0, lu.rating - 18); lu.updatedAt = now(); await lu.save(); }
}
async function settleDraw(room) {
  if (room.paid) return; room.paid = true;
  for (const p of Object.values(room.players)) {
    const u = await getUser(p.accountId);
    if (u) { u.chips += Math.floor(room.bank / Math.max(1, Object.keys(room.players).length)); u.draws++; u.rating += 3; u.updatedAt = now(); await u.save(); }
  }
}
async function settleBot(g, result) {
  if (g.settled) return; g.settled = true;
  const u = await getUser(g.userId);
  if (u) {
    if (result === 'win') { u.chips += g.stake * 2; u.wins++; u.rating += 25; }
    else if (result === 'loss') { u.losses++; u.rating = Math.max(0, u.rating - 18); }
    else if (result === 'draw' || result === 'cancelled') { u.chips += g.stake; if (result === 'draw') { u.draws++; u.rating += 3; } }
    u.updatedAt = now(); await u.save();
  }
}
async function checkDisconnect(room) {
  if (room.status !== 'playing' || room.result) return;
  const t = now(), ps = Object.values(room.players);
  for (const p of ps) if (t - p.lastSeen > PLAYER_TIMEOUT && !p.disconnectDeadline) p.disconnectDeadline = p.lastSeen + DISCONNECT_GRACE;
  const gone = ps.find(p => p.disconnectDeadline && t >= p.disconnectDeadline);
  if (!gone) return;
  const opp = ps.find(p => p.uid !== gone.uid);
  if (opp) { room.winner = opp.side; room.result = opp.side === 'w' ? '1-0' : '0-1'; room.status = 'finished'; room.disconnectPlayer = gone.name; await settleWinner(room); }
  else { room.status = 'finished'; room.result = 'cancelled'; await settleDraw(room); }
  room.revision++;
}
async function cancelUserGames(userId, reason = 'Администратор завершил партию') {
  for (const room of rooms.values()) {
    const has = Object.values(room.players).some(p => p.accountId === userId);
    if (!has || room.result) continue;
    room.status = 'finished'; room.result = 'cancelled'; room.drawReason = reason; room.drawOffer = null; room.paid = true;
    const count = Math.max(1, Object.keys(room.players).length);
    for (const p of Object.values(room.players)) { const u = await getUser(p.accountId); if (u) { u.chips += Math.floor(room.bank / count); await u.save(); } }
    room.revision++;
  }
  for (const g of botGames.values()) {
    if (g.userId === userId && !g.settled) { g.status = 'finished'; g.result = 'cancelled'; g.settled = true; const u = await getUser(g.userId); if (u) { u.chips += g.stake; await u.save(); } }
  }
}
async function adminStats() {
  const totalPlayers = await UserModel.countDocuments();
  const bannedPlayers = await UserModel.countDocuments({ banned: true });
  const vipPlayers = await UserModel.countDocuments({ vip: true });
  const agg = await UserModel.aggregate([{ $group: { _id: null, total: { $sum: '$chips' } } }]);
  const totalChipsVal = agg && agg[0] ? agg[0].total : 0;
  return {
    players: totalPlayers, activePlayers: totalPlayers - bannedPlayers, banned: bannedPlayers, vip: vipPlayers, totalChips: totalChipsVal,
    waitingRooms: [...rooms.values()].filter(r => r.status === 'waiting').length,
    playingRooms: [...rooms.values()].filter(r => r.status === 'playing').length,
    botGames: [...botGames.values()].filter(g => g.status === 'playing' && !g.settled).length
  };
}

// ============================================================================
// ROUTER
// ============================================================================
async function route(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`), p = u.pathname;
  if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
  try {

    // ======================== AUTH — автовосстановление из MongoDB ========================
    if (req.method === 'POST' && p === '/api/auth') {
      if (!allowRate(`auth:${clientIp(req)}`, 60, 60000))
        return json(res, 429, { ok: false, error: 'Слишком много запросов.' });

      const b = await readBody(req);

      // 1. Постоянный userId от клиента (localStorage)
      const savedUserId = sanitizeId(b.userId || '');
      if (savedUserId) {
        const byId = await UserModel.findOne({ id: savedUserId });
        if (byId) {
          if (byId.banned) return json(res, 403, { ok: false, error: 'Аккаунт заблокирован' });
          const token = crypto.randomBytes(32).toString('hex');
          await persistSession(token, { userId: byId.id, createdAt: now(), lastSeen: now() });
          setCookie(res, 'sani_session', token, SESSION_TTL);
          return json(res, 200, {
            ok: true, user: userView(byId), needsName: false,
            restored: true,
            store: { boards: STORE_BOARDS, pieces: STORE_PIECES }
          });
        }
      }

      // 2. Cookie-сессия
      let user;
      try { user = await currentUser(req, res); } catch {}
      if (user) {
        return json(res, 200, {
          ok: true, user: userView(user), needsName: false,
          store: { boards: STORE_BOARDS, pieces: STORE_PIECES }
        });
      }

      // 3. Никнейм (для нового устройства или нового игрока)
      const incoming = sanitizeName(b.name || '');
      if (!incoming) {
        return json(res, 200, { ok: true, needsName: true });
      }

      // Ищем по текущему нику И по истории ников
      const existing = await UserModel.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${incoming}$`, 'i') } },
          { nameHistory: { $regex: new RegExp(`^${incoming}$`, 'i') } }
        ]
      });

      if (existing) {
        if (existing.banned) return json(res, 403, { ok: false, error: 'Аккаунт заблокирован' });
        const token = crypto.randomBytes(32).toString('hex');
        await persistSession(token, { userId: existing.id, createdAt: now(), lastSeen: now() });
        setCookie(res, 'sani_session', token, SESSION_TTL);
        return json(res, 200, {
          ok: true, user: userView(existing), needsName: false,
          restored: true,
          store: { boards: STORE_BOARDS, pieces: STORE_PIECES }
        });
      }

      try { user = await ensureUser(incoming); }
      catch (e) { return json(res, 400, { ok: false, error: e.message }); }

      const token = crypto.randomBytes(32).toString('hex');
      await persistSession(token, { userId: user.id, createdAt: now(), lastSeen: now() });
      setCookie(res, 'sani_session', token, SESSION_TTL);
      return json(res, 200, {
        ok: true, user: userView(user), needsName: false,
        created: true,
        store: { boards: STORE_BOARDS, pieces: STORE_PIECES }
      });
    }

    if (req.method === 'POST' && p === '/api/logout') {
      const c = parseCookies(req); if (c.sani_session) await dropSession(c.sani_session);
      clearCookie(res, 'sani_session'); return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/state') {
      const user = await currentUser(req, res); return json(res, 200, { ok: true, user: userView(user), store: { boards: STORE_BOARDS, pieces: STORE_PIECES } });
    }

    if (req.method === 'GET' && p === '/api/daily-gift') {
      const user = await currentUser(req, res); return json(res, 200, { ok: true, ...dailyGiftState(user), chips: user.chips });
    }

    if (req.method === 'POST' && p === '/api/daily-gift/claim') {
      if (!allowRate(`daily-gift:${clientIp(req)}`, 10, RATE_WINDOW)) return json(res, 429, { ok: false, error: 'Слишком много запросов' });
      const user = await currentUser(req, res), result = claimDailyGift(user);
      if (!result.ok) return json(res, 409, { ok: false, error: result.error, ...result.state, chips: user.chips });
      await user.save();
      return json(res, 200, { ok: true, ...dailyGiftState(user), reward: result.reward, claimedReward: result.reward, chips: user.chips, user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/profile/name') {
      if (!allowRate(`rename:${clientIp(req)}`, 10, 60000)) return json(res, 429, { ok: false, error: 'Слишком частые запросы' });
      const user = await currentUser(req, res), b = await readBody(req), n = await uniqueName(b.name, user.id);
      if (!n) return json(res, 400, { ok: false, error: 'Никнейм уже занят или некорректен' });
      if (n === user.name) return json(res, 200, { ok: true, user: userView(user) });
      user.name = n;
      if (!Array.isArray(user.nameHistory)) user.nameHistory = [];
      if (!user.nameHistory.includes(n)) user.nameHistory.push(n);
      user.updatedAt = now();
      for (const r of rooms.values()) for (const pl of Object.values(r.players)) if (pl.accountId === user.id) pl.name = n;
      await user.save();
      return json(res, 200, { ok: true, user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/shop/buy') {
      const user = await currentUser(req, res), b = await readBody(req), arr = b.type === 'board' ? STORE_BOARDS : STORE_PIECES, id = String(b.itemId || '');
      const it = arr.find(x => x[0] === id); if (!it) return json(res, 404, { ok: false, error: 'Товар не найден' });
      if (user.chips < it[3]) return json(res, 400, { ok: false, error: 'Недостаточно фишек' });
      user.chips -= it[3]; (b.type === 'board' ? user.inventory.boards : user.inventory.pieces).push(id);
      user.updatedAt = now(); await user.save(); return json(res, 200, { ok: true, user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/shop/select') {
      const user = await currentUser(req, res), b = await readBody(req), id = String(b.itemId || '');
      if (b.type === 'board') user.inventory.selectedBoard = id; else user.inventory.selectedPieces = id;
      user.updatedAt = now(); await user.save(); return json(res, 200, { ok: true, user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/admin/login') {
      if (!ADMIN_PASSWORD) return json(res, 503, { ok: false, error: 'Пароль не настроен в окружении' });
      const b = await readBody(req); if (!sameSecret(b.password, ADMIN_PASSWORD)) return json(res, 401, { ok: false });
      const t = crypto.randomBytes(32).toString('hex'); adminSessions.set(t, { createdAt: now() });
      setCookie(res, 'sani_admin', t, ADMIN_SESSION_TTL); return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/admin/action') {
      requireAdmin(req, res); const b = await readBody(req);
      if (b.action === 'clear_database') {
        rooms.clear(); botGames.clear();
        await UserModel.deleteMany({}); await SessionModel.deleteMany({});
        return json(res, 200, { ok: true });
      }
      const user = await getUser(b.userId); if (!user) return json(res, 404, { ok: false, error: 'Игрок не найден' });
      if (b.action === 'chips') user.chips = Math.max(0, user.chips + Number(b.amount));
      else if (b.action === 'set_chips') user.chips = Math.floor(Number(b.amount));
      else if (b.action === 'vip') user.vip = !!b.value;
      else if (b.action === 'ban') {
        user.banned = !!b.value;
        if (user.banned) { await SessionModel.deleteMany({ userId: user.id }); await cancelUserGames(user.id, 'Бан'); }
      }
      user.updatedAt = now(); await user.save();
      return json(res, 200, { ok: true, user: userView(user), stats: await adminStats() });
    }

    if (req.method === 'GET' && p === '/api/admin/players') {
      requireAdmin(req, res);
      const q = sanitizeName(u.searchParams.get('q') || '').toLowerCase();
      let dbUsers = await UserModel.find({});
      if (q) dbUsers = dbUsers.filter(x => x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
      return json(res, 200, { ok: true, stats: await adminStats(), players: dbUsers.map(userView) });
    }

    if (req.method === 'GET' && p === '/api/leaderboard') {
      const list = await UserModel.find({ banned: false }).sort({ wins: -1, rating: -1 }).limit(50);
      return json(res, 200, { ok: true, players: list.map(u => ({ name: u.name, chips: u.chips, vip: u.vip, wins: u.wins, losses: u.losses, draws: u.draws, rating: u.rating })) });
    }

    if (req.method === 'POST' && p === '/api/bot/start') {
      const user = await currentUser(req, res), b = await readBody(req), stake = Math.max(0, Math.floor(Number(b.stake) || 0)), level = Math.min(3, Math.max(1, Math.floor(Number(b.level) || 2)));
      if (stake > user.chips) return json(res, 400, { ok: false, error: 'Недостаточно фишек' });
      user.chips -= stake; await user.save();
      const id = uid(); botGames.set(id, { id, userId: user.id, stake, level, createdAt: now(), lastActivity: now(), settled: false, status: 'playing', position: START_POS, turn: 'w', captureFrom: null, lastMove: null, moves: [] });
      return json(res, 200, { ok: true, gameId: id, level, stake, user: userView(user), position: START_POS, captureFrom: null, result: null });
    }

    if (req.method === 'POST' && p === '/api/bot/move') {
      const user = await currentUser(req, res), b = await readBody(req), g = botGames.get(String(b.gameId || ''));
      if (!g || g.status !== 'playing') return json(res, 400, { ok: false, error: 'Партия завершена' });
      const st = parsePos(g.position); st.captureFrom = g.captureFrom;
      const mv = parseMove(st, Number(b.from), Number(b.to)); if (!mv) return json(res, 400, { ok: false, error: 'Недопустимый ход' });
      let n = applyMove(st, mv); const rec = [moveRecord(mv, st)]; let result = gameStatus(n);
      if (!result && n.side === 'b') { const adv = advanceBot(g, n); n = adv.st; rec.push(...adv.rec); result = adv.result; }
      g.position = pos(n); g.turn = n.side; g.captureFrom = n.captureFrom; g.lastMove = rec[rec.length - 1]; g.moves = (g.moves || []).concat(rec).slice(-500); g.lastActivity = now();
      if (result) { g.status = 'finished'; g.result = result === 'w' ? 'win' : 'loss'; await settleBot(g, g.result); }
      const refreshedUser = await getUser(user.id);
      return json(res, 200, { ok: true, position: g.position, captureFrom: g.captureFrom, result: g.result || null, moves: rec, user: userView(refreshedUser) });
    }

    if (req.method === 'GET' && p === '/api/bot/state') {
      const user = await currentUser(req, res), g = botGames.get(String(u.searchParams.get('gameId') || ''));
      if (!g || g.userId !== user.id) return json(res, 404, { ok: false, error: 'Партия бота не найдена' });
      return json(res, 200, { ok: true, gameId: g.id, level: g.level, levelName: (BOT_LEVELS[g.level] || BOT_LEVELS[2]).name, stake: g.stake, position: g.position, captureFrom: g.captureFrom, result: g.result || null, status: g.status, moves: g.moves || [], user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/bot/resign') {
      const user = await currentUser(req, res), b = await readBody(req), g = botGames.get(String(b.gameId || ''));
      if (!g || g.userId !== user.id || g.status !== 'playing') return json(res, 400, { ok: false, error: 'Партия недоступна' });
      g.status = 'finished'; g.result = 'loss'; await settleBot(g, 'loss');
      const refreshedUser = await getUser(user.id);
      return json(res, 200, { ok: true, result: 'loss', user: userView(refreshedUser) });
    }

    if (req.method === 'POST' && p === '/api/hint') {
      const user = await currentUser(req, res); if (!user.vip) return json(res, 403, { ok: false, error: 'Доступно только VIP' });
      const b = await readBody(req), st = parsePos(String(b.position || START_POS));
      st.captureFrom = b.captureFrom == null ? null : Number(b.captureFrom);
      const h = chooseHint(st);
      return json(res, 200, { ok: true, available: !!h, ...(h || {}) });
    }

    if (req.method === 'POST' && p === '/api/room/create') {
      const user = await currentUser(req, res), b = await readBody(req), stake = Math.max(0, Math.floor(Number(b.stake) || 0));
      if (user.chips < stake) return json(res, 400, { ok: false, error: 'Недостаточно фишек' });
      user.chips -= stake; await user.save();
      const room = createRoom(stake), id = uid();
      room.players[id] = { uid: id, name: user.name, side: 'w', lastSeen: now(), accountId: user.id }; room.bank = stake;
      return json(res, 200, { ok: true, uid: id, room: sanitizeRoom(room, id), self: 'w', user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/room/join') {
      const user = await currentUser(req, res), b = await readBody(req), room = rooms.get(String(b.roomId || '').toUpperCase());
      if (!room || room.status !== 'waiting') return json(res, 400, { ok: false, error: 'Комната недоступна' });
      if (user.chips < room.stake) return json(res, 400, { ok: false, error: 'Недостаточно фишек' });
      user.chips -= room.stake; await user.save();
      const id = uid(); room.players[id] = { uid: id, name: user.name, side: 'b', lastSeen: now(), accountId: user.id };
      room.bank += room.stake; room.status = 'playing'; room.lastActivity = now();
      return json(res, 200, { ok: true, uid: id, room: sanitizeRoom(room, id), self: 'b', user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/room/rematch') {
      const user = await currentUser(req, res), b = await readBody(req), room = rooms.get(String(b.roomId || '').toUpperCase());
      if (!room) return json(res, 404, { ok: false, error: 'Комната не найдена' });
      room.rematchOffers[user.id] = true; room.lastActivity = now();
      if (room.rematchRoomId) {
        const nr = rooms.get(room.rematchRoomId), np = Object.values(nr?.players || {}).find(x => x.accountId === user.id);
        if (nr && np) return json(res, 200, { ok: true, ready: true, room: sanitizeRoom(nr, np.uid), uid: np.uid, self: np.side, user: userView(user) });
      }
      if (Object.keys(room.rematchOffers).length === 2) {
        const nr = await createRematchRoom(room);
        const np = Object.values(nr.players).find(x => x.accountId === user.id);
        return json(res, 200, { ok: true, ready: true, room: sanitizeRoom(nr, np.uid), uid: np.uid, self: np.side, user: userView(user) });
      }
      room.revision++; return json(res, 200, { ok: true, ready: false, room: sanitizeRoom(room, Object.values(room.players).find(x=>x.accountId===user.id).uid), user: userView(user) });
    }

    if (req.method === 'POST' && p === '/api/room/rematch-connect') {
      const user = await currentUser(req, res), b = await readBody(req), old = rooms.get(String(b.roomId || '').toUpperCase());
      const room = rooms.get(old?.rematchRoomId || ''), player = Object.values(room?.players || {}).find(x => x.accountId === user.id);
      if (!room || !player) return json(res, 404, { ok: false });
      player.lastSeen = now(); player.disconnectDeadline = null; room.lastActivity = now();
      return json(res, 200, { ok: true, room: sanitizeRoom(room, player.uid), uid: player.uid, self: player.side, user: userView(user) });
    }
    
    const rm = /^\/api\/room\/(sync|heartbeat|reconnect|move|leave|chat|draw|draw-response|resign)$/.exec(p);
    if (rm) {
      const cmd = rm[1];
      const user = await currentUser(req, res), b = req.method === 'GET' ? Object.fromEntries(u.searchParams.entries()) : await readBody(req), room = rooms.get(String(b.roomId || '').toUpperCase()), player = room?.players?.[b.uid];
      if (!room || !player || player.accountId !== user.id) return json(res, 404, { ok: false, error: 'Сессия не найдена' });
      player.lastSeen = now(); player.disconnectDeadline = null; room.lastActivity = now();
      await checkDisconnect(room);
      if (cmd === 'sync' || cmd === 'heartbeat' || cmd === 'reconnect') return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid), self: player.side });
      if (cmd === 'chat') { const text = sanitizeName(b.text).slice(0, 160); if (text) { room.chat.push({ uid: user.id, name: user.name, text, ts: now() }); room.revision++; } return json(res, 200, { ok: true }); }
      if (cmd === 'draw') { room.drawOffer = player.side; room.revision++; return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid) }); }
      if (cmd === 'draw-response') { if (b.accept) { room.status = 'finished'; room.result = '1/2-1/2'; room.drawOffer = null; await settleDraw(room); } else room.drawOffer = null; room.revision++; return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid) }); }
      if (cmd === 'resign') { const opp = Object.values(room.players).find(p => p.uid !== player.uid); if (opp) { room.winner = opp.side; room.result = opp.side === 'w' ? '1-0' : '0-1'; room.status = 'finished'; room.resignPlayer = player.name; await settleWinner(room); } room.revision++; return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid) }); }
      if (cmd === 'leave') { if (room.status === 'waiting') { room.status = 'finished'; room.result = 'cancelled'; await settleDraw(room); } else if (!room.result) { const opp = Object.values(room.players).find(p => p.uid !== player.uid); if (opp) { room.winner = opp.side; room.result = opp.side === 'w' ? '1-0' : '0-1'; room.status = 'finished'; room.leavePlayer = player.name; await settleWinner(room); } } room.revision++; return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid) }); }
      if (cmd === 'move') { if (room.status !== 'playing' || room.turn !== player.side) return json(res, 400, { ok: false }); const st = roomState(room), mv = parseMove(st, Number(b.from), Number(b.to)); if (!mv) return json(res, 400, { ok: false }); const n = applyMove(st, mv); saveRoomState(room, n); room.lastMove = moveRecord(mv, st); room.moves.push(room.lastMove); room.revision++; const result = gameStatus(n); if (result) { room.status = 'finished'; room.result = result === 'w' ? '1-0' : '0-1'; room.winner = result; await settleWinner(room); } const refreshedUser = await getUser(user.id); return json(res, 200, { ok: true, room: sanitizeRoom(room, b.uid), user: userView(refreshedUser) }); }
    }
  } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message || 'Ошибка сервера' }); }
  if (req.method === 'GET') {
    let fp = path.normalize(path.join(ROOT, p === '/' ? '/index.html' : p));
    if (fp !== ROOT && !fp.startsWith(ROOT + path.sep) || !fs.existsSync(fp)) return json(res, 404, { error: 'not found' });
    const ext = path.extname(fp), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res); return;
  }
  return json(res, 404, { error: 'not found' });
}

if (require.main === module) {
  setInterval(async () => {
    await cleanupTransient();
    for (const r of rooms.values()) {
      await checkDisconnect(r);
      if (r.status === 'waiting' && now() - r.createdAt > ROOM_TTL) { r.status = 'finished'; r.result = 'cancelled'; await settleDraw(r); }
      if (r.status === 'playing' && now() - r.lastActivity > ROOM_TTL) { r.status = 'finished'; r.result = 'cancelled'; await settleDraw(r); }
    }
    for (const g of botGames.values()) if (!g.settled && now() - g.lastActivity > ROOM_TTL) { g.status = 'finished'; g.result = 'cancelled'; await settleBot(g, 'cancelled'); }
  }, 5000);
  http.createServer(route).listen(PORT, '0.0.0.0', () => console.log(`SANI CHECKERS Cloud Server active on port: ${PORT}`));
}

module.exports = { parsePos, pos, legalMoves, allCaptures, applyMove, gameStatus, START_POS, chooseBotMove, chooseBotAction, BOT_LEVELS, positionEval, aiActions, applyAIAction, DAILY_GIFT_AMOUNTS, serverDateKey, dailyGiftState, claimDailyGift, chooseHint };