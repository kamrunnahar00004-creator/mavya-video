const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let replies=[];
 const api=load('src/lib/server/hookgen.ts',{
  '@/lib/server/work-budget':{checkBudget(){},withWorkBudget:f=>f(),workSignal:()=>AbortSignal.timeout(1000)},
  'node:child_process':{execFile(){}},'node:crypto':require('node:crypto'),'node:fs/promises':{mkdtemp:async()=>'/fixture',rm:async()=>{}},'node:module':require('node:module'),'node:os':require('node:os'),'node:path':require('node:path'),'node:util':require('node:util'),
  '@/lib/server/gemini':{},'@/lib/server/r2':{},'@/lib/server/store':{}
 },{FAL_KEY:'fixture-only'},{fetch:async()=>replies.shift()});
 const short=Buffer.alloc(36);short.write('mvhd',4);short[8]=1;assert.equal(api.mp4Seconds(short),null);
 replies=[Response.json({})];await assert.rejects(api.startHook({hook:{face:{kind:'described',text:'fixture person'},describe:'fixture action'}},null,'owner'),error=>error instanceof api.HookStartUncertain);
 replies=[Response.json({status:'UNKNOWN'})];await assert.rejects(api.checkHook('fal-ai/model|fixture'),/Unknown provider status/);
 replies=[Response.json({status:'COMPLETED'}),new Response('temporary',{status:503})];await assert.rejects(api.checkHook('fal-ai/model|fixture'),/unavailable/);
 console.log('PASS: truncated MP4 v1 header is safe, unknown provider status and transient result failure never become paid fallbacks');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
