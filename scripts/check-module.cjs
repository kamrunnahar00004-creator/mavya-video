const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
exports.load=(file,stubs={},env={},globals={})=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module,exports:module.exports,require(id){if(id==='server-only')return {};if(Object.hasOwn(stubs,id))return stubs[id];throw Error(`Unstubbed import: ${id}`);},
  Buffer,Response,Request,URL,AbortSignal,TextEncoder,process:{env,cwd:()=>process.cwd()},setTimeout,clearTimeout,console:{error(){}},...globals
 },{filename:file});return module.exports;
};
