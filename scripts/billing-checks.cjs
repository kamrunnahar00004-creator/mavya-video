// All external/auth/storage dependencies are explicit fixtures. Unexpected imports fail closed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, stubs, env = {}) {
  const module = {exports:{}};
  const source = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source, {module,exports:module.exports,require(id){if(id==='server-only')return {};if(Object.hasOwn(stubs,id))return stubs[id];throw new Error(`Unstubbed import ${id}`);},Response,Request,URL,process:{env},console:{error(){}}}, {filename:file});
  return module.exports;
}
async function main() {
  let calls = [], locked = false, pending = null, createError = false, dbError = false, leaseBusy = false;
  let row = null;
  const session = {id:'cs_fixture',status:'open',url:'https://checkout.fixture.invalid',subscription:'sub_fixture'};
  const rpc = async (name,args) => {
    calls.push([name,args]);
    if(name==='mavya_billing_lock'){locked=!leaseBusy;return {data:locked?'token':null};}
    if(name==='mavya_billing_unlock'){locked=false;return {data:null};}
    if(name==='mavya_checkout_prepare'){
      pending ??= {request_key:'key',params:JSON.parse(JSON.stringify(args.p_params)),session_id:null,created_at:new Date().toISOString()};
      return {data:pending};
    }
    if(name==='mavya_checkout_record'){pending.session_id=args.p_session;return {data:null};}
    if(name==='mavya_billing_action')return {data:false};
    if(name==='mavya_billing_event')return dbError?{error:new Error('DB failure')}:{data:'applied'};
    throw new Error(name);
  };
  const db = {rpc,from(table){
    return {select(){return this;},eq(){return this;},async maybeSingle(){return dbError?{error:new Error('lookup failed')}:{data:table==='billing_subscription_ids'?{user_id:'owner'}:row,error:null};}};
  }};
  let current = {id:'sub_fixture',status:'canceled',metadata:{user_id:'owner'}};
  const stripeClient = {
    checkout:{sessions:{async create(params,options){assert.equal(locked,true);calls.push(['create',JSON.parse(JSON.stringify(params)),options]);if(createError)throw new Error('Lost response');return session;},async retrieve(id){calls.push(['checkout-retrieve',id]);return session;}}},
    subscriptions:{async retrieve(id){calls.push(['retrieve',id,locked]);return current;},async update(){calls.push(['update']);return current;}},
    webhooks:{async constructEventAsync(){return event;}}
  };
  const stripeStub = {stripe:()=>stripeClient,stripeEnabled:()=>true,priceFor:()=> 'price_fixture',subscriptionRow:(user,sub,time)=>({...sub,user_id:user,stripe_subscription_id:sub.id,last_event_created:time})};
  const supabase = {createSupabaseAdminClient:()=>db,getSessionUser:async()=>({id:'owner',email:'owner@fixture.invalid'})};
  const state = load('src/lib/server/billing-state.ts',{'@/lib/supabase/server':supabase,'@/lib/server/stripe':stripeStub});
  const checkout = (email='owner@fixture.invalid',origin='https://app.fixture.invalid')=>state.withBillingLock('owner',token=>state.pendingCheckout({id:'owner',email},token,null,'starter','monthly',origin));
  createError=true; await assert.rejects(checkout());
  const first = calls.find(c=>c[0]==='create'); assert.ok(pending); assert.equal(locked,false);
  createError=false; assert.equal(await checkout('changed@fixture.invalid','https://changed.fixture.invalid'),session.url);
  const creates=calls.filter(c=>c[0]==='create');
  assert.equal(JSON.stringify(creates[1][1]),JSON.stringify(first[1]));
  assert.equal(creates[1][2].idempotencyKey,first[2].idempotencyKey);
  await checkout(); assert.equal(calls.filter(c=>c[0]==='create').length,2);
  pending.session_id=null; pending.created_at=new Date(Date.now()-25*3600_000).toISOString();
  await assert.rejects(checkout(),/recovery/);
  assert.equal(calls.filter(c=>c[0]==='create').length,2);
  leaseBusy=true; await assert.rejects(checkout(),/updating/); leaseBusy=false;
  dbError=true; await assert.rejects(state.billingRow('owner')); dbError=false;
  await assert.rejects(state.applyBillingAction('owner','token',{stripe_subscription_id:'sub_fixture',billing_revision:1,last_event_created:200},current),/changed/);

  let event = {id:'evt_fixture',type:'customer.subscription.updated',created:100,data:{object:{id:'sub_fixture',status:'active',metadata:{user_id:'owner'}}}};
  const webhook = load('src/app/api/stripe/webhook/route.ts',{'@/lib/server/stripe':stripeStub,'@/lib/server/billing-state':state,'@/lib/supabase/server':supabase},{STRIPE_WEBHOOK_SECRET:'fixture-only'});
  const request=()=>new Request('https://app.fixture.invalid/webhook',{method:'POST',headers:{'stripe-signature':'fixture'},body:'fixture'});
  calls=[]; assert.equal((await webhook.POST(request())).status,200);
  assert.equal(calls.find(c=>c[0]==='retrieve')[2],true);
  assert.equal(calls.find(c=>c[0]==='mavya_billing_event')[1].p_state.status,'canceled'); // Current state, not stale active payload.
  dbError=true; calls=[]; assert.equal((await webhook.POST(request())).status,500);
  assert.equal(calls.some(c=>c[0]==='mavya_billing_event'),false); dbError=false;
  leaseBusy=true; calls=[]; assert.equal((await webhook.POST(request())).status,500);
  assert.equal(calls.some(c=>c[0]==='retrieve'),false); leaseBusy=false;
  event={...event,data:{object:{...event.data.object,metadata:{user_id:'foreign'}}}};
  calls=[]; assert.equal((await webhook.POST(request())).status,500);
  assert.equal(calls.some(c=>c[0]==='mavya_billing_event'),false);
  assert.equal((await webhook.POST(new Request('https://app.fixture.invalid/webhook',{method:'POST',body:'fixture'}))).status,400);

  const route=load('src/app/api/billing/route.ts',{'next/server':{connection:async()=>{}},'@/lib/plans':{PLANS:[{id:'starter'}]},'@/lib/server/stripe':stripeStub,'@/lib/supabase/server':supabase,'@/lib/server/billing-state':state});
  dbError=true; calls=[];
  assert.equal((await route.POST(new Request('https://app.fixture.invalid/billing',{method:'POST',body:JSON.stringify({action:'checkout',plan:'starter'})}))).status,502);
  assert.equal(calls.some(c=>['create','update'].includes(c[0])),false);
  assert.equal((await route.GET()).status,503);
  console.log('PASS: lost Checkout response reuses persisted parameters/key, existing session reuse, old unknown-create recovery, busy lease, lookup fail closed, action CAS failure, webhook fresh state under lease, owner mismatch/signature guards, no paid imports');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
