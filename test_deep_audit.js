const assert=require('assert'),fs=require('fs'),path=require('path');
const s=require('./server');
// Engine invariants / fuzz
let st=s.parsePos(s.START_POS);
assert.equal(s.legalMoves(st).length,7);
// Client and server must share the exact 12+12 starting position.
const clientStart=(clientSource=>clientSource.match(/const START_POSITION='([^']+)'/)?.[1])(fs.readFileSync('client.js','utf8'));
assert.equal(clientStart,s.START_POS,'client/server starting position mismatch');
const start=s.parsePos(s.START_POS).board.filter(Boolean);
assert.equal(start.length,24);
assert.equal(start.filter(p=>p.toLowerCase()==='w').length,12);
assert.equal(start.filter(p=>p.toLowerCase()==='b').length,12);
for(let game=0;game<120;game++){
  st=s.parsePos(s.START_POS);
  for(let ply=0;ply<220;ply++){
    const moves=s.legalMoves(st); assert(Array.isArray(moves));
    if(!moves.length) break;
    const m=moves[(game*37+ply*13)%moves.length];
    st=s.applyMove(st,m);
    if(st.captureFrom!=null && ply%3===0 && s.legalMoves(st).length){
      st=s.commitCaptureEnd(st);
    }
    const text=s.pos(st); const back=s.parsePos(text); assert.equal(s.pos(back),text);
    if(s.gameStatus(st)) break;
  }
}
// AI all levels must always return an engine-valid action and finish within a sane bound
for(const level of [1,2,3]){
  let x=s.parsePos(s.START_POS);
  for(let i=0;i<18;i++){
    const a=s.chooseBotAction(x,level); if(!a)break;
    assert(a.type==='end'||a.type==='move');
    if(a.type==='end') x=s.applyAIAction(x,a);
    else {assert(s.legalMoves(x).some(m=>m.from===a.move.from&&m.to===a.move.to)); x=s.applyAIAction(x,a)}
    if(s.gameStatus(x))break;
  }
}
// Static consistency: every client ID selector must exist in HTML.
const html=fs.readFileSync('index.html','utf8'), client=fs.readFileSync('client.js','utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const dynamicIds=new Set([...client.matchAll(/id=[\"']([^\"']+)[\"']/g)].map(m=>m[1]));
for(const m of client.matchAll(/\$\('#([^']+)'\)/g)) assert(ids.has(m[1])||dynamicIds.has(m[1]),`missing id #${m[1]}`);
assert(client.includes('escapeHtml')||client.includes('esc('));
assert(fs.statSync('bg-music.mp3').size>10000);
const css=fs.readFileSync('style.css','utf8');
for(const theme of ['classic','emerald','midnight','royal','ice','vip_jewel']){assert(css.includes(`.board-${theme} .square.light`),`missing ${theme} light board theme`);assert(css.includes(`.board-${theme} .square.dark`),`missing ${theme} dark board theme`)}
assert(css.includes('.piece{width:76%'), 'piece visual size regression');
assert(fs.readFileSync('style.css','utf8').split('{').length===fs.readFileSync('style.css','utf8').split('}').length);
console.log('DEEP AUDIT PASS: engine fuzz, AI validity, DOM IDs, assets, CSS consistency');
