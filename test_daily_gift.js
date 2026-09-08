const assert=require('assert');
const {DAILY_GIFT_AMOUNTS,dailyGiftState,claimDailyGift,serverDateKey}=require('./server');

function user(chips=0,day=1,lastClaimDate=null){return{id:'gift-test',chips,dailyGift:{day,lastClaimDate}}}

assert.deepStrictEqual(DAILY_GIFT_AMOUNTS,[1000,2000,3000,4000,5000,6000,10000]);

// Day 1: first claim succeeds and persists server-side state.
const u=user(100000,1,null);
let st=dailyGiftState(u,'2026-09-08');
assert.strictEqual(st.serverDate,'2026-09-08');
assert.strictEqual(st.day,1);
assert.strictEqual(st.reward,1000);
assert.strictEqual(st.claimedToday,false);
let r=claimDailyGift(u,'2026-09-08');
assert.strictEqual(r.ok,true);
assert.strictEqual(r.reward,1000);
assert.strictEqual(u.chips,101000);
assert.deepStrictEqual(u.dailyGift,{day:2,lastClaimDate:'2026-09-08'});

// Same server day: second claim is rejected and balance does not change.
r=claimDailyGift(u,'2026-09-08');
assert.strictEqual(r.ok,false);
assert.strictEqual(u.chips,101000);
assert.strictEqual(u.dailyGift.day,2);

// Next server day: next reward is determined by server-stored day, not browser state.
r=claimDailyGift(u,'2026-09-09');
assert.strictEqual(r.ok,true);
assert.strictEqual(r.reward,2000);
assert.strictEqual(u.chips,103000);
assert.deepStrictEqual(u.dailyGift,{day:3,lastClaimDate:'2026-09-09'});

// Verify the complete 7-day cycle and reset to Day 1.
const cycle=user(0,1,null);
const dates=['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07'];
for(let i=0;i<7;i++){
  const x=claimDailyGift(cycle,dates[i]);
  assert.strictEqual(x.ok,true);
  assert.strictEqual(x.reward,DAILY_GIFT_AMOUNTS[i]);
}
assert.strictEqual(cycle.chips,31000);
assert.deepStrictEqual(cycle.dailyGift,{day:1,lastClaimDate:'2026-01-07'});
assert.strictEqual(claimDailyGift(cycle,'2026-01-08').reward,1000);

// Missing a calendar day does not let the client skip ahead: server advances one gift step only.
const missed=user(0,4,'2026-02-01');
const next=dailyGiftState(missed,'2026-02-03');
assert.strictEqual(next.day,4);
assert.strictEqual(next.reward,4000);

// Server date is derived from server time in UTC; client cannot supply a date to the endpoint.
assert.strictEqual(serverDateKey(Date.UTC(2026,8,8,23,59,59)),'2026-09-08');
assert.strictEqual(serverDateKey(Date.UTC(2026,8,9,0,0,0)),'2026-09-09');

console.log('DAILY GIFT PASS: server date, 7-day cycle, duplicate claim block, rollover, missed-day handling');
