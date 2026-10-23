const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let calls=[],fail=false;
 const end=Math.floor(Date.now()/1000)+86400,start=end-30*86400;
 let current={id:'sub',status:'active',collection_method:'charge_automatically',schedule:'schedule',items:{data:[{id:'item',quantity:1,price:{id:'starter-monthly'}}]}};
 const phase={start_date:start,end_date:end,items:[{price:'starter-monthly',quantity:1}],add_invoice_items:[],discounts:[],metadata:{}};
 const api=load('src/lib/server/billing-change.ts',{
  'node:crypto':require('node:crypto'),
  '@/lib/plans':{planById:id=>({hooks:{starter:20,pro:60,studio:150}[id]})},
  '@/lib/server/stripe':{
   planOfPrice:id=>({plan:id.split('-')[0],cycle:id.split('-')[1]}),priceFor:(p,c)=>`${p}-${c}`,subscriptionPeriod:()=>({start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString()}),
   stripe:()=>({subscriptions:{retrieve:async()=>current,update:async(id,params,options)=>{calls.push(['upgrade',params,options]);if(fail)throw Object.assign(Error('declined'),{statusCode:402});current={...current,items:{data:[{...current.items.data[0],price:{id:params.items[0].price}}]}};return current;}},subscriptionSchedules:{retrieve:async()=>({id:'schedule',current_phase:{start_date:start},phases:[phase]}),create:async()=>{throw Error('unexpected');},update:async(id,params)=>calls.push(['schedule',params]),release:async()=>calls.push(['release'])}})
  }
 });
 fail=true;await assert.rejects(api.changeSubscription(current,'pro','monthly','owner'));
 assert.equal(current.items.data[0].price.id,'starter-monthly');assert.equal(calls.some(c=>c[0]==='release'),false);
 fail=false;calls=[];await api.changeSubscription(current,'pro','monthly','owner');
 assert.equal(calls[0][1].proration_behavior,'always_invoice');assert.equal(calls[0][1].payment_behavior,'error_if_incomplete');assert.ok(calls[0][2].idempotencyKey);
 assert.equal(calls[1][0],'release');
 calls=[];const result=await api.changeSubscription(current,'starter','monthly','owner');assert.equal(result.scheduled,true);
 assert.equal(calls.some(c=>c[0]==='upgrade'),false);assert.equal(calls[0][1].phases[0].items[0].price,'pro-monthly');assert.equal(calls[0][1].phases[1].start_date,end);assert.equal(calls[0][1].proration_behavior,'none');
 calls=[];await api.changeSubscription(current,'studio','annual','owner');assert.equal(calls[0][0],'schedule');
 calls=[];await api.clearPendingChange(current);assert.equal(calls[0][0],'release');
 console.log('PASS: declined upgrade leaves plan/schedule intact, immediate collected upgrade with retry key, downgrade/cycle switch at renewal, cancel/resume schedule clearing');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
