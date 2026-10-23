const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let reservation=null,head={size:10,mime:'image/png',etag:'version'},events=[];
 const api=load('src/lib/server/uploads.ts',{
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>({})},
  '@/lib/server/billing-state':{billingRpc:async name=>{events.push(name);return name==='mavya_claim_upload'?reservation:true;}},
  '@/lib/server/store':{newUpload(){throw Error('unexpected');}},
  '@/lib/server/r2':{objectInfo:async()=>head,copyObject:async(...args)=>events.push(args),deleteObjectStrict(){throw Error('unexpected');},signedPut(){throw Error('unexpected');}}
 });
 await assert.rejects(api.finishUpload('foreign','id','image/png',null));assert.equal(events.length,1);
 reservation={mime:'image/png',state:'pending',declared_size:10,staging_key:'tmp/id',lease_token:'lease'};
 head.size=11;events=[];await assert.rejects(api.finishUpload('owner','id','image/png',null));assert.equal(events.some(Array.isArray),false);
 head.size=10;events=[];await api.finishUpload('owner','id','image/png',null);
 assert.equal(JSON.stringify(events.find(Array.isArray)),JSON.stringify(['tmp/id','media/id','version']));
 reservation.state='done';events=[];await api.finishUpload('owner','id','image/png',null);assert.equal(events.length,1);
 console.log('PASS: unreserved/foreign finish rejected, exact HEAD size/type, immutable conditional copy, finalized replay');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
