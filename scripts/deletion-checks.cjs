const assert=require('node:assert/strict');
const {load}=require('./check-module.cjs');
async function main(){
 let record={user_id:'owner',state:'cancel',subscription_ids:['sub'],checkout:{session_id:'cs'},media_ids:['one.mp4','two.png'],cursor:0,cleanup_after:new Date(Date.now()+3600000).toISOString()};
 let cancelFails=true,storageFails=false,events=[];
 const db={from(){return {update(patch){this.patch=patch;return this;},eq(){return this;},async select(){Object.assign(record,this.patch);return {data:[{user_id:'owner'}]};}};},auth:{admin:{async deleteUser(){events.push('auth');return {error:null};}}}};
 const api=load('src/lib/server/account-deletion.ts',{
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>db},
  '@/lib/server/billing-state':{billingRpc:async name=>{assert.equal(name,'mavya_claim_deletion');if(record.state==='done')return null;record.lease_token='lease';return JSON.parse(JSON.stringify(record));},withBillingLock:()=>{throw Error('not expected');}},
  '@/lib/server/account-state':{accountClosing:async()=>true},
  '@/lib/server/stripe':{stripe:()=>({checkout:{sessions:{retrieve:async()=>({id:'cs',status:'open'}),expire:async()=>events.push('expire')}},subscriptions:{retrieve:async()=>({status:'active'}),cancel:async(id,params)=>{events.push('cancel');assert.equal(params.prorate,false);assert.equal(params.invoice_now,false);if(cancelFails)throw Error('Stripe down');}}})},
  '@/lib/server/r2':{deleteObjectStrict:async key=>{events.push(key);if(storageFails)throw Error('R2 down');}}
 });
 await assert.rejects(api.advanceDeletion('owner'));
 assert.equal(events.includes('auth'),false);assert.equal(record.state,'cancel');
 cancelFails=false;events=[];await api.advanceDeletion('owner');
 assert.equal(record.state,'storage');assert.equal(events.includes('auth'),false);assert.ok(events.includes('cancel'));
 record.cleanup_after=new Date(0).toISOString();storageFails=true;
 await assert.rejects(api.advanceDeletion('owner'));assert.equal(events.includes('auth'),false);
 storageFails=false;events=[];await api.advanceDeletion('owner');
 assert.equal(record.state,'done');assert.equal(events.at(-1),'auth');assert.ok(events.includes('media/one.mp4'));
 events=[];await api.advanceDeletion('owner');assert.equal(events.length,0);
 console.log('PASS: deletion cancellation/expiry ordering, no refund/proration, Stripe failure blocks auth deletion, grant wait, strict R2 retry, auth last, terminal replay');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
