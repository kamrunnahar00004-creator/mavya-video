const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let record={id:'job',user_id:'owner',run_id:'run',media_id:'out.mp4',state:'running',created_at:new Date().toISOString(),cleaned:false,cleanup_cursor:0,overlay_ids:['1.png','2.png','3.png','4.png','5.png','6.png'],payload:{meta:{seconds:3},lane:'render'}};
 let busy=0,last=null,events=[],append=0,head={size:100,mime:'video/mp4'},health={protocol:1},network=[],objects=null,copies=[];
 let beforeWrite=null;
 // A read (select, then maybeSingle) gets the record; an update lands unless the updated_at it was guarded by is stale.
 const db={from(table){return {filters:{},update(p){this.patch=p;return this;},delete(){events.push(['metadata',table]);return this;},eq(k,v){this.filters[k]=v;return this;},or(){return this;},select(){if(!this.patch)return this;beforeWrite?.();if(Object.hasOwn(this.filters,'updated_at')&&this.filters.updated_at!==record.updated_at)return Promise.resolve({data:[],error:null});Object.assign(record,this.patch);return Promise.resolve({data:[{id:'job'}]});},maybeSingle(){return Promise.resolve({data:JSON.parse(JSON.stringify(record)),error:null});},then(resolve){resolve({error:null});}};}};
 const info=async key=>objects?objects[key]??null:head;
 const api=load('src/lib/server/export-jobs.ts',{
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>db},
  '@/lib/server/billing-state':{billingRpc:async(name,args)=>{assert.equal(args.p_user,'owner');assert.equal(args.p_id,'job');if(busy>0){busy--;return null;}if(record.cleaned)return null;record.lease_token='lease';return JSON.parse(JSON.stringify(record));}},
  '@/lib/server/account-state':{accountClosing:async()=>false},
  '@/lib/export-alive':load('src/lib/export-alive.ts'),
  // These checks cover the Render worker path: the fast lane counts as already tried.
  '@/lib/server/fast-export':{callInternal:async()=>({ok:false}),FAST_MAX_STEPS:24},
  '../../../render/render.mjs':{plan:()=>[]},
  '@/lib/server/store':{getRun:async()=>({id:'run'}),registerMedia:async()=>events.push('register'),appendExport:async(_run,_media,result)=>{append++;last=result;return result;}},
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
 // The demo part: promoted like the video, registered, kept on the export; a bad demo is only left out.
 const demoJob=()=>{browserJob();record.payload.meta={seconds:3,demoMediaId:'demo.mp4',demoSeconds:2};record.payload.demoUpload={key:'exports/job/demo.mp4',size:50};};
 demoJob();objects={'exports/job/demo.mp4':{size:50,mime:'video/mp4',etag:'d1',bytes:mp4},'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e1',bytes:mp4}};events=[];
 await api.advanceExport('owner','job');
 assert.equal(record.state,'done');assert.equal(JSON.stringify(last.demo),JSON.stringify({src:'/api/media/demo.mp4',seconds:2}));assert.ok(objects['media/demo.mp4']);assert.equal(events.filter(e=>e==='register').length,2);
 demoJob();objects={'exports/job/demo.mp4':{size:49,mime:'video/mp4',etag:'d2',bytes:mp4},'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e1',bytes:mp4}};
 await api.advanceExport('owner','job');
 assert.equal(record.state,'done');assert.equal(last.demo,undefined);assert.equal(objects['media/demo.mp4'],undefined);
 // A failed export's demo file is removed.
 demoJob();objects={'media/demo.mp4':{size:50,mime:'video/mp4',etag:'d3'},'exports/job/upload.mp4':{size:99,mime:'video/mp4',etag:'e2',bytes:mp4}};
 await api.advanceExport('owner','job');await api.advanceExport('owner','job');
 assert.equal(record.state,'failed');assert.equal(objects['media/demo.mp4'],undefined);
 // Nothing uploaded yet: the job waits.
 browserJob();objects={};await api.advanceExport('owner','job');assert.equal(record.state,'running');
 // Cancel under the lease: a file that arrived keeps the job; with nothing uploaded it fails at once.
 browserJob();objects={'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e4',bytes:mp4}};
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'pending');assert.equal(record.state,'running');
 browserJob();objects={};
 assert.equal(await api.cancelBrowserExport('owner','other-run','job'),'pending');assert.equal(record.state,'running');
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'cancelled');assert.equal(record.state,'failed');
 // Founder 2026-11-15: the page was changed to Scheduled posts mid-export and the export hung 15 minutes.
 // The cron holds the lease for a moment every few seconds: a cancel arriving then waits for it, never "pending".
 browserJob();objects={};busy=2;
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'cancelled');assert.equal(record.state,'failed');assert.equal(busy,0);
 browserJob();objects={};busy=50;
 assert.equal(await api.cancelBrowserExport('owner','run','job'),'pending');assert.equal(record.state,'running');busy=0;
 // A live upload is noted (time and how much is sent); only the job's own run and a browser job.
 browserJob();record.progress=0;objects={};
 const before=Date.now();
 assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),true);
 assert.ok(record.payload.aliveAt>=before&&record.payload.lane==='browser'&&record.payload.upload.key==='exports/job/upload.mp4');
 assert.ok(Math.abs(record.progress-0.955)<1e-9);
 assert.equal(await api.noteBrowserAlive('owner','run','job',0.1),true);assert.ok(Math.abs(record.progress-0.955)<1e-9,'progress never steps back');
 assert.equal(await api.noteBrowserAlive('owner','run','job',null),true);assert.ok(Math.abs(record.progress-0.955)<1e-9);
 browserJob();assert.equal(await api.noteBrowserAlive('owner','other-run','job',0.5),false);assert.equal(record.payload.aliveAt,undefined);
 browserJob();record.payload.lane='render';assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),false);assert.equal(record.payload.aliveAt,undefined);
 browserJob();record.state='done';assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),false);
 // Lock-free (Codex 2026-11-15): never takes the lease, so a ping that dies can't block the job. It skips while
 // someone holds the lease, or when the job changed after it was read.
 browserJob();busy=50;assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),true);assert.equal(busy,50);busy=0;
 browserJob();record.lease_until=new Date(Date.now()+60_000).toISOString();assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),false);assert.equal(record.payload.aliveAt,undefined);
 browserJob();record.lease_until=new Date(Date.now()-60_000).toISOString();assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),true);
 browserJob();record.lease_until=null;record.updated_at='2026-11-15T07:00:00.000Z';beforeWrite=()=>{record.updated_at='2026-11-15T07:00:01.000Z';};
 assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),false);assert.equal(record.payload.aliveAt,undefined);beforeWrite=null;
 assert.equal(await api.noteBrowserAlive('owner','run','job',0.5),true);assert.ok(record.payload.aliveAt>0&&record.updated_at!=='2026-11-15T07:00:01.000Z');
 // A tab that stopped telling (closed or reloaded): its job ends 3 minutes later, not 15.
 browserJob();objects={};record.payload.aliveAt=Date.now()-4*60_000;
 await api.advanceExport('owner','job');assert.equal(record.state,'failed');
 browserJob();objects={};record.payload.aliveAt=Date.now()-60_000;
 await api.advanceExport('owner','job');assert.equal(record.state,'running');
 // An older page that never tells keeps the 15 minutes; past them every browser job ends.
 browserJob();objects={};record.payload.laneAt=Date.now()-5*60_000;
 await api.advanceExport('owner','job');assert.equal(record.state,'running');
 browserJob();objects={};record.payload.laneAt=Date.now()-16*60_000;record.payload.aliveAt=Date.now();
 await api.advanceExport('owner','job');assert.equal(record.state,'failed');
 // A quiet browser whose file did arrive: the file wins, the job finishes.
 browserJob();objects={'exports/job/upload.mp4':{size:100,mime:'video/mp4',etag:'e5',bytes:mp4}};record.payload.aliveAt=Date.now()-4*60_000;
 await api.advanceExport('owner','job');assert.equal(record.state,'done');
 // The rule itself.
 const al=load('src/lib/export-alive.ts'),t=1e12;
 assert.equal(al.browserGone({laneAt:t},t+14*60_000),false);assert.equal(al.browserGone({laneAt:t},t+15*60_000+1),true);
 assert.equal(al.browserGone({laneAt:t,aliveAt:t+60_000},t+60_000+3*60_000),false);assert.equal(al.browserGone({laneAt:t,aliveAt:t+60_000},t+60_000+3*60_000+1),true);
 assert.equal(al.browserGone({},t),true);assert.equal(al.browserGone({laneAt:'x',aliveAt:'y'},t),true);
 assert.equal(al.uploadProgress(0),0.92);assert.equal(al.uploadProgress(1),0.99);assert.equal(al.uploadProgress(-1),0.92);assert.equal(al.uploadProgress(5),0.99);
 // The route: a live-upload note needs a job id and comes before the hook check, like cancel.
 const route=require('node:fs').readFileSync('src/app/api/runs/[id]/export/route.ts','utf8');
 const ai=route.indexOf('body?.mode === "alive"'),hi=route.indexOf('if (!run.hook.generated)');
 assert.ok(ai>0&&ai<hi&&/mode === "alive"[\s\S]{0,200}\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(body\.job\)/.test(route)&&/noteBrowserAlive\(who, id, body\.job, sent\)/.test(route));
 console.log('PASS: durable export recovers from output without worker/browser, owned registration, single append, bounded resumable PNG cleanup, terminal replay, worker size check, checked browser uploads (copied file wins on retry), the demo part, leased cancel (waits out a busy lease), live-upload notes, and a quiet tab ending its job in 3 minutes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
