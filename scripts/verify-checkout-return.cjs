// Offline fixtures for Checkout return and webhook failure classification. No real Stripe calls.
const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function webhook(){
 const logs=[];let shape=true,bad=true,lookupError=false,providerError=false;
 const query={select(){return this;},eq(){return this;},contains(){return this;},async maybeSingle(){return {data:null,error:lookupError?Error('DB unavailable'):null};}};
 const api=load('src/app/api/stripe/webhook/route.ts',{
  '@/lib/production-config':{stripeWebhookSecret:()=>shape?'whsec_fixture':null},
  '@/lib/server/stripe':{stripe:()=>({webhooks:{constructEventAsync:async()=>{if(bad)throw Error('sensitive signature detail');return {id:'evt_legacy',type:'customer.subscription.updated',created:1,data:{object:{id:'sub_legacy',metadata:{}}}};}},subscriptions:{retrieve:async()=>{if(providerError)throw Error('Stripe unavailable');return {id:'sub_legacy',metadata:{},customer:'cus_legacy'};}}})},
  '@/lib/server/billing-state':{withBillingLock(){throw Error('unexpected lock');}},'@/lib/supabase/server':{createSupabaseAdminClient:()=>({from:()=>query})},'@/lib/server/account-deletion':{}
 },{}, {console:{error:(...args)=>logs.push(args)}});
 const req=()=>new Request('https://fixture.invalid/webhook',{method:'POST',headers:{'stripe-signature':'fixture'},body:'untrusted payload'});
 assert.equal((await api.POST(req())).status,400);assert.ok(logs.some(x=>x[0]==='stripe_webhook_signature_invalid'));assert.ok(!JSON.stringify(logs).includes('sensitive signature detail'));
 shape=false;assert.equal((await api.POST(req())).status,503);assert.ok(logs.some(x=>x[0]==='stripe_webhook_config_invalid'));shape=true;bad=false;
 lookupError=true;assert.equal((await api.POST(req())).status,500);lookupError=false;
 providerError=true;assert.equal((await api.POST(req())).status,500);providerError=false;
 const legacy=await api.POST(req());assert.equal(legacy.status,200);assert.equal((await legacy.json()).result,'unowned');assert.ok(logs.some(x=>x[0]==='stripe_webhook_owner_unresolved'));
}
async function checkout(){
 let user={id:'owner'},session={id:'cs_test_fixture123',client_reference_id:'owner',status:'complete',payment_status:'paid',subscription:'sub_fixture',created:100},sub={id:'sub_fixture',metadata:{user_id:'owner'},status:'active'},result='applied',closed=false,binding=null,error=false,locked=false,calls=[];
 const query=table=>({select(){return this;},eq(_key,value){if(table==='account_deletions')assert.equal(value,user.id);return this;},async maybeSingle(){return {data:table==='account_deletions'?(closed?{user_id:'owner'}:null):binding,error:null};}});
 const api=load('src/app/checkout/return/route.ts',{
  'next/server':{NextResponse:{redirect:url=>new Response(null,{status:307,headers:{location:url}})}},
  '@/lib/supabase/server':{getSessionUser:async()=>user,createSupabaseAdminClient:()=>({from:query})},
  '@/lib/server/account-deletion':{advanceDeletion:async()=>calls.push(['delete'])},
  '@/lib/server/stripe':{stripe:()=>({checkout:{sessions:{retrieve:async()=>{calls.push(['session']);if(error)throw Error('Stripe unavailable');return session;}}},subscriptions:{retrieve:async()=>{calls.push(['sub',locked]);return sub;}}}),subscriptionRow:(owner,value,time)=>({...value,user_id:owner,stripe_subscription_id:value.id,last_event_created:time})},
  '@/lib/server/billing-state':{withBillingLock:async(owner,work)=>{assert.equal(owner,user.id);locked=true;try{return await work('token');}finally{locked=false;}},billingRpc:async(name,args)=>{calls.push([name,args]);return result;}}
 });
 const run=async(id='cs_test_fixture123')=>(await api.GET(new Request('https://fixture.invalid/checkout/return?session_id='+id))).headers.get('location');
 const fallback='https://fixture.invalid/settings/billing?paid=1';
 user=null;assert.ok((await run()).includes('auth=login'));assert.equal(calls.length,0);user={id:'owner'};
 assert.equal(await run('bad'),fallback);assert.equal(calls.length,0);
 for(const patch of [{client_reference_id:'foreign'},{status:'open'},{payment_status:'unpaid'},{subscription:null}]){const saved=session;session={...session,...patch};assert.equal(await run(),fallback);assert.ok(!calls.some(c=>c[0]==='mavya_billing_event'));session=saved;calls=[];}
 assert.equal(await run(),'https://fixture.invalid/studio');assert.equal(calls.find(c=>c[0]==='sub')[1],true);const event=calls.find(c=>c[0]==='mavya_billing_event')[1];assert.equal(event.p_created,100);assert.equal(event.p_event,'checkout-return:cs_test_fixture123');
 result='duplicate';assert.equal(await run(),'https://fixture.invalid/studio');result='older';assert.equal(await run(),'https://fixture.invalid/studio');result='conflict';assert.equal(await run(),fallback);result='applied';
 session={...session,payment_status:'no_payment_required'};sub={...sub,metadata:{}};assert.equal(await run(),'https://fixture.invalid/studio');
 sub={...sub,metadata:{user_id:'foreign'}};assert.equal(await run(),fallback);sub={...sub,metadata:{user_id:'owner'}};
 error=true;assert.equal(await run(),fallback);error=false;
 closed=true;calls=[];assert.equal(await run(),fallback);assert.ok(calls.some(c=>c[0]==='mavya_deletion_event'));assert.ok(calls.some(c=>c[0]==='delete'));assert.ok(!calls.some(c=>c[0]==='mavya_billing_event'));
 binding={user_id:'foreign'};calls=[];assert.equal(await run(),fallback);assert.ok(!calls.some(c=>c[0]==='mavya_deletion_event'));binding=null;
 closed=false;user={id:'new-owner'};session={...session,client_reference_id:'new-owner'};sub={...sub,metadata:{user_id:'new-owner'}};assert.equal(await run(),'https://fixture.invalid/studio');
}
async function main(){await webhook();await checkout();console.log('PASS: signature/config and orphan classification; Checkout auth, ownership, completion/payment, lease, replay, conflict, failure, deletion and new-account return fixtures');}
main().catch(e=>{console.error(e);process.exitCode=1;});
