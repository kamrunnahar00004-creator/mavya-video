const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let record={id:'job',user_id:'owner',run_id:'run',media_id:'out.mp4',state:'running',created_at:new Date().toISOString(),cleaned:false,cleanup_cursor:0,overlay_ids:['1.png','2.png','3.png','4.png','5.png','6.png'],payload:{meta:{seconds:3},lane:'render'}};
 let events=[],append=0,head={size:100,mime:'video/mp4'},health={protocol:1},network=[],objects=null,copies=[];
 const db={from(table){return {update(p){this.patch=p;return this;},delete(){events.push(['metadata',table]);return this;},eq(){return this;},async select(){Object.assign(record,this.patch);return {data:[{id:'job'}]};},then(resolve){resolve({error:null});}};}};
 const info=async key=>objects?objects[key]??null:head;
 const api=load('src/lib/server/export-jobs.ts',{
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>db},
  '@/lib/server/billing-state':{billingRpc:async(name,args)=>{assert.equal(args.p_user,'owner');assert.equal(args.p_id,'job');if(record.cleaned)return null;record.lease_token='lease';return JSON.parse(JSON.stringify(record));}},
  '@/lib/server/account-state':{accountClosing:async()=>false},
  // These checks cover the Render worker path: the fast lane counts as already tried.
  '@/lib/server/fast-export':{callInternal:async()=>({ok:false}),FAST_MAX_STEPS:24},
  '../../../render/render.mjs':{plan:()=>[]},
  '@/lib/server/store':{getRun:async()=>({id:'run'}),registerMedia:async()=>events.push('register'),appendExport:async()=>{append++;return {src:'/api/media/out.mp4',seconds:3};}},
  '@/lib/server/r2':{objectInfo:info,deleteObjectStrict:async key=>{events.push(key);if(objects)delete objects[key];},copyObject:async(from,to,etag)=>{copies.push([from,to,etag]);objects[to]={...objects[from]};},objectStart:async key=>objects[key]?.bytes??new Uint8Array()}
 },{RENDER_URL:'https://fixture.invalid',RENDER_SECRET:'fixture-only'},{fetch:async(url,options)=>{network.push([url,options?.method]);return url.endsWith('/health')?Response.json(health):options?.method==='POST'?Response.json({id:'job'}):new Response(null,{status:404});}});
 // No fetch is available in this fixture: a finished R2 output recovers without any worker/browser state.
 await api.advanceExport('owner','job');assert.equal(record.state,'done');assert.equal(record.cleaned,false);assert.equal(record.cleanup_cursor,5);assert.equal(append,1);
 await api.advanceExport('owner','job');assert.equal(record.cleaned,true);assert.equal(append,1);assert.ok(events.includes('media/6.png'));
 await api.advanceExport('owner','job');assert.equal(append,1);
 record={...record,state:'pending',cleaned:false,overlay_ids:[],cleanup_cursor:0};head=null;
 await assert.rejects(api.advanceExport('owner','job'),/worker update required/);assert.equal(network.some(c=>c[1]==='POST'),false);
 // A protocol 3 worker that renders another frame size is not sent the job either.
 health={protocol:3,size:'720x1280'};await assert.rejects(api.advanceExport('owner','job'),/worker update required/);assert.equal(network.some(c=>c[1]==='POST'),false);
 health={protocol:3,size:'1080x1920'};await api.advanceExport('owner','job');assert.equal(record.state,'running');assert.equal(network.filter(c=>c[1]==='POST').length,1);

 // Browser lane: the upload is checked (promised size, MP4) and copied to the job's own key; the staging copy goes.
 const mp4=new Uint8Array([0,0,0,32,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d]);
 const browserJob=()=>{record={...record,state:'running',cleaned:false,result:null,payload:{meta:{seconds:3},lane:'browser',laneAt:Date.now(),upload:{key:'exports/job/upload.mp4',size:100}}};append=0;copies=[];};
 browserJob();objects={'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e1',bytes:mp4}};
 await api.advanceExport('owner','job');
 assert.deepEqual(copies,[['exports/job/upload.mp4','media/out.mp4','e1']]);assert.equal(objects['exports/job/upload.mp4'],undefined);assert.equal(record.state,'done');assert.equal(append,1);
 // Wrong size, or not an MP4: deleted, never copied, the job fails.
 for(const bad of [{size:99,mime:'video/mp4',etag:'e2',bytes:mp4},{size:100,mime:'video/mp4',etag:'e3',bytes:new Uint8Array(12)}]){
  browserJob();objects={'exports/job/upload.mp4':bad};
  await api.advanceExport('owner','job');
  assert.equal(copies.length,0);assert.equal(objects['exports/job/upload.mp4'],undefined);assert.equal(record.state,'failed');assert.equal(append,0);
 }
 // Already copied when a later step failed: a different upload since then can't fail the job or strand its file.
 browserJob();objects={'media/out.mp4':{size:100,mime:'video/mp4',etag:'e1'},'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e9',bytes:new Uint8Array(12)}};
 await api.advanceExport('owner','job');
 assert.equal(copies.length,0);assert.equal(objects['exports/job/upload.mp4'],undefined);assert.equal(record.state,'done');assert.equal(append,1);
 // Nothing uploaded yet: the job waits.
 browserJob();objects={};await api.advanceExport('owner','job');assert.equal(record.state,'running');
 // Cancel under the lease: a file that arrived keeps the job; with nothing uploaded it fails at once.
 browserJob();objects={'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e4',bytes:mp4}};
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'pending');assert.equal(record.state,'running');
 browserJob();objects={};
 assert.equal(await api.cancelBrowserExport('owner','other-run','job'),'pending');assert.equal(record.state,'running');
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'cancelled');assert.equal(record.state,'failed');
 console.log('PASS: durable export recovers from output without worker/browser, owned registration, single append, bounded resumable PNG cleanup, terminal replay, worker size check, checked browser uploads (copied file wins on retry) and leased cancel');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
