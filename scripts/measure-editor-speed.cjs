// Local decoded-text/timeline benchmark using the installed production React.
// Usage: node scripts/measure-editor-speed.cjs <baseline checkout> <output.json>
// Requires muted Chrome CDP on localhost:9231. No media/network/provider calls.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),before=process.argv[2];
const compile=(text,file)=>ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function bodies(base,phase){
 const preview=fs.readFileSync(path.join(base,'src/components/run-preview.tsx'),'utf8').replace('  // While resizing:', '  globalThis.__bodies.overlay++;\n  // While resizing:');
 const file=phase==='before'?'run-view.tsx':'editor-tools.tsx',source=fs.readFileSync(path.join(base,'src/components',file),'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Filmstrip'||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name?.text==='Filmstrip'));
 const film=node.getText(ast).replace('const key = times.join', 'globalThis.__bodies.film++; const key = times.join');
 return {preview:compile(preview,'run-preview.tsx'),film:compile('import {memo,useState,useEffect} from "react"; import {frameAt} from "@/lib/filmstrip";\n'+film+'\nexport {Filmstrip};',file)};
}
async function main(){
 const modules={};
 for(const [id,file] of Object.entries({'react':'react/cjs/react.production.js','react/jsx-runtime':'react/cjs/react-jsx-runtime.production.js','react-dom':'react-dom/cjs/react-dom.production.js','react-dom/client':'react-dom/cjs/react-dom-client.production.js','scheduler':'scheduler/cjs/scheduler.production.js'}))modules[id]=fs.readFileSync(path.join(root,'node_modules',file),'utf8');
 modules['@/lib/text-styles']=compile(fs.readFileSync(path.join(root,'src/lib/text-styles.ts'),'utf8'),'text-styles.ts');
 const payload={modules,before:bodies(before,'before'),after:bodies(root,'after')};
 const tabs=await(await fetch('http://localhost:9231/json')).json(),ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
 await send('Emulation.setCPUThrottlingRate',{rate:2});
 const result=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`(async()=>{
 const payload=${JSON.stringify(payload)},cache={};
 const stubs={
 "@/lib/client":{round1:x=>Math.round(x*10)/10},
 "@/lib/studio-data":{fontCss:()=> "Arial",loadFonts:()=>{}},
 "@/lib/filmstrip":{frameAt:async()=>null}
 };
 function require(id){
  if(stubs[id])return stubs[id]; if(cache[id])return cache[id].exports;
  if(!payload.modules[id])return {};
  const module={exports:{}};cache[id]=module;new Function("require","module","exports","process",payload.modules[id])(require,module,module.exports,{env:{NODE_ENV:"production"}});return module.exports;
 }
 const React=require("react"),dom=require("react-dom"),client=require("react-dom/client"),rows=[];
 const load=code=>{const module={exports:{}};new Function("require","module","exports",code)(require,module,module.exports);return module.exports;};
 for(let round=0;round<3;round++)for(const phase of ["before","after"]){
  globalThis.__bodies={overlay:0,film:0};
  const {TextOverlay}=load(payload[phase].preview),{Filmstrip}=load(payload[phase].film);
  const element=document.createElement("div");element.style.cssText="position:fixed;left:-10000px;width:320px;height:560px;container-type:size";document.body.appendChild(element);const root=client.createRoot(element);
  const texts=Array.from({length:200},(_,i)=>({id:"t"+i,text:"Fixture caption",font:"Arial",size:4,x:50,y:50,color:"#fff",style:"plain"}));
  const tree=()=>React.createElement("div",null,...texts.map(x=>React.createElement(TextOverlay,{key:x.id,x})),...Array.from({length:40},(_,i)=>React.createElement(Filmstrip,{key:"f"+i,src:"fixture",times:[0,1,2,3,4,5,6,7],frame:40})));
  dom.flushSync(()=>root.render(tree()));const start=performance.now();
  for(let i=0;i<60;i++)dom.flushSync(()=>root.render(tree()));
  rows.push({phase,round,ms:performance.now()-start,...globalThis.__bodies});
  dom.flushSync(()=>root.unmount());element.remove();
 }
 const median=v=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)];
 return {setup:"Production React, 2x CPU, 200 stable overlays + 40 filmstrips, initial mount + 60 parent updates, three rounds; no media decoded or fetched",rows,summary:Object.fromEntries(["before","after"].map(phase=>[phase,Object.fromEntries(["ms","overlay","film"].map(k=>[k,median(rows.filter(r=>r.phase===phase).map(r=>r[k]))]))]))};
 })()`});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??JSON.stringify(result.exceptionDetails));
 const data=result.result.value;fs.writeFileSync(process.argv[3],JSON.stringify(data,null,2));console.log(JSON.stringify(data.summary));ws.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
