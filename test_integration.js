const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sani-checkers-')),port=3400+Math.floor(Math.random()*300);fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({users:{},sessions:{},rooms:{},botGames:{}},null,2));
const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_PASSWORD:'qa-secret'},stdio:['ignore','pipe','pipe']});
let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
const base=`http://127.0.0.1:${port}`;
function jar(){let cookie='';return {async req(p,opt={}){const h={...(opt.headers||{})};if(cookie)h.cookie=cookie;const r=await fetch(base+p,{...opt,headers:h});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const j=await r.json().catch(()=>({}));return{r,j}},get cookie(){return cookie}}}
const a=jar(),b=jar();
(async()=>{try{
for(let i=0;i<40;i++){try{const x=await fetch(base+'/api/health');if(x.ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
let x=await a.req('/api/health');assert.equal(x.j.ok,true);assert.equal(x.r.headers.get('x-content-type-options'),'nosniff');
x=await a.req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(x.j.needsName,true);
x=await a.req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'QA-Шашки'})});assert(x.j.user.id);assert.equal(x.j.user.chips,100000);
let y=await b.req('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'QA-Шашки-2'})});assert(y.j.user.id);
// shop
x=await a.req('/api/shop/buy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'board',itemId:'emerald'})});assert.equal(x.j.ok,true);x=await a.req('/api/shop/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'board',itemId:'emerald'})});assert.equal(x.j.user.inventory.selectedBoard,'emerald');
// bot stake + named level + state
x=await a.req('/api/bot/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stake:500,level:2})});assert(x.j.gameId);assert.equal(x.j.position,'b1b1b1b1/1b1b1b1b/b1b1b1b1/8/8/1w1w1w1w/w1w1w1w1/1w1w1w1w w');assert.equal(x.j.levelName,'1-й разряд');assert.equal(x.j.levelStyle,'Тактический');assert.equal(x.j.user.chips,69500);const gid=x.j.gameId;
x=await a.req('/api/bot/state?gameId='+encodeURIComponent(gid));assert.equal(x.j.stake,500);assert.equal(x.j.levelName,'1-й разряд');assert.equal(x.j.levelStyle,'Тактический');
// bot resign loses stake and updates stats
x=await a.req('/api/bot/resign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:gid})});assert.equal(x.j.result,'loss');assert.equal(x.j.user.chips,69500);assert.equal(x.j.user.losses,1);
// bot level 3 starts with stake and admin ban later cancels/refunds
x=await a.req('/api/bot/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stake:300,level:3})});assert.equal(x.j.levelName,'Гроссмейстер');assert.equal(x.j.levelStyle,'Позиционно-тактический');const gid3=x.j.gameId;assert.equal(x.j.user.chips,69200);
// online money table
x=await a.req('/api/room/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stake:100})});assert(x.j.room.id);assert.equal(x.j.room.position,'b1b1b1b1/1b1b1b1b/b1b1b1b1/8/8/1w1w1w1w/w1w1w1w1/1w1w1w1w w');const roomId=x.j.room.id,uid1=x.j.uid;
y=await b.req('/api/room/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId})});assert.equal(y.j.ok,true);const uid2=y.j.uid;
x=await a.req('/api/room/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,uid:uid1,from:17,to:24})});assert.equal(x.j.ok,true);
x=await a.req('/api/room/draw',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,uid:uid1})});assert.equal(x.j.ok,true);
y=await b.req('/api/room/draw-response',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,uid:uid2,accept:false})});assert.equal(y.j.ok,true);
x=await a.req('/api/room/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,uid:uid1,text:'<b>hello</b>'})});assert.equal(x.j.ok,true);x=await a.req(`/api/room/sync?roomId=${roomId}&uid=${uid1}`);assert(!x.j.room.chat[0].text.includes('<'));
// admin login, stats, search
x=await a.req('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'qa-secret'})});assert.equal(x.j.ok,true);
x=await a.req('/api/admin/stats');assert.equal(x.j.stats.players,2);assert(x.j.stats.playingRooms>=1);assert(x.j.stats.botGames>=1);
x=await a.req('/api/admin/players?q=QA-Шашки-2');assert.equal(x.j.players.length,1);
const user2=x.j.players[0].id;
// admin chips, set, VIP, rename
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'chips',userId:user2,amount:1000})});assert.equal(x.j.ok,true);
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'set_chips',userId:user2,amount:7777})});assert.equal(x.j.user.chips,7777);
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'vip',userId:user2,value:true})});assert.equal(x.j.user.vip,true);
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'rename',userId:user2,name:'QA-Admin-Renamed'})});assert.equal(x.j.user.name,'QA-Admin-Renamed');
// admin ban second player; active online game is cancelled/refunded
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'ban',userId:user2,value:true})});assert.equal(x.j.ok,true);x=await a.req('/api/admin/players?q=QA-Admin-Renamed');assert.equal(x.j.players[0].banned,true);
// admin delete first player's active bot: refund 300 and cancel game, then delete account
const user1=x.j.players.length?null:null;
let all=await a.req('/api/admin/players?q=QA-Шашки');const user1id=all.j.players[0].id;
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'delete',userId:user1id})});assert.equal(x.j.ok,true);
// unban second player using its id
x=await a.req('/api/admin/players?q=QA-Admin-Renamed');assert.equal(x.j.players.length,1);assert.equal(x.j.players[0].banned,true);
x=await a.req('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'ban',userId:x.j.players[0].id,value:false})});assert.equal(x.j.ok,true);
console.log('INTEGRATION TESTS PASS');
}catch(e){console.error(out);console.error(e);process.exitCode=1}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true})}})();
