// Offline production-build UI audit. Dedicated muted Chrome CDP :9233.
// node scripts/measure-full-audit.cjs <port> <output.json>
// API responses are fixtures; this cannot measure authenticated production latency.
const fs=require('node:fs');
const port=Number(process.argv[2]),out=process.argv[3];
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const at='2026-11-01T00:00:00.000Z',pixel='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="purple"/></svg>';
const media='/audit-fixture.mp4';
const run={id:id(0),title:'Audit video',createdAt:at,updatedAt:at,sourceRefId:null,
 hook:{mode:'upload',source:'describe',describe:'Audit motion',describeReady:true,text:'Audit text',clip:null,face:{kind:'character',id:'olivia'},generated:{src:media,seconds:3,at}},
 demo:{clip:null,frame:'none',mode:'clips',clips:[{id:'demo1',label:'Demo',src:media,seconds:6,start:0,end:3}]},
 texts:[{id:'hook',text:'Audit text',start:0,end:3,x:50,y:22,size:4.6,font:'Arial',color:'#ffffff',style:'outline'}],sounds:[],project:null,
 product:{at,brief:{name:'Audit',what:'Tool',audience:'Sellers',benefit:'Save time',features:[]}}};
const refs=Array.from({length:60},(_,n)=>({id:id(n+100),createdAt:at,title:'Audit hook '+n,owner:'curated',platform:'instagram',sourceUrl:'',mediaId:id(n+100)+'.mp4',views:1000,analysis:null,partial:true,thumbUrl:pixel,ai:{style:'text_music'}}));
const runs=Array.from({length:24},(_,n)=>({...run,id:id(n),title:'Audit video '+n,project:{unused:'x'.repeat(100000)},productScreens:[],script:{unused:'x'.repeat(10000)}}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const tabs=await(await fetch('http://localhost:9233/json')).json();
 const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let serial=0;const pending=new Map(),errors=[],requests=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 ws.addEventListener('message',e=>{
  const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method!=='Fetch.requestPaused')return;
  const {requestId,request}=m.params,u=new URL(request.url);
  const fire=(method,p)=>void send(method,p).catch(()=>{});
  if(!['localhost','127.0.0.1'].includes(u.hostname)){fire('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return}
  if(!u.pathname.startsWith('/api/')){fire('Fetch.continueRequest',{requestId});return}
  let body={},status=200;
  if(u.pathname==='/api/runs'){
   if(request.method==='POST')body={...run,id:JSON.parse(request.postData||'{}').id||id(99)};
   else if(u.searchParams.get('view')==='faces')body=runs.map(r=>({id:r.id,createdAt:r.createdAt,updatedAt:r.updatedAt,hook:{face:r.hook.face,generated:r.hook.generated}}));
   else if(u.searchParams.get('view')==='history')body=runs.map(({project,script,product,productScreens,...r})=>r);
   else if(u.searchParams.get('view')==='summary')body=runs.map(r=>({...r,project:undefined,script:undefined,product:r.product?.brief?{brief:{}}:null,texts:undefined}));
   else body=runs;
  }else if(/^\/api\/runs\/[^/]+$/.test(u.pathname))body=request.method==='PATCH'?{...run,...JSON.parse(request.postData||'{}')}:run;
  else if(u.pathname==='/api/references')body=refs;
  else if(u.pathname==='/api/assets')body=[];
  else if(u.pathname==='/api/file-prefs')body={names:{},hidden:[]};
  else if(u.pathname==='/api/profile')body={email:'audit@invalid.test',firstName:'Audit',lastName:'',avatar:''};
  else if(u.pathname==='/api/usage')body={plan:'starter',limit:20,used:0};
  else if(u.pathname.startsWith('/api/media/')){status=404;}
  const bytes=Buffer.byteLength(JSON.stringify(body));requests.push({path:u.pathname+u.search,method:request.method,bytes,fixtureDelayMs:120});
  setTimeout(()=>fire('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}),120);
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Emulation.setCPUThrottlingRate',{rate:2});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.__renders={};window.__seeks=0;window.__videoFrames=0;
 const ct=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...ct,set(v){window.__seeks++;ct.set.call(this,v)}});
 window.__tasks=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__tasks.push(e.duration))).observe({type:'longtask',buffered:true});
 window.__videoCreated=0;const make=document.createElement.bind(document);document.createElement=function(tag,...a){if(tag==='video')window.__videoCreated++;return make(tag,...a)};
 `});
 const rows=[],actions=[];
 const wait=async expr=>{for(let i=0;i<100;i++){if(await ev(expr))return;await sleep(100)}throw Error('Not ready: '+expr)};
 const nav=async(path,cold)=>{
  await send('Network.setCacheDisabled',{cacheDisabled:cold});
  if(cold)await send('Network.clearBrowserCache');
  await send('Page.navigate',{url:'about:blank'});await sleep(80);
  const start=Date.now();await send('Page.navigate',{url:'http://localhost:'+port+path});
  await wait(`location.pathname===${JSON.stringify(path)} && document.readyState==='complete' && ${path==='/studio'? "Array.from(document.querySelectorAll('a')).some(x=>x.getAttribute('href')==='/studio/"+id(0)+"')" : "Array.from(document.querySelectorAll('input')).some(x=>x.value==='Audit video')"}`);
  const stats=await ev(`(()=>{const rs=performance.getEntriesByType('resource');return {fp:performance.getEntriesByName('first-paint')[0]?.startTime,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,usableMs:performance.now(),jsTransferBytes:rs.filter(r=>r.initiatorType==='script').reduce((n,r)=>n+r.transferSize,0),jsEncodedBytes:rs.filter(r=>r.initiatorType==='script').reduce((n,r)=>n+r.encodedBodySize,0),api:rs.filter(r=>r.name.includes('/api/')).map(r=>({path:new URL(r.name).pathname,duration:r.duration,serverTiming:r.serverTiming})),videos:document.querySelectorAll('video').length,tasks:window.__tasks}})()`);
  rows.push({path,cold,wallMs:Date.now()-start,...stats});
 };
 const click=async(name,expr)=>{
  const result=await ev(`(async()=>{const el=${expr};if(!el)return {missing:true};el.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const start=performance.now();if(el.getAttribute('role')==='button' && !['BUTTON','A'].includes(el.tagName)){el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}else el.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-start,videos:document.querySelectorAll('video').length}})()`);
  actions.push({name,...result});await sleep(200);
 };
 for(let round=0;round<3;round++){
  await nav('/studio',true);await nav('/studio',false);
  if(!process.env.LOADS_ONLY)await click('New video',`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('New video'))`);
  await nav('/studio/'+id(0),true);await nav('/studio/'+id(0),false);await sleep(700);
  if(process.env.LOADS_ONLY)continue;
  for(let n=0;n<6;n++)await click('Step '+(n+1),`document.querySelectorAll('section > button[aria-expanded]')[${n}]`);
  await click('Choose your character',`Array.from(document.querySelectorAll('button')).find(x=>/Choose.*character|Browse characters|Change character/.test(x.textContent))`);
  await ev(`document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()`);
  await ev('window.__beforeProfile={...window.__renders}');
  await click('Phone play',`document.querySelector('aside button[aria-label="Play"]')`);
  await sleep(1000);actions.push({name:'Phone frame renders',...await ev('Object.fromEntries(Object.entries(window.__renders).map(([k,v])=>[k,v-(window.__beforeProfile[k]||0)]))')});await ev(`document.querySelector('aside button[aria-label="Pause"]')?.click()`);
  await click('My files',`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='My files')`);
  await sleep(1700);
  for(const text of ['Generated hooks','Characters','Demos','Uploaded','Music','Hooks','Exported']){
   await click('My files '+text,`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)}) && x.className.includes('border-b-2'))`);
  }
  await ev(`Array.from(document.querySelectorAll('button[aria-label="Close"]')).at(-1)?.click()`);
  await click('Edit video',`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Edit video')`);
  await sleep(900);
  await ev('window.__beforeProfile={...window.__renders}');
  await click('Editor play',`document.querySelector('[role="dialog"] button[aria-label="Play"]')`);
  await sleep(1000);actions.push({name:'Editor frame renders',...await ev('Object.fromEntries(Object.entries(window.__renders).map(([k,v])=>[k,v-(window.__beforeProfile[k]||0)]))')});await ev(`document.querySelector('[role="dialog"] button[aria-label="Pause"]')?.click()`);
  await click('Select clip',`document.querySelector('[role="dialog"] [role="button"][aria-label="Clip: Hook"]')`);
  const pointer=await ev(`(async()=>{
   const e=document.querySelector('[role="dialog"] [aria-label="Trim clip end"]');if(!e)return {missing:true};
   const r=e.getBoundingClientRect(),start=performance.now();
   e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+2,clientY:r.y+4,pointerId:1}));
   window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x-12,clientY:r.y+4,pointerId:1}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const ms=performance.now()-start;window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));return {ms};
  })()`);
  actions.push({name:'Drag timeline handle',...pointer});
  await click('Select text',`document.querySelector('[role="dialog"] [role="button"][aria-label^="Text:"]')`);
  const typed=await ev(`(async()=>{const el=Array.from(document.querySelectorAll('[role="dialog"] textarea,[role="dialog"] input[type="text"],[role="dialog"] input:not([type])')).find(e=>e.value==='Audit text');if(!el)return {missing:true,fields:Array.from(document.querySelectorAll('[role=\"dialog\"] input,[role=\"dialog\"] textarea')).map(e=>({value:e.value,type:e.type}))};el.focus();const set=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;const start=performance.now();set.call(el,'Audit text edited');el.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-start}})()`);
  actions.push({name:'Type text',...typed});
  const seek=await ev(`(async()=>{const el=Array.from(document.querySelectorAll('[role="slider"]')).find(e=>e.getAttribute('aria-label')==='Preview time');if(!el)return {missing:true};const start=performance.now();el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-start}})()`);
  actions.push({name:'Seek',...seek});
  actions.push({name:'Editor inspection',...await ev(`({videos:document.querySelectorAll('video').length,created:window.__videoCreated,seeks:window.__seeks,decodedBytes:Array.from(document.querySelectorAll('video')).map(v=>v.webkitVideoDecodedByteCount||0),sliders:Array.from(document.querySelectorAll('[role="slider"]')).map(x=>x.getAttribute('aria-label')),buttons:Array.from(document.querySelectorAll('[role="dialog"] button')).map(x=>x.getAttribute('aria-label')||x.textContent.trim()).filter(Boolean)})`)});
  await ev(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(x=>x.textContent.trim()==='Done')?.click()`);
  await click('Viral library',`Array.from(document.querySelectorAll('a')).find(x=>x.getAttribute('href')==='/library')`);
  await wait(`location.pathname==='/library' && Array.from(document.querySelectorAll('button')).some(x=>x.textContent.includes('Use this hook'))`);

 }
 await send('Page.navigate',{url:'about:blank'});await send('Fetch.disable');ws.close();
 const result={setup:'Actual Next production build, proxy bypassed only in isolated copy; synthetic 24 runs and 60 curated refs, API stubs 120ms, Chrome muted, CPU 2x, desktop 1440x1000. FCP is paint timing, usable is control readiness, not formal TTI. Two rAF is a conservative click-to-paint proxy.',rows,actions,requests,errors};
 fs.writeFileSync(out,JSON.stringify(result,null,2));if(errors.length||actions.some(a=>a.missing))process.exitCode=1;console.log(JSON.stringify({loads:rows.length,actions:actions.length,missing:actions.filter(a=>a.missing).map(a=>a.name),errors}));
}
main().catch(e=>{console.error(e);process.exit(1)});
