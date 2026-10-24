// Offline synthetic media verification. No browser, playback, network or user files.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
async function main(){
 const {plan,stepArgs,finalArgs}=await import('../render/render.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mavya-verify-media-'));
 const ff=require('ffmpeg-static');
 const run=args=>execFileSync(ff,['-nostdin','-y','-v','error',...args],{timeout:60000,maxBuffer:8*1024*1024});
 try{
  const source=path.join(dir,'source.mp4'),png=path.join(dir,'text.png');
  run(['-f','lavfi','-i','color=black:s=720x1280:r=30.30:d=2.1','-f','lavfi','-i','sine=frequency=440:duration=2.1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  run(['-f','lavfi','-i','color=red:s=40x40','-frames:v','1','-threads','1',png]);
  const spec={width:720,height:1280,fps:30,total:2,segments:[{gap:0,speed:1,volume:1,look:null,pieces:[{start:0,end:0.99},{start:0.99,end:2}]}],sounds:[],overlays:[{x:0,y:0,start:0,end:0.3},{x:0,y:0,start:0.99,end:1.4},{x:0,y:0,start:1.7,end:2}]};
  const files=plan(spec).map((step,i)=>{const file=path.join(dir,`step${i}.mkv`);run(stepArgs(spec,step,{file:source,hasAudio:true,duration:2.1},file));return file;});
  const list=path.join(dir,'list.txt');fs.writeFileSync(list,files.map(file=>`file '${file}'`).join('\n'));
  const out=path.join(dir,'out.mp4');run(finalArgs(spec,list,{sounds:[],overlays:spec.overlays.map(()=>png)},out));
  for(const [at,red] of [[0.1,true],[0.5,false],[1.1,true],[1.5,false],[1.9,true]]){
   const pixel=run(['-ss',String(at),'-i',out,'-vf','crop=2:2:10:10','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
   assert.equal(pixel[0]>150 && pixel[1]<60 && pixel[2]<60,red,`overlay at ${at}`);
  }
  const audio=run(['-i',out,'-map','0:a','-f','s16le','-ar','48000','-ac','1','pipe:1']);
  assert.ok(audio.length/96000>=1.98 && audio.length/96000<=2.05,'audio duration preserved');
  assert.ok(audio.some(byte=>byte!==0),'audio is audible data, without playing it');
  const frames=run(['-i',out,'-map','0:v','-vf','scale=2:2','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  assert.equal(frames.length/12,60,'two seconds at 30fps');
  spec.overlays=Array.from({length:12},(_,i)=>({x:i*40,y:0,start:i/10,end:2}));
  run(finalArgs(spec,list,{sounds:[],overlays:spec.overlays.map(()=>png)},path.join(dir,'many.mp4')));
  // Exercise the actual fallback duration probe on generated media, with all HTTP stubbed.
  const {load}=require('./check-module.cjs');
  const movie=fs.readFileSync(out),at=movie.indexOf('mvhd');assert.ok(at>0);movie.writeUInt32BE(0,at+20);
  const replies=[Response.json({status:'COMPLETED'}),Response.json({video:{url:'https://fixture.invalid/out'}}),new Response(movie)];
  const hook=load('src/lib/server/hookgen.ts',{
   '@/lib/server/work-budget':{checkBudget(){},withWorkBudget:f=>f(),workSignal:()=>AbortSignal.timeout(1000)},
   '@/lib/supabase/server':{},'@/lib/server/gemini':{},'@/lib/server/r2':{},'@/lib/server/store':{},
   ...Object.fromEntries(['child_process','crypto','fs/promises','module','os','path','util'].map(name=>['node:'+name,require('node:'+name)]))
  },{FAL_KEY:'fixture-only'},{fetch:async()=>replies.shift()});
  assert.equal(hook.mp4Seconds(movie),null);
  const measured=await hook.checkHook('fal-ai/model|fixture');assert.equal(measured.state,'done');assert.ok(Math.abs(measured.seconds-2)<0.05);
  console.log('PASS: real silent offline 720p ffmpeg export, 30.30fps piece boundary, start/end overlays, inactive intervals and two-second audio');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
