// Export waits for every clip's working copy, spinning with an estimate, and is clickable only once all are ready
// (founder 2026-11-11: "your clips are being processed" after clicking Export; "until it is ready, keep on spinning
// with an estimated timer. only when it is fully ready then one can click on export"). Checks the estimate
// (src/lib/copy-eta.ts), the route's ?copies= answer (src/app/api/runs/[id]/export/route.ts) and the button's wiring.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,finish}=require('./check-module.cjs');
let checks=0;const ok=(c,m)=>{checks++;assert.ok(c,m);};const eq=(a,b,m)=>{checks++;assert.equal(JSON.stringify(a),JSON.stringify(b),m);};
const MB=1_048_576;
finish('copy-wait-checks',22,()=>checks,async()=>{
  const e=load('src/lib/copy-eta.ts');
  const now=1_000_000_000;
  eq(e.copyEta([],now),0,'nothing pending: no wait');
  const one=e.copyEta([{size:38.9*MB,uploadedAt:now}],now);
  ok(one>=160&&one<=175,`a 38.9 MB iPhone clip just uploaded: about 167 s, as measured on production (${one})`);
  ok(Math.abs(e.copyEta([{size:38.9*MB,uploadedAt:now-60_000}],now)-(one-60))<=1,'time already spent counts down');
  const two=e.copyEta([{size:34.2*MB,uploadedAt:now},{size:38.9*MB,uploadedAt:now}],now);
  ok(two>=one+140,`two clips queue one after another (${two})`);
  eq(e.copyEta([{size:20*MB,uploadedAt:now-3_600_000}],now),e.COPY_ALMOST_SECONDS,'past its estimate but not ready: "almost", never 0 or negative');
  ok(e.copyEta([{size:1000,uploadedAt:now}],now)>=e.COPY_MIN_SECONDS,'a tiny clip still takes the minimum');
  eq(e.copyEtaLabel(167),'~2:50 left','label in minutes and seconds, rounded up to 5 s');
  eq(e.copyEtaLabel(10),'Almost ready','label at the end');
  eq(e.exportUploads([{id:'hook',src:'/api/media/h.mp4'},{id:'a',src:'/api/media/x.mov'},{id:'b',src:'/api/media/x.mov'},{id:'c',src:'/library/y.mp4'},{id:'d',src:null}]),['x.mov'],'only uploaded clips, never the hook, each once');

  // The route, with storage stubbed.
  const ID=n=>`${String(n).repeat(8)}-0000-4000-8000-000000000000.mov`;
  const files={[ID(1)]:{mime:'video/quicktime',size:38.9*MB,ready:false,mine:true},[ID(2)]:{mime:'video/mp4',size:10*MB,ready:true,mine:true},[ID(3)]:{mime:'video/quicktime',size:5*MB,ready:false,mine:false},[ID(4)]:{mime:'image/png',size:1*MB,ready:false,mine:true}};
  const asked=[];let isCloud=true;
  const db={from:()=>({select:()=>({eq:()=>({in:async(_c,ids)=>({data:ids.map(id=>({id,size:files[id].size,created_at:new Date(Date.now()).toISOString()})),error:null})})})})};
  const route=load('src/app/api/runs/[id]/export/route.ts',{
    'next/server':{after:()=>undefined},'@/lib/export-layers':{exportLayers:()=>[],exportWindow:()=>null},'@/lib/server/billing-state':{billingRpc:async()=>false},
    '@/lib/supabase/server':{createSupabaseAdminClient:()=>db},'@/lib/server/export-jobs':{advanceExport:async()=>{},cancelBrowserExport:async()=>{},exportJob:async()=>null},
    'node:crypto':require('node:crypto'),'@/lib/adjust':{fullAdjust:x=>x},'@/lib/edit':{segSpeed:()=>1,timeline:()=>[],videoLength:()=>0},
    '@/lib/server/store':{cloud:()=>isCloud,getRun:async()=>null,libraryLink:async()=>'',mediaAccess:async(id,who)=>files[id]&&who==='me'&&files[id].mine?{mime:files[id].mime,size:files[id].size}:null,mediaLink:async()=>'',mediaUploadLink:async()=>'',newUpload:()=>({mediaId:''})},
    '@/lib/server/who':{currentUser:async()=>'me',signInFirst:()=>new Response('',{status:401})},
    '@/lib/server/previews':{exportSource:async()=>'wait',masterKey:()=>'',masterReady:async id=>files[id].ready,requestPreview:async id=>{asked.push(id);}},
    '@/lib/server/r2':{signedGet:async()=>'',signedPut:async()=>''},'@/lib/sound':{pieceEnd:()=>0,soundPieces:()=>[]},
    '@/lib/render-limits':{RENDER_LIMITS:{width:720,height:1280,fps:30,seconds:180,overlays:200},renderLimitError:()=>null},
    '../../../../../../render/render.mjs':{demoAt:()=>null,planLength:()=>0},'@/lib/copy-eta':e,
  },{},{Date});
  const get=async q=>{const r=await route.GET(new Request(`https://x/api/runs/r/export?copies=${q}`),{params:Promise.resolve({id:'r'})});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};};
  let r=await get([ID(1),ID(2)].join(','));
  eq([r.status,r.body.pending],[200,1],'one clip without its copy: pending 1');
  ok(r.body.seconds>=160&&r.body.seconds<=175,`its estimate from the stored size (${r.body.seconds})`);
  eq(asked,[ID(1)],'the missing copy is asked for again');
  eq(r.cache,'no-store','never cached');
  r=await get(ID(2));eq(r.body,{pending:0,seconds:0},'every copy ready: Export can be clicked');
  r=await get(ID(3));eq(r.body.pending,0,"another user's file is never looked at (and never holds Export)");
  r=await get(ID(4));eq(r.body.pending,0,'a picture has no copy and never holds Export');
  r=await get('../../etc');eq(r.status,404,'only file ids');
  isCloud=false;r=await get(ID(1));eq(r.body.pending,0,'local development has no copies: never waits');isCloud=true;

  // The button.
  const b=fs.readFileSync('src/components/export-button.tsx','utf8');
  ok(/disabled=\{!ready \|\| busy \|\| preparing\}/.test(b),'Export cannot be clicked while a clip is being prepared');
  ok(/export\?copies=\$\{encodeURIComponent\(uploads\)\}/.test(b)&&/exportUploads\(timeline\(run,null\)/.test(b),"it asks about the editor's own clips (saved or not)");
  ok(!/setClear\(uploads\)[^\n]*\n[^\n]*\}\)\(\);/.test(b)&&(b.match(/setClear\(uploads\)/g)||[]).length===1,'only a confirmed "all ready" enables Export; failed checks keep it waiting');
  ok(/still being prepared\/\.test\(said\)\)\{[^}]*setClear\(null\);setRecheck/.test(b),'a refusal for clips not ready goes back to waiting with the timer, not a message');
});
