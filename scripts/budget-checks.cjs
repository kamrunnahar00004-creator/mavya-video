const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{execFileSync}=require('node:child_process'),{load}=require('./check-module.cjs');
async function main(){
 const api=load('src/lib/server/work-budget.ts',{'node:async_hooks':require('node:async_hooks')});
 let signal;
 await api.withWorkBudget(async()=>{signal=api.workSignal(100);await new Promise(r=>setTimeout(r,15));assert.equal(signal.aborted,true);assert.throws(()=>api.checkBudget());},5);
 api.checkBudget();assert.equal(api.workSignal(100).aborted,false);
 function prompts(source){
  const f=ts.createSourceFile('hookgen.ts',source,ts.ScriptTarget.Latest,true),out=[];
  // The character swap moved to Kling 4.0 on purpose (founder 2026-11-21; pinned below and in kling4-swap-checks).
  // The described-hook models and prompts stay frozen.
  const names=new Set(['IMAGE_TO_VIDEO','TEXT_TO_VIDEO','DESCRIBED_SECONDS','MIN_REFERENCE','LOOK','NEGATIVE','prompt']);
  // swapFirstFrame was the old first-frame edit (removed with Kling 4.0), not a Kling prompt.
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.getText(f)==='swapFirstFrame')return;if(ts.isVariableDeclaration(n)&&names.has(n.name.getText(f)))out.push(n.getText(f));ts.forEachChild(n,visit);}visit(f);return out;
 }
 assert.deepEqual(prompts(fs.readFileSync('src/lib/server/hookgen.ts','utf8')),prompts(execFileSync('git',['show','0b013a7:src/lib/server/hookgen.ts'],{encoding:'utf8'})));
 // The Kling 4.0 swap: model and the prompt that won the side by side (founder 2026-11-21), pinned word for word.
 const hookgen=fs.readFileSync('src/lib/server/hookgen.ts','utf8');
 const literal=(name)=>{const m=hookgen.match(new RegExp(`const ${name} =\\s*\\n?\\s*("(?:[^"\\\\]|\\\\.)*");`));assert.ok(m,name);return JSON.parse(m[1]);};
 assert.equal(literal('SWAP'),'kling/v4/video-to-video/edit');
 assert.equal(literal('SWAP_PROMPT'),"Replace the person in @Video1 with the person in @Image1. Their face and hair must match @Image1 (@Image2 shows the same person). Keep everything else from @Video1 exactly: the motion, timing, facial expressions, head turns, framing, clothes and room. Do not add any text.");
 assert.ok(hookgen.includes('{ prompt: `${SWAP_PROMPT}${fix}`, video_url: videoUrl, image_urls: [faceUrl, photoUrl] }'),'the swap sends the face first, then the whole photo');
 const glob=fs.readdirSync('src/app/api',{recursive:true}).filter(x=>String(x).endsWith('route.ts'));
 for(const f of glob){const source=fs.readFileSync(`src/app/api/${f}`,'utf8');for(const m of source.matchAll(/maxDuration\s*=\s*(\d+)/g))assert.ok(Number(m[1])<=300,f);}
 assert.equal(JSON.parse(fs.readFileSync('vercel.json')).crons[0].schedule,'* * * * *');
 console.log('PASS: isolated work deadline abort, unchanged described-hook models/prompts, pinned Kling 4.0 swap, all function budgets <=300s and per-minute Pro recovery cron');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
