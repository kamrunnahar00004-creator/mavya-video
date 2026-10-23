const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let answer={error:'plan'},args;
 const api=load('src/lib/server/ai-budget.ts',{'@/lib/server/billing-state':{billingRpc:async(name,value)=>{args=value;return answer;}},'@/lib/server/usage':{adminUser:async()=>false}});
 const run={id:'run',updatedAt:'snapshot'};
 assert.equal((await api.beginAI('owner',run,'product',{})).response.status,402);
 answer={error:'limit'};assert.equal((await api.beginAI('owner',run,'script',{})).response.status,429);
 answer={token:'reserved'};assert.equal((await api.beginAI('owner',run,'product',{})).token,'reserved');assert.equal(args.p_expected,'snapshot');assert.equal(args.p_admin,false);
 answer=null;assert.equal((await api.finishAI('owner',run,'product','reserved',{})).status,409);
 console.log('PASS: AI entitlement/rate failures, reserved snapshot/token, stale completion rejection');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
