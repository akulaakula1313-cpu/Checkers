const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sani-checkers-race-')),port=3900+Math.floor(Math.random()*200);
fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({users:{},sessions:{},rooms:{},botGames:{}},null,2));
const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_PASSWORD:'qa-secret'},stdio:'ignore'});
const base=`http://127.0.0.1:${port}`;
function jar(){let cookie='';return {async req(p,opt={}){const h={...(opt.headers||{})};if(cookie)h.cookie=cookie;const r=await fetch(base+p,{...opt,headers:h});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];const j=await r.json().catch(()=>({}));return{r,j}}}}
(async()=>{try{for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,20))}
const a=jar(),b=jar(),h={'content-type':'application/json'};
let x=await a.req('/api/admin/stats');assert.equal(x.r.status,401);
x=await a.req('/api/auth',{method:'POST',headers:h,body:JSON.stringify({name:'RaceA'})});assert(x.j.user);x=await b.req('/api/auth',{method:'POST',headers:h,body:JSON.stringify({name:'RaceB'})});assert(x.j.user);
x=await a.req('/api/room/create',{method:'POST',headers:h,body:JSON.stringify({stake:1000})});const room=x.j.room.id,uid=x.j.uid;
await b.req('/api/room/join',{method:'POST',headers:h,body:JSON.stringify({roomId:room})});
// simultaneous duplicate move: at most one can succeed
const reqs=await Promise.all([0,1,2,3].map(()=>a.req('/api/room/move',{method:'POST',headers:h,body:JSON.stringify({roomId:room,uid,from:17,to:24})})));
assert.equal(reqs.filter(z=>z.r.ok).length,1);
// two simultaneous resigns cannot double-settle
const rs=await Promise.all([a.req('/api/room/resign',{method:'POST',headers:h,body:JSON.stringify({roomId:room,uid})}),a.req('/api/room/resign',{method:'POST',headers:h,body:JSON.stringify({roomId:room,uid})})]);
assert(rs.filter(z=>z.r.ok).length<=1);
console.log('RACE/SECURITY PASS');
}finally{child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
