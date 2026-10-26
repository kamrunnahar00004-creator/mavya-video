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
 // Definitive legacy-owner outcome is covered once the B3 handler is installed.
}
async function main(){await webhook();console.log('PASS: alertable signature/config failures without leaked payloads; transient DB/Stripe failures still retry');}
main().catch(e=>{console.error(e);process.exitCode=1;});
