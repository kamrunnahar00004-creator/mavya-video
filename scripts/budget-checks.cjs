const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{execFileSync}=require('node:child_process'),{load}=require('./check-module.cjs');
async function main(){
 const api=load('src/lib/server/work-budget.ts',{'node:async_hooks':require('node:async_hooks')});
 let signal;
 await api.withWorkBudget(async()=>{signal=api.workSignal(100);await new Promise(r=>setTimeout(r,15));assert.equal(signal.aborted,true);assert.throws(()=>api.checkBudget());},5);
 api.checkBudget();assert.equal(api.workSignal(100).aborted,false);
 function prompts(source){
  const f=ts.createSourceFile('hookgen.ts',source,ts.ScriptTarget.Latest,true),out=[];
  const names=new Set(['MOTION','MOTION_FALLBACK','IMAGE_TO_VIDEO','TEXT_TO_VIDEO','DESCRIBED_SECONDS','MIN_REFERENCE','LOOK','MATCH','NEGATIVE','OUTFIT_SCHEMA','prompt','parts']);
  function visit(n){if(ts.isVariableDeclaration(n)&&names.has(n.name.getText(f)))out.push(n.getText(f));if(ts.isPropertyAssignment(n)&&n.name.getText(f)==='text')out.push(n.initializer.getText(f));ts.forEachChild(n,visit);}visit(f);return out;
 }
 assert.deepEqual(prompts(fs.readFileSync('src/lib/server/hookgen.ts','utf8')),prompts(execFileSync('git',['show','0b013a7:src/lib/server/hookgen.ts'],{encoding:'utf8'})));
 const glob=fs.readdirSync('src/app/api',{recursive:true}).filter(x=>String(x).endsWith('route.ts'));
 for(const f of glob){const source=fs.readFileSync(`src/app/api/${f}`,'utf8');for(const m of source.matchAll(/maxDuration\s*=\s*(\d+)/g))assert.ok(Number(m[1])<=300,f);}
 assert.equal(JSON.parse(fs.readFileSync('vercel.json')).crons[0].schedule,'* * * * *');
 console.log('PASS: isolated work deadline abort, unchanged Kling models/prompts, all function budgets <=300s and per-minute Pro recovery cron');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
