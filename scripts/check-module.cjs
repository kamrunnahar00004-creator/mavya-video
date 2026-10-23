const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
exports.load=(file,stubs={},env={})=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
  module,exports:module.exports,require(id){if(id==='server-only')return {};if(Object.hasOwn(stubs,id))return stubs[id];throw Error(`Unstubbed import: ${id}`);},
  Buffer,Response,Request,URL,AbortSignal,TextEncoder,process:{env},setTimeout,clearTimeout,console:{error(){}}
 },{filename:file});return module.exports;
};
