// Offline regression tests. Every storage/provider dependency is explicitly stubbed.
const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const crypto=require('node:crypto'),path=require('node:path');
async function prefs(){
 let value={names:{},hidden:[]},version=0,conflicts=0;
 const api=load('src/lib/server/store.ts',{
  'node:crypto':crypto,'node:fs/promises':{},'node:path':path,
  '@/lib/supabase/server':{authEnabled:()=>true},
  '@/lib/server/r2':{r2Enabled:()=>true,signedGet:async()=>'/fixture',
   putObjectIfUnchanged:async(key,bytes,mime,etag)=>{
    assert.equal(key,'prefs/owner/files.json');assert.equal(mime,'application/json');
    if(etag!==String(version)){conflicts++;return false}
    value=JSON.parse(bytes.toString());version++;return true;
   }},
 },{}, {fetch:async()=>{
  const snapshot=JSON.stringify(value),etag=String(version);
  await new Promise(r=>setTimeout(r,5));
  return new Response(snapshot,{headers:{etag}});
 }});
 await Promise.all([api.changeFilePrefs('owner','a',{name:'Alpha'}),api.changeFilePrefs('owner','b',{name:'Beta'}),api.changeFilePrefs('owner','c',{hidden:true})]);
 assert.deepEqual(value,{names:{a:'Alpha',b:'Beta'},hidden:['c']});assert.ok(conflicts>0);
 await api.changeFilePrefs('owner','a',{name:''});await api.changeFilePrefs('owner','c',{hidden:false});
 assert.deepEqual(value,{names:{b:'Beta'},hidden:[]});
 // My files multi-select Delete: several keys hidden in one write, alongside a concurrent single change.
 await Promise.all([api.changeFilePrefs('owner',['x','y','z'],{hidden:true}),api.changeFilePrefs('owner','w',{hidden:true})]);
 assert.deepEqual(new Set(value.hidden),new Set(['x','y','z','w']));assert.deepEqual(value.names,{b:'Beta'});
}
async function lists(){
 const stamp='2026-11-01T00:00:00Z',item={id:'a',createdAt:stamp,updatedAt:stamp,title:'Video',sourceRefId:null,hook:{face:{kind:'character',id:'olivia'},generated:{src:'/clip',seconds:3},versions:[]},demo:{clip:null,clips:[]},texts:[],sounds:[],exports:[],project:{large:'x'.repeat(100000)},script:{large:'x'.repeat(20000)},product:{privateContext:'not needed'}};
 let hosted=false,selects=[],filters=[];
 const chain={select(s){selects.push(s);return this},eq(k,v){filters.push([k,v]);return this},or(){return this},order(){return this},limit(){return Promise.resolve({data:[],error:null})}};
 const api=load('src/lib/server/list-pages.ts',{
  '@/lib/server/covers':{coverLinks:async()=>new Map()},
  '@/lib/server/store':{cloud:()=>hosted,listRuns:async()=>[item],listReferences:async()=>[],listAssets:async()=>[]},
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>({from:()=>chain})},
 });
 const metrics={fullBytes:Buffer.byteLength(JSON.stringify([item]))};
 for(const view of ['faces','history']){
  const page=await api.listPage('runs','owner',new Request('http://fixture?view='+view));
  const result=page.items[0];assert.equal(result.project,undefined);assert.equal(result.script,undefined);assert.equal(result.product,undefined);
  assert.equal(result.hook.face.id,'olivia');assert.equal(result.hook.generated.src,'/clip');
  if(view==='history'){assert.deepEqual(result.texts,[]);assert.deepEqual(result.exports,[])}
  metrics[view+'Bytes']=Buffer.byteLength(JSON.stringify(page.items));
  hosted=true;await api.listPage('runs','owner',new Request('http://fixture?view='+view));hosted=false;
  assert.ok(!selects.at(-1).includes('project')&&!selects.at(-1).includes('script'));
  assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='owner'));
 }
 console.log('Projection fixture:',JSON.stringify(metrics));
}
async function conditionalWrites(){
 let behavior=412,commands=[];
 class PutObjectCommand{constructor(input){this.input=input}}
 class S3Client{async send(command){commands.push(command.input);if(behavior)throw {$metadata:{httpStatusCode:behavior}};return {}}}
 const api=load('src/lib/server/r2.ts',{
  '@/lib/production-config':{assertProductionConfig(){}},
  '@/lib/server/work-budget':{workSignal:()=>undefined},
  'node:fs':{},'node:stream':{},'node:stream/promises':{},
  '@aws-sdk/client-s3':{S3Client,PutObjectCommand},
  '@aws-sdk/s3-request-presigner':{},
 });
 assert.equal(await api.putObjectIfUnchanged('key',Buffer.from('x'),'application/json','v1'),false);
 assert.equal(commands.at(-1).IfMatch,'v1');
 behavior=0;assert.equal(await api.putObjectIfUnchanged('key',Buffer.from('x'),'application/json',null),true);
 assert.equal(commands.at(-1).IfNoneMatch,'*');
 behavior=403;await assert.rejects(api.putObjectIfUnchanged('key',Buffer.from('x'),'application/json',null));
}
async function analysisCleanup(){
 const log=[],listeners=new Map();
 const video={crossOrigin:"",muted:false,preload:"",playsInline:false,
  set src(value){queueMicrotask(()=>listeners.get('error')?.())},
  addEventListener(event,fn){listeners.set(event,fn)},removeEventListener(event,fn){if(listeners.get(event)===fn)listeners.delete(event)},
  pause(){log.push('pause')},removeAttribute(key){log.push('remove '+key)},load(){log.push('load')}};
 const api=load('src/lib/analyze.ts',{'@/lib/filmstrip':{pixelLink:async()=>'/fixture'}},{},{document:{createElement:()=>video}});
 await assert.rejects(api.analyzeVideo('/fixture'),/Could not read/);
 assert.deepEqual(log,['pause','remove src','load']);assert.equal(listeners.size,0);
}
async function oversizedScreens(){
 let downloads=0;
 const route=load('src/app/api/runs/[id]/script/route.ts',{
  '@/lib/server/ai-budget':{beginAI:async()=>({response:new Response(null,{status:402})})},
  '@/lib/server/gemini':{},
  '@/lib/server/store':{getRun:async()=>({id:'run',product:{brief:{}},productScreens:['big.mp4'],hook:{source:'describe',describe:'Action'}}),listReferences:async()=>[],mediaAccess:async()=>({size:300*1024*1024,mime:'video/mp4'}),mediaToFile:async()=>{downloads++;throw Error('Must not download')}},
  'node:fs/promises':require('node:fs/promises'),'node:os':require('node:os'),'node:path':require('node:path'),
  '@/lib/server/who':{currentUser:async()=> 'owner'},
 });
 const res=await route.POST(new Request('http://fixture'),{params:Promise.resolve({id:'run'})});
 assert.equal(res.status,402);assert.equal(downloads,0);
}
async function ownHistoryPick(){
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=fs.readFileSync('src/components/run-view.tsx','utf8');
 const tree=ts.createSourceFile('run-view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow;
 const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='pickHook')arrow=n.initializer;ts.forEachChild(n,visit)};visit(tree);
 let refs=[],saved;
 const hook={mode:'upload',clip:null,text:''},run={id:'run',title:'Existing',hook};
 const result={exports:{}};
 vm.runInNewContext(ts.transpileModule('exports.pickHook = '+arrow.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports:result.exports,Response,fetch:async()=>Response.json({id:'owned',owner:'user',title:'Own hook',analysis:null,recipe:{hook:{}}}),
  setRefs:update=>{refs=update(refs)},texts:[],hook,run,source:null,DEFAULT_HOOK_TEXT:'Default',
  timeline:()=>[{len:3}],save:patch=>{saved=patch},setPickerOpen(){},setPicked(){},requestScript(){},
 });
 await result.exports.pickHook({id:'owned',owner:'user',partial:true},'upload');
 assert.equal(refs[0].id,'owned');assert.ok(refs[0].recipe);assert.equal(saved.sourceRefId,'owned');
}
(async()=>{await ownHistoryPick();await oversizedScreens();await analysisCleanup();await prefs();await lists();await conditionalWrites();console.log('PASS: concurrent cross-instance preference CAS retries preserve edits; compact projections retain reuse data and owner filters; conditional storage errors fail closed')})().catch(e=>{console.error(e);process.exitCode=1});
