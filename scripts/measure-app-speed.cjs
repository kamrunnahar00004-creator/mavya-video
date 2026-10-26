// Fixture-only client timing. Run against isolated builds with their proxy disabled,
// never against a deployed app or an authenticated browser profile.
const fs=require('node:fs');
const id=i=>`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`, at='2026-10-26T00:00:00.000Z';
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=';
const refs=Array.from({length:60},(_,i)=>({id:id(i+100),createdAt:at,title:'Fixture hook '+i,platform:'instagram',sourceUrl:'https://fixture.invalid/video',views:5000000-i,mediaId:id(i+100)+'.mp4',mime:'video/mp4',owner:'curated',ai:{style:'text_music'},analysis:{duration:8,width:720,height:1280,segments:[{role:'hook',start:0,end:3,thumb:pixel}]},recipe:{unused:'x'.repeat(2000)},history:'x'.repeat(12000)}));
const runs=Array.from({length:60},(_,i)=>({id:id(i),createdAt:at,updatedAt:at,title:'Fixture video '+i,sourceRefId:refs[0].id,hook:{mode:'avatar',text:'Fixture text',clip:null,avatarIndex:null,variationIndex:null,start:0,end:3,source:'library',face:{kind:'character',id:'fixture'}},demo:{clip:null,frame:'none',clips:[]},sound:null,sounds:[],texts:[],project:{unused:'x'.repeat(20000)}}));
async function main(){
 const out=process.argv[2],tabs=await(await fetch('http://localhost:9231/json')).json();
 const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let n=0;const pending=new Map(),errors=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+':'+m.params.exceptionDetails.exception?.description);
  if(m.method!=='Fetch.requestPaused')return;
  const {requestId,request}=m.params,url=new URL(request.url),after=url.port==='3428';
  if(!['localhost','127.0.0.1'].includes(url.hostname)){void send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
  if(!url.pathname.startsWith('/api/')){void send('Fetch.continueRequest',{requestId});return;}
  let body={},headers=[{name:'Content-Type',value:'application/json'}],status=200;
  if(url.pathname==='/api/runs')body=after?runs.slice(0,24).map(({project,...r})=>({...r,cover:pixel})):runs;
  else if(url.pathname==='/api/references')body=after?refs.slice(0,24).map(({history,...r})=>r):refs;
  else if(/^\/api\/references\/[^/]+$/.test(url.pathname))body=refs.find(r=>r.id===url.pathname.split('/')[3])??refs[0];
  else if(/^\/api\/runs\/[^/]+$/.test(url.pathname))body=runs[0];
  else if(url.pathname.endsWith('/generate')||url.pathname.endsWith('/export'))body={};
  else if(url.pathname==='/api/profile')body={email:'fixture@invalid.test',firstName:'Fixture',lastName:'User',avatar:''};
  else if(url.pathname==='/api/usage')body={plan:'starter',limit:20,used:0,remaining:20};
  else if(url.pathname.startsWith('/api/media/')){status=404;body={};}
  else if(url.pathname==='/api/assets')body=[];
  const data=Buffer.from(JSON.stringify(body)).toString('base64');
  setTimeout(()=>void send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:headers,body:data}),120);
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setCPUThrottlingRate',{rate:2});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__usable=0;new MutationObserver(()=>{const p=location.pathname;const ready=p==='/library'?document.body?.innerText.includes('Fixture hook'):p==='/studio'?document.body?.innerText.includes('Fixture video'):Array.from(document.querySelectorAll('input')).some(x=>x.value==='Fixture video 0');if(ready&&!window.__usable)window.__usable=performance.now()}).observe(document,{subtree:true,childList:true,attributes:true});`});
 const rows=[];
 for(let round=0;round<3;round++)for(const port of [3427,3428])for(const path of ['/studio','/library','/studio/'+id(0)]){
  await send('Network.clearBrowserCache');await send('Page.navigate',{url:`http://localhost:${port}${path}`});await new Promise(r=>setTimeout(r,2400));
  const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const r=performance.getEntriesByType('resource');return {usable:window.__usable,jsBytes:r.filter(x=>x.initiatorType==='script').reduce((n,x)=>n+x.transferSize,0),fontBytes:r.filter(x=>/woff/.test(x.name)).reduce((n,x)=>n+x.transferSize,0),title:document.title,buttons:document.querySelectorAll('button').length}})()`});
  rows.push({round,phase:port===3427?'before':'after',path,...result.result.value});
 }
 const median=v=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)],summary={};
 for(const phase of ['before','after'])for(const path of [...new Set(rows.map(r=>r.path))])summary[phase+':'+path]=Object.fromEntries(['usable','jsBytes','fontBytes'].map(k=>[k,median(rows.filter(r=>r.phase===phase&&r.path===path).map(r=>r[k]))]));
 const data={setup:'Client fixtures only, proxy disabled in separate artifact copies, API replies stubbed at 120ms, 1440x1000, CPU 2x, cold cache, three rounds. No auth/backend latency certification.',rows,summary,errors};
 fs.writeFileSync(out,JSON.stringify(data,null,2));console.log(JSON.stringify(summary));console.log('browser errors:',errors.length);ws.close();if(rows.some(r=>!r.usable)||errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
