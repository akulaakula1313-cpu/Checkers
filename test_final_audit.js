const assert=require('assert'),fs=require('fs'),vm=require('vm');
const e=require('./server');
// 1) Position parser / serializer invariants.
for(const bad of ['8/8/8/8/8/8/8/7x w','8/8/8/8/8/8/8/7w x']){let ok=false;try{e.parsePos(bad)}catch{ok=true}assert(ok,`parser accepted invalid position: ${bad}`)}
let x=e.parsePos(e.START_POS);x.board[28]='W';x.board[35]='b';assert.equal(e.pos(e.parsePos(e.pos(x))),e.pos(x));
// 2) Client/server legal move parity on deterministic random reachable positions.
const src=fs.readFileSync('client.js','utf8');const start=src.indexOf('function checkersMoves(st)');const end=src.indexOf('\nwindow.checkersMoves=checkersMoves;',start);assert(start>=0&&end>start);
const fnSrc=src.slice(start,end).replace('function checkersMoves','function');const clientMoves=vm.runInNewContext(`(${fnSrc})`,{});
let seed=0x9e3779b9;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/0x100000000};
for(let g=0;g<80;g++){
  x=e.parsePos(e.START_POS);
  for(let ply=0;ply<120;ply++){
    const sm=e.legalMoves(x).map(m=>`${m.from}-${m.to}-${m.capture==null?'x':m.capture}`).sort();
    const cm=clientMoves(x).map(m=>`${m.from}-${m.to}-${m.capture==null?'x':m.capture}`).sort();
    assert.deepEqual(cm,sm,`client/server move mismatch at game ${g} ply ${ply}`);
    if(!sm.length)break;
    const m=e.legalMoves(x)[Math.floor(rnd()*e.legalMoves(x).length)];
    x=e.applyMove(x,m);
    if(x.captureFrom!=null && rnd()<0.35)x=e.commitCaptureEnd(x);
    if(e.gameStatus(x))break;
  }
}
// 3) Rule-specific source assertions for the final UI/engine behavior.
assert(src.includes('const targetCaptures=new Set(selectedMoves.filter(m=>m.capture!=null).map(m=>m.to));'));
assert(src.includes("const canEndSeries=st.captureFrom!=null&&myTurn;"));
assert(src.includes('checkLocalEnd(st);return}try{'));assert(src.includes("sessionStorage.removeItem('saniCheckersRoom');sessionStorage.removeItem('saniCheckersBot');mode='local'"));const html=fs.readFileSync('index.html','utf8');assert(html.includes('client.js?v=2.6.4'));assert(html.includes('id="bgMusic"')&&html.includes(' loop'));
const server=fs.readFileSync('server.js','utf8');assert(server.includes('crypto.randomInt(1000,10000)'));assert(server.includes("join:${clientIp(req)}"));assert(server.includes("bot-start:${clientIp(req)}"));assert(server.includes('Math.min(MAX_STAKE,Math.max(0,Math.floor(user.chips+n)))'));
assert(!/\b(alert|confirm|prompt)\s*\(/.test(src));
assert(fs.readFileSync('server.js','utf8').includes("fp!==ROOT&&!fp.startsWith(ROOT+path.sep)"));
assert(fs.readFileSync('server.js','utf8').includes("const result=gameStatus(n);if(result){room.status='finished'"));
// 4) Capture target visuals: king landing squares are empty but must still be highlighted.
x=e.parsePos(e.START_POS);x.board=Array(64).fill(null);x.side='w';x.captureFrom=null;x.board[28]='W';x.board[37]='b';
const km=clientMoves(x);assert(km.some(m=>m.from===28&&m.to===46&&m.capture===37));assert(km.some(m=>m.from===28&&m.to===55&&m.capture===37));
console.log('FINAL AUDIT PASS: parser, client/server move parity, UI capture targets, series end, security/path boundary');
