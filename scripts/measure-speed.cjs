// Manual local-only benchmark: node scripts/measure-speed.cjs <Next port> <output.json>.
// Start an isolated muted headless Chrome with --remote-debugging-port=9231 first.
const fs=require('node:fs');
async function main(){
 const port=Number(process.argv[2]??3417),out=process.argv[3];
 const tabs=await(await fetch('http://localhost:9231/json')).json();
 const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Fetch.requestPaused'){
  const {requestId,request}=m.params;const url=new URL(request.url);
  void send(['localhost','127.0.0.1'].includes(url.hostname)?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(['localhost','127.0.0.1'].includes(url.hostname)?{}:{errorReason:'BlockedByClient'})});
 }});
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setCPUThrottlingRate',{rate:2});
 await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__speed={lcp:0,cls:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.__speed.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__speed.cls+=e.value}).observe({type:'layout-shift',buffered:true});`});
 const rows=[];
 for(let round=0;round<3;round++)for(const path of ['/','/pricing']){
  await send('Network.clearBrowserCache');await send('Page.navigate',{url:`http://localhost:${port}${path}`});
  await new Promise(r=>setTimeout(r,3500));
  const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{document.querySelectorAll('video,audio').forEach(v=>{v.muted=true;v.pause()});const resources=performance.getEntriesByType('resource');return {...window.__speed,path:location.pathname,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,jsBytes:resources.filter(r=>r.initiatorType==='script').reduce((n,r)=>n+r.transferSize,0),imageBytes:resources.filter(r=>r.initiatorType==='img'||/\\.(jpg|webp|png)(\\?|$)/.test(r.name)).reduce((n,r)=>n+r.transferSize,0),fontBytes:resources.filter(r=>/woff/.test(r.name)).reduce((n,r)=>n+r.transferSize,0),fontRequests:resources.filter(r=>/woff/.test(r.name)).length,mediaBytes:resources.filter(r=>/\\.(mp4|webm)(\\?|$)/.test(r.name)).reduce((n,r)=>n+r.transferSize,0),mediaRequests:resources.filter(r=>/\\.(mp4|webm)(\\?|$)/.test(r.name)).length,dom:performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd}})()`});
  rows.push({round,...result.result.value});
 }
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const summary=Object.fromEntries(['/','/pricing'].map(path=>[path,Object.fromEntries(['lcp','cls','jsBytes','mediaBytes','mediaRequests','imageBytes','fontBytes','fontRequests','dom'].map(key=>[key,median(rows.filter(r=>r.path===path).map(r=>r[key]))]))]));
 const data={setup:'local production, cold browser cache, 375x900, 2x CPU, 3.5s observation, external requests blocked',rows,summary};
 if(out)fs.writeFileSync(out,JSON.stringify(data,null,2));console.log(JSON.stringify(summary));ws.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
