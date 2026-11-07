const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{execFileSync}=require('node:child_process'),{load}=require('./check-module.cjs');
async function main(){
 const api=load('src/lib/server/work-budget.ts',{'node:async_hooks':require('node:async_hooks')});
 let signal;
 await api.withWorkBudget(async()=>{signal=api.workSignal(100);await new Promise(r=>setTimeout(r,15));assert.equal(signal.aborted,true);assert.throws(()=>api.checkBudget());},5);
 api.checkBudget();assert.equal(api.workSignal(100).aborted,false);
 function prompts(source){
  const f=ts.createSourceFile('hookgen.ts',source,ts.ScriptTarget.Latest,true),out=[];
  const names=new Set(['MOTION','MOTION_FALLBACK','IMAGE_TO_VIDEO','TEXT_TO_VIDEO','DESCRIBED_SECONDS','MIN_REFERENCE','LOOK','MATCH','NEGATIVE','OUTFIT_SCHEMA','prompt','parts']);
  // The first-frame swap moved to src/lib/server/first-frame.ts and changed on purpose (founder 2026-11-07: the
  // character's room must never leak into the hook; tested in first-frame-checks). Kling's models and prompts stay frozen.
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.getText(f)==='swapFirstFrame')return;if(ts.isVariableDeclaration(n)&&names.has(n.name.getText(f)))out.push(n.getText(f));if(ts.isPropertyAssignment(n)&&n.name.getText(f)==='text')out.push(n.initializer.getText(f));ts.forEachChild(n,visit);}visit(f);return out;
 }
 // The approved changes to the frozen Kling prompts since 0b013a7: the eyes and face sentences in MATCH (founder 2026-11-07).
 const EYES=" The eyes follow the reference video's eyes exactly: they look into the camera lens whenever the reference's do, and look away only when, where and as far as the reference's do. The face matches the reference's in every frame: the same mouth shape, eyebrow position and eye opening at the same intensity, never bigger and never smaller; no smile, frown, surprise or other expression the reference does not show at that moment.";
 const frozen=prompts(execFileSync('git',['show','0b013a7:src/lib/server/hookgen.ts'],{encoding:'utf8'})).map(x=>x.startsWith('MATCH =')?x.replace('no extra gestures, no overacting.','no extra gestures, no overacting.'+EYES):x);
 // The caption removal before the swap (founder's hook 2026-11-07) is first-frame.ts's CLEAN_PROMPT, tested in first-frame-checks.
 assert.deepEqual(prompts(fs.readFileSync('src/lib/server/hookgen.ts','utf8')).filter(x=>x!=='CLEAN_PROMPT'),frozen);
 const glob=fs.readdirSync('src/app/api',{recursive:true}).filter(x=>String(x).endsWith('route.ts'));
 for(const f of glob){const source=fs.readFileSync(`src/app/api/${f}`,'utf8');for(const m of source.matchAll(/maxDuration\s*=\s*(\d+)/g))assert.ok(Number(m[1])<=300,f);}
 assert.equal(JSON.parse(fs.readFileSync('vercel.json')).crons[0].schedule,'* * * * *');
 console.log('PASS: isolated work deadline abort, unchanged Kling models/prompts (first-frame swap excepted), all function budgets <=300s and per-minute Pro recovery cron');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
