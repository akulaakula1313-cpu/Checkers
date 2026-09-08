const assert=require('assert'),fs=require('fs'),http=require('http'),path=require('path'),{spawn}=require('child_process');
const ROOT=__dirname, PORT=3200+Math.floor(Math.random()*500), DATA=path.join(ROOT,'.qa-realtime-'+process.pid), BASE=`http://127.0.0.1:${PORT}`;
fs.rmSync(DATA,{recursive:true,force:true}); fs.mkdirSync(DATA,{recursive:true});
const srv=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),DATA_DIR:DATA,ADMIN_PASSWORD:'qa'},stdio:['ignore','pipe','pipe']});
let output=''; srv.stdout.on('data',d=>output+=d); srv.stderr.on('data',d=>output+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function request(method,url,body,cookie=''){return new Promise((resolve,reject)=>{const u=new URL(BASE+url),data=body===undefined?null:JSON.stringify(body),started=Date.now();const req=http.request({method,hostname:u.hostname,port:u.port,path:u.pathname+u.search,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})}},res=>{let raw='';res.on('data',d=>raw+=d);res.on('end',()=>{let json={};try{json=JSON.parse(raw)}catch{};resolve({status:res.statusCode,body:json,cookie:(res.headers['set-cookie']||[]).map(x=>x.split(';')[0]).join('; '),ms:Date.now()-started})})});req.on('error',reject);if(data)req.write(data);req.end()})}
async function main(){try{
 for(let i=0;i<40;i++){try{const h=await request('GET','/api/health');if(h.status===200)break}catch{} await sleep(25)}
 const a=await request('POST','/api/auth',{name:'QA_A_'+Date.now()});assert.equal(a.status,200);const ca=a.cookie;
 const b=await request('POST','/api/auth',{name:'QA_B_'+Date.now()});assert.equal(b.status,200);const cb=b.cookie;
 const cr=await request('POST','/api/room/create',{stake:100},ca);assert.equal(cr.status,200);const room=cr.body.room.id,uidA=cr.body.uid;
 const jr=await request('POST','/api/room/join',{roomId:room},cb);assert.equal(jr.status,200);const uidB=jr.body.uid;
 let s=await request('GET',`/api/room/sync?roomId=${room}&uid=${uidB}`,undefined,cb);assert.equal(s.body.room.status,'playing');
 const chat=await request('POST','/api/room/chat',{roomId:room,uid:uidA,text:'realtime'},ca);assert.equal(chat.status,200);
 const t=Date.now();let seen=false;for(let i=0;i<20;i++){s=await request('GET',`/api/room/sync?roomId=${room}&uid=${uidB}`,undefined,cb);if(s.body.room.chat.some(x=>x.text==='realtime')){seen=true;break}await sleep(10)}assert(seen,'chat never reached second client');const chatMs=Date.now()-t;assert(chatMs<250,'chat propagation exceeded 250ms in local E2E');
 const mv=await request('POST','/api/room/move',{roomId:room,uid:uidA,from:17,to:26},ca);assert.equal(mv.status,200);s=await request('GET',`/api/room/sync?roomId=${room}&uid=${uidB}`,undefined,cb);assert.equal(s.body.room.position,mv.body.room.position);
 const rs=await request('POST','/api/room/resign',{roomId:room,uid:uidA},ca);assert.equal(rs.body.room.status,'finished');
 const r1=await request('POST','/api/room/rematch',{roomId:room},ca);assert.equal(r1.status,200);assert.equal(r1.body.ready,false);
 const r2=await request('POST','/api/room/rematch',{roomId:room},cb);assert.equal(r2.status,200);assert.equal(r2.body.ready,true);assert.equal(r2.body.room.status,'playing');
 const rca=await request('POST','/api/room/rematch-connect',{roomId:room},ca);assert.equal(rca.status,200);assert.equal(rca.body.room.id,r2.body.room.id);assert.equal(rca.body.room.status,'playing');
 const rcb=await request('POST','/api/room/rematch-connect',{roomId:room},cb);assert.equal(rcb.status,200);assert.equal(rcb.body.room.id,r2.body.room.id);
 console.log(`REALTIME E2E PASS: chat ${chatMs}ms, move sync, finish, two-sided rematch`);
}finally{srv.kill('SIGTERM');await sleep(50);fs.rmSync(DATA,{recursive:true,force:true})}}
main().catch(e=>{console.error('REALTIME E2E FAIL:',e.stack,'\nSERVER:',output);try{srv.kill('SIGTERM');fs.rmSync(DATA,{recursive:true,force:true})}catch{}process.exit(1)});
