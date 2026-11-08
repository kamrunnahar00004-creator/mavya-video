const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{execFileSync}=require('node:child_process'),{load}=require('./check-module.cjs');
async function main(){
 const api=load('src/lib/server/work-budget.ts',{'node:async_hooks':require('node:async_hooks')});
 let signal;
 await api.withWorkBudget(async()=>{signal=api.workSignal(100);await new Promise(r=>setTimeout(r,15));assert.equal(signal.aborted,true);assert.throws(()=>api.checkBudget());},5);
 api.checkBudget();assert.equal(api.workSignal(100).aborted,false);
 function prompts(source){
  const f=ts.createSourceFile('hookgen.ts',source,ts.ScriptTarget.Latest,true),out=[];
  const names=new Set(['MOTION','MOTION_FALLBACK','IMAGE_TO_VIDEO','TEXT_TO_VIDEO','DESCRIBED_SECONDS','MIN_REFERENCE','LOOK','NEGATIVE','OUTFIT_SCHEMA','prompt','parts']);
  // The first-frame swap moved to src/lib/server/first-frame.ts and changed on purpose (founder 2026-11-07: the
  // character's room must never leak into the hook; tested in first-frame-checks). Kling's models and prompts stay frozen.
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.getText(f)==='swapFirstFrame')return;if(ts.isVariableDeclaration(n)&&names.has(n.name.getText(f)))out.push(n.getText(f));if(ts.isPropertyAssignment(n)&&n.name.getText(f)==='text')out.push(n.initializer.getText(f));ts.forEachChild(n,visit);}visit(f);return out;
 }
 assert.deepEqual(prompts(fs.readFileSync('src/lib/server/hookgen.ts','utf8')),prompts(execFileSync('git',['show','0b013a7:src/lib/server/hookgen.ts'],{encoding:'utf8'})));
 // MATCH and CAMERA changed on purpose (founder 2026-11-08: camera moves copied, not a flat zoom); pinned word for word.
 const hookgen=fs.readFileSync('src/lib/server/hookgen.ts','utf8');
 const literal=(name)=>{const m=hookgen.match(new RegExp(`const ${name} =\\s*\\n?\\s*("(?:[^"\\\\]|\\\\.)*");`));assert.ok(m,name);return JSON.parse(m[1]);};
 assert.equal(literal('MATCH'),"Copy the reference video's performance exactly and as closely as possible: the same gestures, hand positions and hand shapes, head moves, gaze direction, facial expressions at the same strength, mouth movements and timing, frame by frame. Add nothing, exaggerate nothing, no extra gestures, no overacting. Keep the same person, face, hair, outfit, held objects, room and light as in the image for the whole video; no new objects.");
 assert.equal(literal('CAMERA'),"Copy the camera too: start with the image's framing, then make every camera move the reference video makes. If the phone is brought closer or pulled away, the camera physically moves, so the perspective and the background shift with it; if it zooms, it zooms; if it stays still, it stays still.");
 assert.ok(hookgen.includes('prompt: `${MATCH} ${CAMERA} ${LOOK}${fix}`,'),'motion control sends MATCH, CAMERA, LOOK');
 const glob=fs.readdirSync('src/app/api',{recursive:true}).filter(x=>String(x).endsWith('route.ts'));
 for(const f of glob){const source=fs.readFileSync(`src/app/api/${f}`,'utf8');for(const m of source.matchAll(/maxDuration\s*=\s*(\d+)/g))assert.ok(Number(m[1])<=300,f);}
 assert.equal(JSON.parse(fs.readFileSync('vercel.json')).crons[0].schedule,'* * * * *');
 console.log('PASS: isolated work deadline abort, unchanged Kling models/prompts (first-frame swap excepted), all function budgets <=300s and per-minute Pro recovery cron');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
