const assert = require('node:assert/strict'), fs = require('node:fs'), { performance } = require('node:perf_hooks'), { load } = require('./check-module.cjs');
const at='2026-10-26T00:00:00.000Z', id=i=>`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const thumbnail='data:image/jpeg;base64,'+'a'.repeat(24000);
const refs=Array.from({length:5011},(_,i)=>({id:id(i),createdAt:at,owner:'user',title:'Fixture',analysis:{segments:[{start:0,end:3,role:'hook',thumb:thumbnail}]},history:'x'.repeat(4000)}));
const runs=Array.from({length:1011},(_,i)=>({id:id(i),createdAt:at,updatedAt:at,title:'Fixture',sourceRefId:null,hook:{source:'describe',describe:'Example',describeReady:true,generated:{src:'/fixture.mp4'},versions:Array(20).fill({src:'/fixture.mp4'})},demo:{clip:null,clips:[]},sounds:[],project:{large:'x'.repeat(20000)},script:{large:'x'.repeat(5000)}}));
const assets=Array.from({length:2011},(_,i)=>({mediaId:id(i)+'.mp4',createdAt:at,name:'fixture',kind:'video'}));
let cloud=false, calls=[];
const chain={select(v){calls.push(['select',v]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},or(v){calls.push(['or',v]);return this;},order(k,v){calls.push(['order',k,v]);return this;},limit(n){calls.push(['limit',n]);return Promise.resolve({data:[],error:null});}};
const api=load('src/lib/server/list-pages.ts',{'@/lib/supabase/server':{createSupabaseAdminClient:()=>({from:()=>chain})},'@/lib/server/store':{cloud:()=>cloud,listReferences:async()=>refs,listRuns:async()=>runs,listAssets:async()=>assets}});
async function all(kind, values, key) {
 let cursor=null,seen=[];
 do {const page=await api.listPage(kind,'owner',new Request('http://fixture/api/'+kind+(cursor?'?cursor='+encodeURIComponent(cursor):'')));assert.ok(page.items.length<=24);seen.push(...page.items.map(v=>v[key]));cursor=page.next;}while(cursor);
 assert.equal(seen.length,values.length);assert.equal(new Set(seen).size,values.length);assert.deepEqual([...seen].sort(),values.map(v=>v[key]).sort());
}
async function main(){
 await all('references',refs,'id');await all('runs',runs,'id');await all('assets',assets,'mediaId');
 await assert.rejects(api.listPage('runs','owner',new Request('http://fixture?cursor=bad')),/Invalid cursor/);
 const library=await api.listPage('references','owner',new Request('http://fixture'));
 assert.ok(!JSON.stringify(library.items).includes('data:image'));assert.match(library.items[0].analysis.segments[0].thumb,/^\/api\/references\/.+\/thumbnail/);
 const summary=await api.listPage('runs','owner',new Request('http://fixture?view=summary'));
 assert.equal(summary.items[0].project,undefined);assert.equal(summary.items[0].hook.versions,undefined);
 const metrics={library:{beforeBytes:Buffer.byteLength(JSON.stringify(refs.slice(0,5000))),afterBytes:Buffer.byteLength(JSON.stringify(library.items))},studio:{beforeBytes:Buffer.byteLength(JSON.stringify(runs.slice(0,1000))),afterBytes:Buffer.byteLength(JSON.stringify(summary.items))}};
 for(const [label,values,page] of [['library',refs.slice(0,5000),library.items],['studio',runs.slice(0,1000),summary.items]]){
  const raw=JSON.stringify(values),small=JSON.stringify(page);let samples=[];
  for(let i=0;i<9;i++){let t=performance.now();JSON.parse(raw);const before=performance.now()-t;t=performance.now();JSON.parse(small);samples.push({before:before,after:performance.now()-t});}
  metrics[label].parseBeforeMs=samples.map(s=>s.before).sort((a,b)=>a-b)[4];metrics[label].parseAfterMs=samples.map(s=>s.after).sort((a,b)=>a-b)[4];
 }
 cloud=true;const first=await api.listPage('references','10000000-0000-4000-8000-000000000001',new Request('http://fixture'));
 assert.equal(first.items.length,0);assert.ok(calls.some(c=>c[0]==='limit'&&c[1]===24));assert.ok(calls.some(c=>c[0]==='or'&&c[1].includes('owner.eq.curated,user_id.eq.')));
 console.log('PASS: all 5,011 references / 1,011 runs / 2,011 assets reachable across timestamp ties; bounded pages, private images, summaries, query ownership');
 console.log(JSON.stringify(metrics));if(process.env.PART2_METRICS)fs.writeFileSync(process.env.PART2_METRICS,JSON.stringify(metrics,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
