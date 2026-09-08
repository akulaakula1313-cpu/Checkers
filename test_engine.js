const assert=require('assert');const e=require('./server');
function st(p=e.START_POS){const s=e.parsePos(p);return s}
let s=st();
const startPieces=s.board.filter(Boolean);
assert.equal(startPieces.length,24);
assert.equal(startPieces.filter(p=>p.toLowerCase()==='w').length,12);
assert.equal(startPieces.filter(p=>p.toLowerCase()==='b').length,12);
assert.equal(startPieces.filter(p=>p==='W'||p==='B').length,0);
assert.equal(e.legalMoves(s).length,7);
console.log('start position: 12 white + 12 black, moves',e.legalMoves(s).length);
// mandatory capture + backward capture for a man
s=st('8/8/8/3b4/4w3/8/8/8 w');let ms=e.legalMoves(s);assert(ms.some(m=>m.from===28&&m.to===42));assert.equal(ms.length,1);
// king/damka long move and long capture
s=st('8/5b2/8/5b2/4W3/8/8/8 w');ms=e.legalMoves(s);assert(ms.some(m=>m.from===28&&m.to===46));
// continuation is kept on same side
let m=ms.find(m=>m.capture!=null);let n=e.applyMove(s,m);assert.equal(n.side,'w');assert.equal(n.captureFrom,m.to);
// voluntary stop switches side
n=e.commitCaptureEnd(n);assert.equal(n.side,'b');assert.equal(n.captureFrom,null);
// promotion
s=st('8/5w2/8/8/8/8/8/8 w');ms=e.legalMoves(s);n=e.applyMove(s,ms[0]);assert.equal(n.board[ms[0].to],'W');
// no moves => opponent wins
s=st('8/8/8/8/8/8/8/7w b');assert.equal(e.gameStatus(s),'w');
console.log('ENGINE TESTS PASS');
// AI action model must expose voluntary end-of-capture as a legal bot decision.
s=st('8/8/8/8/4W3/1b1b4/8/8 w');
ms=e.legalMoves(s); let cap=ms.find(m=>m.capture!=null&&m.to===10); assert(cap);
n=e.applyMove(s,cap); assert(n.captureFrom!=null); assert(e.aiActions(n).some(a=>a.type==='end')); assert(e.aiActions(n).some(a=>a.type==='move'));
for(const level of [1,2,3]){assert(e.BOT_LEVELS[level].name);assert(e.chooseBotAction(st(),level));}
console.log('AI LEVEL TESTS PASS');
// Quiet move must always pass the turn, even if it opens a capture for another own piece.
s=st('8/8/8/5w2/2b5/8/8/8 w');
let quiet=e.legalMoves(s).find(x=>x.from===37&&x.to===44);
assert(quiet && quiet.capture==null);
n=e.applyMove(s,quiet);
assert.equal(n.side,'b');
assert.equal(n.captureFrom,null);
console.log('QUIET-MOVE-TURN-PASS TEST PASS');
// Black ordinary man must NOT move or capture like a king.
s=st('8/1b6/8/8/8/8/8/8 b');
ms=e.legalMoves(s);
assert(ms.length===2);
assert(ms.every(x=>x.capture==null));
assert(ms.some(x=>x.to===40)&&ms.some(x=>x.to===42));
assert(!ms.some(x=>x.to===35)); // no long quiet move

s=st('8/1b6/2w5/8/8/8/8/8 b');
ms=e.legalMoves(s);
assert(ms.some(x=>x.from===49&&x.to===35&&x.capture===42));
assert(!ms.some(x=>x.to===28||x.to===21)); // no long capture landing

s=st('8/8/2w5/1b6/8/8/8/8 b');
ms=e.legalMoves(s);
assert(ms.some(x=>x.from===33&&x.to===51&&x.capture===42));
assert(!ms.some(x=>x.to===60)); // backward capture is one jump only
console.log('BLACK-MAN-NO-LONG-MOVE-OR-CAPTURE TEST PASS');

// Final rules matrix: construct exact indexed positions to avoid FEN-coordinate ambiguity.
function exact(side, entries){const x=e.parsePos('8/8/8/8/8/8/8/8 '+side);for(const [i,p] of entries)x.board[i]=p;return x}
// Men: one-step quiet moves only.
s=exact('w',[[28,'w']]); ms=e.legalMoves(s); assert.deepEqual(ms.map(m=>m.to).sort((a,b)=>a-b),[35,37]);
s=exact('b',[[35,'b']]); ms=e.legalMoves(s); assert.deepEqual(ms.map(m=>m.to).sort((a,b)=>a-b),[26,28]);
// Man captures forward and backward, exactly one jump.
s=exact('w',[[28,'w'],[37,'b']]); ms=e.legalMoves(s); assert(ms.some(m=>m.from===28&&m.to===46&&m.capture===37));
s=exact('w',[[28,'w'],[19,'b']]); ms=e.legalMoves(s); assert(ms.some(m=>m.from===28&&m.to===10&&m.capture===19));
s=exact('b',[[35,'b'],[44,'w']]); ms=e.legalMoves(s); assert(ms.some(m=>m.from===35&&m.to===53&&m.capture===44));
s=exact('b',[[35,'b'],[26,'w']]); ms=e.legalMoves(s); assert(ms.some(m=>m.from===35&&m.to===17&&m.capture===26));
// Mandatory capture suppresses all quiet moves for every own man.
s=exact('w',[[28,'w'],[37,'b'],[42,'w']]); ms=e.legalMoves(s); assert(ms.every(m=>m.capture!=null)); assert(ms.every(m=>m.from===28));
// King: all clear landing squares after the first enemy are legal; a second enemy blocks the ray.
s=exact('w',[[28,'W'],[37,'b']]); ms=e.legalMoves(s); assert(ms.filter(m=>m.capture===37).map(m=>m.to).sort((a,b)=>a-b).includes(46)); assert(ms.filter(m=>m.capture===37).length>=2);
s=exact('w',[[28,'W'],[37,'b'],[46,'b']]); ms=e.legalMoves(s); assert(!ms.some(m=>m.capture===37&&m.to===55));
// Promotion on a capture creates a king immediately and may continue the capture series.
s=exact('w',[[42,'w'],[51,'b'],[33,'b']]); ms=e.legalMoves(s); const pm=ms.find(m=>m.from===42&&m.to===60&&m.capture===51); assert(pm); n=e.applyMove(s,pm); assert.equal(n.board[60],'W'); assert.equal(n.captureFrom,60); assert(e.legalMoves(n).some(m=>m.capture===33));
// Voluntary end of a capture series switches the side.
s=exact('w',[[28,'W'],[37,'b']]); ms=e.legalMoves(s); const cm=ms.find(m=>m.capture!=null); assert(cm); n=e.applyMove(s,cm); if(n.captureFrom!=null){n=e.commitCaptureEnd(n);assert.equal(n.side,'b');assert.equal(n.captureFrom,null)}
console.log('FINAL-RULES-MATRIX PASS');
