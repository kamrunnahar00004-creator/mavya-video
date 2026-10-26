const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let replies=[];
 const stubs={
  '@/lib/server/work-budget':{checkBudget(){},withWorkBudget:f=>f(),workSignal:()=>AbortSignal.timeout(1000)},
  'node:child_process':{execFile(){}},'node:crypto':require('node:crypto'),'node:fs/promises':{mkdtemp:async()=>'/fixture',rm:async()=>{}},'node:module':require('node:module'),'node:os':require('node:os'),'node:path':require('node:path'),'node:util':require('node:util'),
  '@/lib/server/gemini':{},'@/lib/server/r2':{},'@/lib/server/store':{}
  ,'@/lib/supabase/server':{}
 };
 const api=load('src/lib/server/hookgen.ts',stubs,{FAL_KEY:'fixture-only'},{fetch:async()=>replies.shift()});
 let sent=0;
 const noKey=load('src/lib/server/hookgen.ts',stubs,{}, {fetch:async()=>{sent++;throw Error('unexpected network');}});
 await assert.rejects(noKey.startHook({hook:{face:{kind:'described',text:'fixture person'}}},null,'owner'),error=>!(error instanceof noKey.HookStartUncertain)&&/FAL_KEY/.test(error.message));
 assert.equal(sent,0);
 const missingSource=load('src/lib/server/hookgen.ts',{
  ...stubs,'@/lib/server/store':{libraryFile:async()=>null,mediaToFile:async()=>null}
 },{FAL_KEY:'fixture-only'},{fetch:async()=>{throw Error('must not submit');}});
 await assert.rejects(missingSource.startHook({hook:{source:'library',face:{kind:'described',text:'fixture person'}}},{sourceUrl:'https://fixture.invalid/clip123',mediaId:'fixture'},'owner'),/reference video is unavailable/);
 await assert.rejects(missingSource.startHook({hook:{source:'upload',face:{kind:'described',text:'fixture person'}}},null,'owner'),/reference video is unavailable/);
 const short=Buffer.alloc(36);short.write('mvhd',4);short[8]=1;assert.equal(api.mp4Seconds(short),null);
 const box=(type,data)=>{const b=Buffer.alloc(8+data.length);b.writeUInt32BE(b.length);b.write(type,4);data.copy(b,8);return b;};
 const header=Buffer.alloc(100);header.writeUInt32BE(1000,12);header.writeUInt32BE(3250,16);
 const fake=Buffer.alloc(100);fake.write('mvhd',4);fake.writeUInt32BE(1,20);fake.writeUInt32BE(999,24);
 const real=box('moov',box('mvhd',header));
 assert.equal(api.mp4Seconds(Buffer.concat([box('mdat',fake),real])),3.25);
 assert.equal(api.mp4Seconds(Buffer.concat([real,box('mdat',fake)])),3.25);
 const extended=Buffer.alloc(16);extended.writeUInt32BE(1);extended.write('moov',4);extended.writeBigUInt64BE(BigInt(16+real.length-8),8);
 assert.equal(api.mp4Seconds(Buffer.concat([extended,real.subarray(8)])),3.25);
 assert.equal(api.mp4Seconds(real.subarray(0,real.length-1)),null);
 replies=[Response.json({})];await assert.rejects(api.startHook({hook:{face:{kind:'described',text:'fixture person'},describe:'fixture action'}},null,'owner'),error=>error instanceof api.HookStartUncertain);
 replies=[Response.json({status:'UNKNOWN'})];await assert.rejects(api.checkHook('fal-ai/model|fixture'),/Unknown provider status/);
 replies=[Response.json({status:'COMPLETED'}),new Response('temporary',{status:503})];await assert.rejects(api.checkHook('fal-ai/model|fixture'),/unavailable/);
 replies=[Response.json({status:'COMPLETED'}),new Response('{"video":')];await assert.rejects(api.checkHook('fal-ai/model|fixture'),SyntaxError);
 replies=[Response.json({status:'COMPLETED'}),Response.json({})];await assert.rejects(api.checkHook('fal-ai/model|fixture'),/incomplete/);
 replies=[Response.json({status:'COMPLETED'}),Response.json({detail:'safety refusal'},{status:422})];assert.equal((await api.checkHook('fal-ai/model|fixture')).state,'failed');
 for(const code of [400,422]){
  replies=[Response.json({status:'COMPLETED'}),new Response('provider refusal',{status:code})];assert.equal((await api.checkHook('fal-ai/model|fixture')).state,'failed');
 }
 let probeText='Duration: 00:00:07.25',probes=0,cleaned=0;
 const probeApi=load('src/lib/server/hookgen.ts',{
  ...stubs,'node:module':{createRequire:()=>()=>'/fixture/ffmpeg'},
  'node:child_process':{execFile(_bin,_args,options,cb){probes++;assert.equal(options.timeout,20000);cb(Object.assign(Error('probe exits without output'),{stderr:probeText}));}},
  'node:fs/promises':{mkdtemp:async()=>'/fixture/probe',writeFile:async()=>{},rm:async()=>{cleaned++;}}
 },{FAL_KEY:'fixture-only'},{fetch:async()=>replies.shift()});
 async function result(video){replies=[Response.json({status:'COMPLETED'}),Response.json({video:{url:'https://fixture.invalid/result'}}),new Response(video)];return probeApi.checkHook('fal-ai/model|fixture');}
 assert.equal((await result(real)).seconds,3.25);assert.equal(probes,0);
 const zero=Buffer.from(real);zero.writeUInt32BE(0,32);assert.equal(probeApi.mp4Seconds(zero),null);
 assert.equal((await result(zero)).seconds,7.25);assert.equal(probes,1);assert.equal(cleaned,1);
 probeText='Duration: N/A';await assert.rejects(result(Buffer.from('unknown')),/duration is unavailable/);assert.equal(cleaned,2);
 probeText='';await assert.rejects(result(Buffer.from('timeout')),/duration is unavailable/);assert.equal(cleaned,3);
 console.log('PASS: truncated MP4 v1 header is safe, unknown provider status and transient result failure never become paid fallbacks');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
