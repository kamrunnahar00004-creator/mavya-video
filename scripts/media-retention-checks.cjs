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
 console.log('PASS: cloud asset removal only unlists assets; no capped reference scans or destructive media/R2 deletion');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
