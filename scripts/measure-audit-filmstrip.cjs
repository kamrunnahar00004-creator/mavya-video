// Manual Chrome CDP :9233, actual bounded decoder code and synthetic 720p media in the isolated baseline server.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/filmstrip.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const tabs=await(await fetch('http://localhost:9233/json')).json(),ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));let serial=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}});
 await send('Page.enable');await send('Page.navigate',{url:'http://localhost:3470/audit-filmstrip-blank.html'});await new Promise(r=>setTimeout(r,700));
 const reply=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
  const videos=[],create=document.createElement.bind(document);document.createElement=function(tag,...a){const el=create(tag,...a);if(tag==='video')videos.push(el);return el};
  const module={exports:{}};new Function('module','exports',${JSON.stringify(code)})(module,module.exports);
  const times=[.25,.75,1.25,1.75,2.25,2.75],start=performance.now();
  const frames=await Promise.all(times.map(t=>module.exports.frameAt('/audit-filmstrip720.mp4',t)));
  const ms=performance.now()-start,again=performance.now();
  const cached=await Promise.all(times.map(t=>module.exports.frameAt('/audit-filmstrip720.mp4',t)));
  return {setup:'Actual filmstrip module, six 32px tile samples across a synthetic 3s/720p clip, shared decoder, no R2/auth test',frames:frames.filter(Boolean).length,uniqueFrames:new Set(frames).size,decoderElements:videos.length,decodedWidths:videos.map(v=>v.videoWidth),decodedHeights:videos.map(v=>v.videoHeight),firstMs:ms,cachedMs:performance.now()-again,cacheSame:frames.every((f,i)=>f===cached[i]),decodedByteCounter:videos.map(v=>v.webkitVideoDecodedByteCount||null),decodedMemoryBytes:null};
 })()`});
 if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);
 if(reply.result.value.frames!==6||!reply.result.value.cacheSame)throw Error('Filmstrip fixture did not decode all frames');
 fs.writeFileSync(process.argv[2],JSON.stringify(reply.result.value,null,2));console.log(JSON.stringify(reply.result.value));await send('Page.navigate',{url:'about:blank'});ws.close();
})().catch(e=>{console.error(e);process.exitCode=1});
