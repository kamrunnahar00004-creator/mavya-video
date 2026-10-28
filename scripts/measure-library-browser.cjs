// Offline manual browser check. Dedicated muted Chrome :9232, credential-free fixture server only.
const fs=require('node:fs'),id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=';
const refs=Array.from({length:2000},(_,n)=>({id:id(n+100),owner:'curated',partial:true,title:'Fixture hook '+n,platform:'instagram',sourceUrl:'',mediaId:id(n+100)+'.mp4',mime:'video/mp4',views:n,createdAt:'2026-10-28',ai:{style:n%2?'talking':'text_music'},analysis:null,thumbUrl:pixel}));
async function main(){
 const tabs=await(await fetch('http://localhost:9232/json')).json(),ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map(),errors=[],calls=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return;}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);if(m.method!=='Fetch.requestPaused')return;
  const {requestId,request}=m.params,u=new URL(request.url);const deliver=(method,params)=>void send(method,params).catch(()=>{});
  if(!['localhost','127.0.0.1'].includes(u.hostname))return deliver('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
  if(!u.pathname.startsWith('/api/'))return deliver('Fetch.continueRequest',{requestId});
  calls.push({path:u.pathname,method:request.method});let body={},code=200;
  if(u.pathname==='/api/references')body=refs;
  else if(u.pathname==='/api/runs')body=[];
  else if(u.pathname==='/api/profile')body={email:'fixture@invalid.test',firstName:'Fixture',lastName:'User',avatar:''};
  else if(u.pathname==='/api/usage')body={plan:'starter',used:0,limit:20};
  else if(u.pathname.startsWith('/api/media/'))code=404;
  deliver('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setCPUThrottlingRate',{rate:1});await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const ready=async()=>{for(let i=0;i<100;i++){await sleep(100);if(await evaluate(`!!document.querySelector('[data-hook-index]')`).catch(()=>false))return;}throw Error('Library never loaded');};
 await send('Page.navigate',{url:'about:blank'});await sleep(150);await send('Page.bringToFront');
 await send('Page.navigate',{url:'http://localhost:3461/library'});await ready();
 const initial=await evaluate(`({cards:document.querySelectorAll('[data-hook-index]').length,rect:(()=>{const r=document.querySelector('[data-hook-index]').getBoundingClientRect();return {width:r.width,height:r.height}})()})`);
 if(initial.cards>=2000)throw Error('All cards mounted initially');
 await evaluate(`document.querySelector('[data-hook-index="32"]').focus()`);await sleep(100);
 const focus=await evaluate(`({cards:document.querySelectorAll('[data-hook-index]').length,index:document.activeElement.getAttribute('data-hook-index')})`);
 if(focus.cards<96||focus.index!=='32')throw Error('Focus did not append ahead without losing focus '+JSON.stringify({initial,focus}));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 const tab=await evaluate(`document.activeElement.getAttribute('data-hook-index')`);if(tab!=='33')throw Error('Tab traversal skipped cards: '+tab);
 for(let i=0;i<100;i++){const count=await evaluate(`(()=>{const card=document.querySelector('main .card');card.scrollTop=card.scrollHeight;return document.querySelectorAll('[data-hook-index]').length})()`);if(count===2000)break;await sleep(100);}
 const end=await evaluate(`({count:document.querySelectorAll('[data-hook-index]').length,unique:new Set(Array.from(document.querySelectorAll('[data-hook-index]')).map(b=>b.getAttribute('data-hook-index'))).size})`);if(end.count!==2000||end.unique!==2000)throw Error('Scrolling lost or duplicated records');
 await evaluate(`document.querySelector('main .card').scrollTop=0;Array.from(document.querySelectorAll('[role="tab"]')).find(b=>b.textContent==='Voiceover').click()`);await sleep(150);
 const filtered=await evaluate(`({cards:document.querySelectorAll('[data-hook-index]').length,first:document.querySelector('[data-hook-index] img')?.getAttribute('src'),views:document.querySelector('[data-hook-index]').textContent})`);
 if(filtered.cards>=1000||!filtered.views.replaceAll('.0','').includes('2K'))throw Error('Filtered full-catalog sorting failed');
 await evaluate(`document.querySelector('a[href="/studio"]').click()`);
 let restored=null;
 for(let i=0;i<100;i++){await sleep(100);restored=await evaluate(`(()=>{const content=document.querySelector('[data-route-content]');return {path:location.pathname,inert:content?.inert,visibility:content?getComputedStyle(content).contentVisibility:null}})()`).catch(()=>null);if(restored?.path==='/studio'&&!restored.inert&&restored.visibility==='visible')break;}
 if(restored?.path!=='/studio'||restored.inert||restored.visibility!=='visible')throw Error('Destination stayed hidden/inert');
 const result={initial,focus,tab,end,filtered,restored,errors,apiCalls:calls,scope:'Offline actual SourcePicker: 2000 rows, scroll/focus/tab/filter, no provider/media playback'};
 fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await send('Page.navigate',{url:'about:blank'});await sleep(100);await send('Fetch.disable');ws.close();if(errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exit(1);});
