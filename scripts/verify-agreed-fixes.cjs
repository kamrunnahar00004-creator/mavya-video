// Only the four agreed fixes. No provider, credentials, real database, storage or account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm'),{performance}=require('node:perf_hooks'),{load}=require('./check-module.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const timing=load('src/lib/server/read-timing.ts',{'node:async_hooks':require('node:async_hooks'),'node:perf_hooks':{performance}});
const phases=header=>Object.fromEntries(header.split(', ').map(item=>{const m=/^(auth|account|sql|r2);dur=(\d+\.\d{2})$/.exec(item);assert.ok(m,header);return [m[1],+m[2]]}));
async function clocks(){
 const header=(await timing.readResponse(async()=>{
  await timing.readPhase('auth',()=>pause(4));
  await timing.readPhase('account',()=>timing.readPhase('sql',()=>pause(4)));
  await timing.readPhase('sql',()=>pause(4));await timing.readPhase('r2',()=>pause(4));
  return Response.json({ok:true});
 })).headers.get('Server-Timing');
 const values=phases(header);for(const value of Object.values(values))assert.ok(value>=2);
 const [slow,fast]=await Promise.all([
  timing.readResponse(async()=>{await timing.readPhase('r2',()=>pause(25));return Response.json({})}),
  timing.readResponse(async()=>{await timing.readPhase('auth',()=>pause(3));return Response.json({})})
 ]);
 assert.equal(phases(slow.headers.get('Server-Timing')).auth,0);
 assert.equal(phases(fast.headers.get('Server-Timing')).r2,0);
 const who=load('src/lib/server/who.ts',{
  '@/lib/server/read-timing':timing,
  '@/lib/supabase/server':{authEnabled:()=>true,getSessionUser:()=>timing.readPhase('sql',async()=>{await pause(4);return {id:'owner'}})},
  '@/lib/server/account-state':{accountClosing:()=>timing.readPhase('sql',async()=>{await pause(4);return false})}
 });
 const response=await timing.readResponse(async()=>{assert.equal(await who.currentUser(),'owner');return Response.json({})});
 const split=phases(response.headers.get('Server-Timing'));assert.ok(split.auth>=2&&split.account>=2);assert.equal(split.sql,0,'nested account/auth calls are not counted again as SQL');
}
async function routes(){
 let who='owner',missingRun=false,missingSource=false,sourceReads=0;
 const run={id:'run',sourceRefId:'reference',hook:{},demo:{}},reference={id:'reference',owner:'user'};
 const currentUser=async()=>{await timing.readPhase('auth',()=>pause(2));await timing.readPhase('account',()=>pause(2));return who};
 const common={
  '@/lib/server/read-timing':timing,'next/server':{connection:async()=>{}},
  '@/lib/server/who':{currentUser,signInFirst:()=>new Response(null,{status:401})},
  '@/lib/server/list-pages':{listPage:async()=>{await timing.readPhase('sql',()=>pause(2));return {items:[],next:null}},pageResponse:items=>Response.json(items),listError:()=>new Response(null,{status:503})},
  '@/lib/server/store':{getRun:async(id,owner)=>{assert.equal(owner,'owner');await timing.readPhase('sql',()=>pause(2));return missingRun?null:run},
   getReference:async(id,owner)=>{sourceReads++;assert.equal(owner,'owner');return missingSource?null:reference},
   getFilePrefs:async()=>{await timing.readPhase('r2',()=>pause(2));return {names:{},hidden:[]}}},
  '@/lib/server/run-validation':{},'@/lib/server/billing-state':{billingRow:async()=>null},
  '@/lib/server/usage':{allowance:async()=>({}),subscriptionOf:async()=>null},
  '@/lib/edit':{},'@/lib/taxonomy':{},
  'node:fs/promises':{},'node:path':path,
  '@/lib/profile':{NO_PROFILE:{}},
  '@/lib/supabase/server':{authEnabled:()=>true,getSessionUser:async()=>({id:'owner',email:'private-email'}),
   createSupabaseServerClient:async()=>({from:()=>({select(){return this},eq(){return this},maybeSingle:()=>timing.readPhase('sql',async()=>({data:{},error:null}))})})}
 };
 for(const route of ['profile','usage','runs','runs/[id]','references','assets','file-prefs']){
  const api=load('src/app/api/'+route+'/route.ts',common);
  const response=await api.GET(new Request('http://fixture/api/'+route),{params:Promise.resolve({id:'run'})});
  assert.equal(response.status,200,route);
  assert.deepEqual(Object.keys(phases(response.headers.get('Server-Timing'))),['auth','account','sql','r2']);
  assert.ok(!/owner|private-email|reference/.test(response.headers.get('Server-Timing')));
 }
 const api=load('src/app/api/runs/[id]/route.ts',common),ctx={params:Promise.resolve({id:'run'})};
 const combined=()=>api.GET(new Request('http://fixture/api/runs/run?view=editor'),ctx);
 assert.deepEqual(await(await combined()).json(),{run,source:reference});assert.equal(sourceReads,1);
 assert.equal((await combined()).headers.get('Cache-Control'),'private, no-store');
 sourceReads=0;await api.GET(new Request('http://fixture/api/runs/run'),ctx);assert.equal(sourceReads,0,'legacy run shape does not read the source');
 who=null;assert.equal((await combined()).status,401);
 who='owner';missingRun=true;assert.equal((await combined()).status,404);
 missingRun=false;missingSource=true;assert.equal((await combined()).status,404,'foreign/missing source is not exposed');
}
function callbacks(base,env){
 const text=fs.readFileSync(path.join(base,'src/components/run-view.tsx'),'utf8'),tree=ts.createSourceFile('run-view.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['onGenerated','liveTexts','commitTexts','liveAdjust']),items=[];
 function visit(n){if(ts.isVariableDeclaration(n)&&names.has(n.name.getText(tree)))items.push('exports.'+n.name.getText(tree)+' = '+n.initializer.getText(tree)+';');ts.forEachChild(n,visit)}visit(tree);
 const exports={};vm.runInNewContext(ts.transpileModule(items.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...env,exports});return exports;
}
async function dirtyEdits(){
 const clientStubs={'@/lib/studio-data':{DEFAULT_FONT:'Arial'}};
 const adjust=load('src/lib/adjust.ts'),edit=load('src/lib/edit.ts',{'@/lib/adjust':adjust});
 for(const mode of ['text','adjust','both','demo'])for(const arrival of [100,249]){
  let now=0,serial=0,timers=new Map(),sent=[];
  const timer=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id},clear=id=>timers.delete(id);
  const client=load('src/lib/client.ts',clientStubs,{}, {setTimeout:timer,clearTimeout:clear,fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'run'})}});
  const gen=load('src/lib/generation-edit.ts',{'@/lib/client':client,'@/lib/adjust':adjust,'@/lib/edit':edit,'@/lib/studio-data':{DEFAULT_FONT:'Arial'}});
  const layer={id:'hook',text:'Old',start:0,end:6,x:50,y:22,size:4.6,font:'Arial',style:'outline',color:'#fff'};
  let state={id:'run',hook:{mode:'upload',text:'Old',clip:null,generated:{src:'/api/media/40000000-0000-4000-8000-000000000001.mp4',seconds:6,at:'2026-11-01T00:00:00Z'},start:0,end:6,adjust:{speed:1}},demo:{clip:null,frame:'none',clips:[{id:'demo',label:'Demo',src:'/api/media/50000000-0000-4000-8000-000000000001.mp4',seconds:3,start:0,end:3}]},texts:[layer]},ref={current:state};
  const saveTimer={current:null},adjustTimer={current:null};
  const api=callbacks(process.cwd(),{useCallback:fn=>fn,flushSync:fn=>fn(),setRun:fn=>{state=fn(state)},runRef:ref,id:'run',saveTimer,adjustTimer,
   ...client,...adjust,...edit,...gen,setTimeout:timer,clearTimeout:clear});
  const tick=async until=>{while(true){const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();for(let i=0;i<8;i++)await Promise.resolve()}now=until};
  const stale=structuredClone(state);stale.hook.generated={src:'/api/media/40000000-0000-4000-8000-000000000002.mp4',seconds:4.737,at:'2026-11-01T00:00:00Z'};stale.hook.end=4.737;stale.texts[0].end=4.737;stale.hook.text='Server suggested';stale.texts[0].text='Server suggested';
  if(mode==='text'||mode==='both'){api.liveTexts(texts=>texts.map(t=>({...t,text:'Unsaved words',x:61})));api.commitTexts()}
  if(mode!=='text')api.liveAdjust(mode==='demo'?'demo':'hook',{speed:1.5,brightness:12});
  ref.current=state; // Normal edit commit effect, before the completion arrives.
  await tick(arrival);api.onGenerated(stale);
  // Deliberately do not run the normal runRef effect after completion: the timer must still read the merged result.
  assert.equal(state.hook.generated.src,'/api/media/40000000-0000-4000-8000-000000000002.mp4');
  if(mode==='text'||mode==='both')assert.equal(state.texts[0].text,'Unsaved words');
  if(mode==='adjust'||mode==='both')assert.equal(state.hook.adjust.speed,1.5);
  if(mode==='demo')assert.equal(state.demo.clips[0].adjust.speed,1.5);
  if(mode==='adjust'||mode==='demo')assert.equal(state.texts[0].text,'Server suggested','unchanged words still take the authoritative completion');
  await tick(750);
  assert.ok(sent.length>0,'real patchRun save queue reaches HTTP transport');
  const last=sent.at(-1);assert.equal(load('src/lib/server/run-validation.ts',{'@/lib/client':client,'../../../render/constraints.json':require('../render/constraints.json')}).validRunPatch(last),true);assert.equal(last.hook.generated.src,'/api/media/40000000-0000-4000-8000-000000000002.mp4');
  if(mode==='text'||mode==='both')assert.equal(last.texts[0].text,'Unsaved words');
  if(mode==='adjust'||mode==='both')assert.equal(last.hook.adjust.brightness,12);
  if(mode==='demo')assert.equal(last.demo.clips[0].adjust.brightness,12);
 }
}
(async()=>{await clocks();await routes();await dirtyEdits();console.log('PASS: all seven timed reads, request isolation/no secret labels, unchanged owner denial, combined load compatibility; actual edit/completion/debounce/save-HTTP order at100/249ms preserves dirty text/adjustments')})().catch(e=>{console.error(e);process.exitCode=1});
