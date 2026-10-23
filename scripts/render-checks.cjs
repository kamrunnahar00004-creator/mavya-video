const assert=require('node:assert/strict');
async function main(){
 const {validJob,validProbe,MAX_QUEUE,MAX_FILE_BYTES,MAX_JOB_BYTES,countOverlayPixels}=await import('../render/limits.mjs');
 const make=()=>({meta:{who:'10000000-0000-4000-8000-000000000001'},output:{url:'https://fixture.invalid/out',contentType:'video/mp4'},spec:{width:1080,height:1920,fps:30,total:3,segments:[{url:'https://fixture.invalid/in',gap:0,speed:1,volume:1,pieces:[{start:0,end:3}]}],sounds:[],overlays:[]}});
 assert.equal(validJob(make()),true);
 for(const mutate of [b=>b.spec.width=99999,b=>b.spec.total=181,b=>b.spec.segments[0].speed=0,b=>b.spec.segments[0].pieces=Array(201).fill({start:0,end:3}),b=>b.spec.overlays=Array(201).fill({}),b=>b.meta.who='anonymous',b=>b.spec.segments[0].url='file:///etc/passwd']){const b=make();mutate(b);assert.equal(validJob(b),false);}
 assert.equal(validProbe(7680,4320,3),false);assert.equal(validProbe(1080,1920,3),true);assert.equal(validProbe(0,0,3601),false);
 assert.equal(MAX_QUEUE,8);assert.ok(MAX_FILE_BYTES<MAX_JOB_BYTES);
 const budget={};countOverlayPixels(budget,1080,1920);assert.throws(()=>countOverlayPixels(budget,10000,10000));
 console.log('PASS: render spec count/time/size/identity bounds, decode dimension/duration limits and queue/byte budgets');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
