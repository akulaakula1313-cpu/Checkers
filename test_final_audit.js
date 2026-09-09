'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const http=require('http');
const {
  parsePos,pos,legalMoves,applyMove,gameStatus,START_POS,
  DAILY_GIFT_AMOUNTS,dailyGiftState,claimDailyGift
}=require('./server.js');

function emptyState(side='w') { return {board:Array(64).fill(null),side,captureFrom:null,history:[]}; }
function put(st,idx,piece){st.board[idx]=piece;return st;}
function move(st,from,to){const m=legalMoves(st).find(x=>x.from===from&&x.to===to);assert(m,`Expected legal move ${from}->${to}; got ${JSON.stringify(legalMoves(st))}`);return applyMove(st,m);}
function test(name,fn){try{fn();console.log('PASS',name)}catch(e){console.error('FAIL',name);throw e}}

// 1) Basic parser/position roundtrip.
test('start position parses',()=>{
  const st=parsePos(START_POS);
  assert.strictEqual(st.board.filter(Boolean).length,24);
  assert.strictEqual(st.side,'w');
  assert.strictEqual(st.captureFrom,null);
});

// 2) Strict 3-capture continuation, with a second white piece also having a capture.
test('strict multi-capture 3+ and no switching',()=>{
  const st=emptyState('w');
  put(st,8,'w'); put(st,40,'w');
  put(st,17,'b'); put(st,35,'b'); put(st,49,'b'); put(st,51,'b');
  let n=move(st,8,26);
  assert.strictEqual(n.captureFrom,26);
  assert.strictEqual(n.side,'w');
  assert.deepStrictEqual(legalMoves(n).map(x=>[x.from,x.to]),[[26,44]]);
  assert.strictEqual(legalMoves(n).some(x=>x.from===10),false);
  n=move(n,26,44);
  assert.strictEqual(n.captureFrom,44);
  assert.strictEqual(n.side,'w');
  assert.deepStrictEqual(legalMoves(n).map(x=>[x.from,x.to]),[[44,58]]);
  n=move(n,44,58);
  assert.strictEqual(n.captureFrom,null);
  assert.strictEqual(n.side,'b');
});

// 3) Single capture ends turn if no continuation exists.
test('single capture ends turn',()=>{
  const st=emptyState('w'); put(st,8,'w'); put(st,17,'b'); put(st,50,'b');
  const n=move(st,8,26);
  assert.strictEqual(n.captureFrom,null);
  assert.strictEqual(n.side,'b');
});

// 4) Mandatory capture prevents quiet moves when any capture exists.
test('mandatory capture blocks quiet move',()=>{
  const st=emptyState('w'); put(st,8,'w'); put(st,10,'w'); put(st,17,'b');
  const moves=legalMoves(st);
  assert(moves.every(m=>m.capture!=null));
  assert(moves.some(m=>m.from===8));
  assert(moves.some(m=>m.from===10));
  assert.strictEqual(moves.some(m=>m.from===10&&m.capture==null),false);
});

// 5) Continuation cannot be escaped by moving another piece.
test('continuation cannot switch piece',()=>{
  const st=emptyState('w'); put(st,8,'w'); put(st,40,'w'); put(st,17,'b'); put(st,35,'b'); put(st,49,'b');
  const n=move(st,8,26);
  assert.strictEqual(n.captureFrom,26);
  assert.strictEqual(legalMoves(n).some(m=>m.from===40),false);
});

// 6) Persistence representation includes captureFrom in room state contract.
test('position serializer keeps board/side and server state keeps captureFrom',()=>{
  const st=emptyState('w'); put(st,26,'w'); st.captureFrom=26;
  const serialized=pos(st);
  assert(serialized.includes(' w'));
  assert.strictEqual(parsePos(serialized).captureFrom,null,'legacy position string intentionally does not carry continuation; room state must carry it separately');
});

// 7) Daily gift sanity.
test('daily gift cannot be claimed twice same day',()=>{
  const u={chips:0,dailyGift:{day:1,lastClaimDate:null}};
  const a=claimDailyGift(u,'2099-01-01');
  assert.strictEqual(a.ok,true); assert.strictEqual(a.reward,DAILY_GIFT_AMOUNTS[0]);
  const b=claimDailyGift(u,'2099-01-01');
  assert.strictEqual(b.ok,false);
  assert.strictEqual(dailyGiftState(u,'2099-01-02').day,2);
});

// 8) Static packaging audit.
test('production files and references are consistent',()=>{
  const required=['index.html','client.js','server.js','style.css','favicon.svg','package.json','db.json','README.md'];
  for(const f of required) assert(fs.existsSync(path.join(__dirname,f)),`missing ${f}`);
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert(html.includes('href="style.css"'));
  assert(html.includes('href="favicon.svg"'));
  assert(html.includes('src="client.js?v=2.7.4"'));
  assert(!html.includes('bg-music.mp3'));
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
  assert.strictEqual(pkg.scripts.start,'node server.js');
  assert.strictEqual(pkg.scripts.test,'node test_final_audit.js');
});

// 9) Selection glow audit: only selected piece is green; mandatory piece is red.
test('selection glow styling is isolated',()=>{
  const css=fs.readFileSync(path.join(__dirname,'style.css'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'client.js'),'utf8');
  assert(css.includes('.square.selected .piece'));
  assert(css.includes('#39ff88'));
  assert(css.includes('.square.mandatory .piece'));
  assert(css.includes('#ff2f2f'));
  assert(client.includes("${s===selected?'selected-piece':''}"));
  assert(!css.includes('.square.mandatory .piece{filter:drop-shadow(0 0 7px currentColor)'));
});

// 9) HTTP smoke test: real server responds and serves assets.
async function request(port,pathName){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:pathName},res=>{let b='';res.setEncoding('utf8');res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b,headers:res.headers}));});req.on('error',reject)});}
(async()=>{
  const {spawn}=require('child_process');
  const port=3127;
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:path.join(__dirname,'.test-data')},stdio:['ignore','pipe','pipe']});
  let ready=false;
  try{
    for(let i=0;i<50;i++){
      await new Promise(r=>setTimeout(r,50));
      try{const h=await request(port,'/api/health');if(h.status===200){ready=true;break}}catch{}
    }
    assert(ready,'server did not start');
    const h=await request(port,'/api/health'); assert.strictEqual(h.status,200); assert.strictEqual(JSON.parse(h.body).ok,true);
    const index=await request(port,'/'); assert.strictEqual(index.status,200); assert(index.body.includes('SANI CHECKERS'));
    const js=await request(port,'/client.js?v=2.7.1'); assert.strictEqual(js.status,200); assert(js.body.includes('captureFrom'));
    const css=await request(port,'/style.css'); assert.strictEqual(css.status,200);
    const fav=await request(port,'/favicon.svg'); assert.strictEqual(fav.status,200);
    console.log('PASS HTTP smoke test');
  } finally {
    child.kill('SIGTERM');
    setTimeout(()=>child.kill('SIGKILL'),500).unref();
    fs.rmSync(path.join(__dirname,'.test-data'),{recursive:true,force:true});
  }
})().catch(e=>{console.error('FAIL HTTP smoke test');console.error(e);process.exitCode=1});
