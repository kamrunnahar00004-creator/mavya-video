const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 const tables=[];
 const store=load('src/lib/server/store.ts',{
  'node:crypto':require('node:crypto'),'node:fs/promises':{},'node:path':require('node:path'),
  '@/lib/server/r2':{r2Enabled:()=>true},
  '@/lib/supabase/server':{authEnabled:()=>true,createSupabaseAdminClient:()=>({from(table){tables.push(table);return {delete(){return this;},eq(){return this;},then(resolve){resolve({error:null});}};}})}
 });
 await store.deleteAsset('10000000-0000-4000-8000-000000000001.png','owner');
 assert.deepEqual(tables,['assets']);
 let fail=false,putFail=false;const order=[];
 const upload=load('src/lib/server/store.ts',{
  'node:crypto':require('node:crypto'),'node:fs/promises':{},'node:path':require('node:path'),
  '@/lib/server/r2':{r2Enabled:()=>true,putObject:async()=>{order.push('put');if(putFail)throw Error('unknown PUT result');}},
  '@/lib/supabase/server':{authEnabled:()=>true,createSupabaseAdminClient:()=>({from:table=>({insert:async()=>{order.push(table);return {error:fail?Error('Account deletion in progress'):null};}})})}
 });
 const file={type:'audio/mpeg',name:'fixture.mp3',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
 await upload.saveMedia(file,false,'owner');assert.deepEqual(order,['media','put']);
 order.length=0;fail=true;await assert.rejects(upload.saveMedia(file,false,'owner'),/deletion/);assert.deepEqual(order,['media']);
 order.length=0;fail=false;putFail=true;await assert.rejects(upload.saveMedia(file,false,'owner'),/unknown PUT/);assert.deepEqual(order,['media','put']);
 console.log('PASS: cloud asset removal only unlists assets; no capped reference scans or destructive media/R2 deletion');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
