const assert=require('assert');
const e=require('./server');
function play(whiteLevel,blackLevel,maxPly=60){
  let st=e.parsePos(e.START_POS), captures=0, ends=0;
  for(let ply=0;ply<maxPly;ply++){
    const winner=e.gameStatus(st); if(winner)return {winner,ply,captures,ends};
    const a=e.chooseBotAction(st,st.side==='w'?whiteLevel:blackLevel);
    assert(a,'AI action missing');
    if(a.type==='end'){ends++;st=e.applyAIAction(st,a);continue}
    if(a.move.capture!=null)captures++;
    st=e.applyAIAction(st,a);
  }
  return {winner:e.gameStatus(st)||'limit',ply:maxPly,captures,ends};
}
const pairs=[[1,2],[2,1],[1,3],[3,1],[2,3],[3,2]], totals={};
for(const [w,b] of pairs){
  const rs=[]; for(let i=0;i<1;i++) rs.push(play(w,b));
  const wins={w:0,b:0,limit:0}; rs.forEach(r=>wins[r.winner]++);
  const key=`${w}-${b}`;totals[key]=wins;
  console.log(`L${w} ${e.BOT_LEVELS[w].name} vs L${b} ${e.BOT_LEVELS[b].name}`,wins,rs.map(r=>`${r.winner}:${r.ply}`).join(' '));
}
console.log('AI SERIES 6-GAME SMOKE PASS');
