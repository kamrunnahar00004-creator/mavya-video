const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
exports.load=(file,stubs={},env={},globals={})=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module,exports:module.exports,require(id){if(id==='server-only')return {};if(Object.hasOwn(stubs,id))return stubs[id];if(id==='@/lib/server/read-timing')return {readPhase:(_phase,work)=>work(),readResponse:work=>work()};if(id.endsWith('/render/constraints.json'))return require('../render/constraints.json');if(id==='@/lib/render-limits')return exports.load('src/lib/render-limits.ts');if(id==='@/lib/server/first-frame')return exports.load('src/lib/server/first-frame.ts');throw Error(`Unstubbed import: ${id}`);},
  Buffer,Response,Request,URL,AbortSignal,TextEncoder,process:{env,cwd:()=>process.cwd()},setTimeout,clearTimeout,queueMicrotask,console:{error(){}},...globals
 },{filename:file});return module.exports;
};
/**
 * Ends an async check file safely (Codex 2026-11-07: a never-settling promise let Node exit 0 with no checks run).
 * Fails unless `work` settles within `ms` and exactly `expected` checks ran; `count()` reads the file's counter.
 */
exports.finish=(name,expected,count,work,ms=60000)=>{
 let done=false;
 process.exitCode=1;
 const watchdog=setTimeout(()=>{console.error(`${name}: did not finish within ${ms} ms (${count()} of ${expected} checks ran)`);process.exit(1);},ms);
 process.on('exit',()=>{if(!done){console.error(`${name}: exited before finishing (${count()} of ${expected} checks ran)`);process.exitCode=1;}});
 Promise.resolve().then(work).then(()=>{
  clearTimeout(watchdog);
  if(count()!==expected){console.error(`${name}: ${count()} checks ran, expected ${expected}`);process.exit(1);}
  done=true;process.exitCode=0;console.log(`${name}: ${count()} checks pass`);
 },(e)=>{clearTimeout(watchdog);console.error(e);process.exit(1);});
};
