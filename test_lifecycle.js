const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sani-checkers-life-')),port=4200+Math.floor(Math.random()*200);
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({users:{},sessions:{},rooms:{},botGames:{}},null,2));
const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:dir,PLAYER_TIMEOUT_MS:'40',DISCONNECT_GRACE_MS:'180'},stdio:['ignore','pipe','pipe']});
const base=`http://127.0.0.1:${port}`;
function jar(){let cookie='';return {async req(p,opt={}){const h={...(opt.headers||{})};if(cookie)h.cookie=cookie;const r=await fetch(base+p,{...opt,headers:h});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const j=await r.json().catch(()=>({}));return{r,j}}};}
const post=(j,p,b)=>j.req(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
(async()=>{try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,15));}
  const a=jar(),b=jar();
  let x=await post(a,'/api/auth',{name:'Life-A'});const idA=x.j.user.id;assert(idA);const old=x.j.user.name;
  x=await post(a,'/api/profile/name',{name:'Life-A-Renamed'});assert.equal(x.j.user.name,'Life-A-Renamed');assert.equal(x.j.user.id,idA);
  const db1=JSON.parse(fs.readFileSync(path.join(dir,'db.json'),'utf8'));assert.equal(db1.users[idA].name,'Life-A-Renamed');assert.deepEqual(db1.users[idA].nameHistory,[old,'Life-A-Renamed']);
  await post(b,'/api/auth',{name:'Life-B'});
  x=await post(a,'/api/room/create',{stake:500});const oldRoom=x.j.room.id,uidA=x.j.uid;assert.equal(x.j.user.chips,99500);
  x=await post(b,'/api/room/join',{roomId:oldRoom});const uidB=x.j.uid;assert.equal(x.j.room.bank,1000);
  x=await post(a,'/api/room/resign',{roomId:oldRoom,uid:uidA});assert.equal(x.j.room.result,'0-1');
  x=await post(a,'/api/room/rematch',{roomId:oldRoom});assert.equal(x.j.ready,false);
  x=await post(b,'/api/room/rematch',{roomId:oldRoom});assert.equal(x.j.ready,true);assert(x.j.room.id!==oldRoom);assert.equal(x.j.room.bank,1000);const newRoom=x.j.room.id;
  x=await post(a,'/api/room/rematch-connect',{roomId:oldRoom});assert.equal(x.j.room.id,newRoom);assert.equal(x.j.self,'w');
  x=await post(a,'/api/room/create',{stake:100});const rid=x.j.room.id;
  x=await post(b,'/api/room/join',{roomId:rid});const uidB2=x.j.uid;
  await new Promise(r=>setTimeout(r,330));
  x=await b.req(`/api/room/sync?roomId=${rid}&uid=${uidB2}`);assert.equal(x.j.room.result,'0-1');assert.equal(x.j.room.winner,'b');assert.equal(x.j.room.forfeitReason,'Игрок «Life-A-Renamed» не вернулся в течение 1 минуты');
  const db2=JSON.parse(fs.readFileSync(path.join(dir,'db.json'),'utf8'));assert.equal(db2.users[idA].losses,2);assert.equal(db2.users[idA].chips,98900);
  x=await post(a,'/api/room/create',{stake:250});const leaveRoom=x.j.room.id,leaveUidA=x.j.uid;
  x=await post(b,'/api/room/join',{roomId:leaveRoom});const leaveUidB=x.j.uid;
  const leaveStarted=Date.now();
  x=await post(a,'/api/room/leave',{roomId:leaveRoom,uid:leaveUidA});
  assert.equal(x.j.room.status,'finished');assert.equal(x.j.room.result,'0-1');assert.equal(x.j.room.winner,'b');assert.equal(x.j.room.forfeitReason,'Игрок «Life-A-Renamed» покинул стол');
  assert(Date.now()-leaveStarted<500,'active leave must settle immediately');
  x=await b.req(`/api/room/sync?roomId=${leaveRoom}&uid=${leaveUidB}`);assert.equal(x.j.room.result,'0-1');assert.equal(x.j.room.winner,'b');
  console.log('LIFECYCLE/REMATCH/NICKNAME/DISCONNECT/INSTANT-LEAVE PASS');
}catch(e){console.error(e);process.exitCode=1}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true})}})();
