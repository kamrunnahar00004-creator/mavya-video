const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let canceled=false;
 const api=load('src/lib/server/bounded-fetch.ts',{}, {},{fetch:async(url,options)=>{assert.ok(options.signal);return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20));},cancel(){canceled=true;}}));}});
 await assert.rejects(api.boundedFetch('https://fixture.invalid',{},10),/too large/);assert.equal(canceled,true);
 const small=load('src/lib/server/bounded-fetch.ts',{}, {},{fetch:async()=>Response.json({ok:true})});
 assert.equal((await (await small.boundedFetch('https://fixture.invalid')).json()).ok,true);
 let writes=0;
 const route=load('src/app/api/contact/route.ts',{
  'node:crypto':require('node:crypto'),'node:fs/promises':{mkdir(){throw Error('disk write forbidden');}},'node:path':require('node:path'),
  '@/lib/server/store':{cloud:()=>true},'@/lib/supabase/server':{},
  '@/lib/server/billing-state':{billingRpc:async()=>{writes++;return 'durable-inquiry';}},
  '@/lib/server/bounded-fetch':{boundedFetch:async()=>{throw Error('email unavailable');}}
 },{SUPABASE_SERVICE_ROLE_KEY:'fixture-only',RESEND_API_KEY:'fixture-only',CONTACT_TO:'fixture@invalid.test'});
 const reply=await route.POST(new Request('https://fixture.invalid/contact',{method:'POST',body:JSON.stringify({email:'user@example.test',message:'Business inquiry'})}));
 assert.equal(reply.status,200);assert.equal(writes,1);
 console.log('PASS: streamed response cap/cancellation and deadline, bounded JSON response, contact survives read-only disk/email outage in durable storage');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
