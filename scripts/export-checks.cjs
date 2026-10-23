const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let record={id:'job',user_id:'owner',run_id:'run',media_id:'out.mp4',state:'running',created_at:new Date().toISOString(),cleaned:false,cleanup_cursor:0,overlay_ids:['1.png','2.png','3.png','4.png','5.png','6.png'],payload:{meta:{seconds:3}}};
 let events=[],append=0,head={size:100,mime:'video/mp4'},protocol=1,network=[];
 const db={from(table){return {update(p){this.patch=p;return this;},delete(){events.push(['metadata',table]);return this;},eq(){return this;},async select(){Object.assign(record,this.patch);return {data:[{id:'job'}]};},then(resolve){resolve({error:null});}};}};
 const api=load('src/lib/server/export-jobs.ts',{
  '@/lib/supabase/server':{createSupabaseAdminClient:()=>db},
  '@/lib/server/billing-state':{billingRpc:async(name,args)=>{assert.equal(args.p_user,'owner');assert.equal(args.p_id,'job');if(record.cleaned)return null;record.lease_token='lease';return JSON.parse(JSON.stringify(record));}},
  '@/lib/server/account-state':{accountClosing:async()=>false},
  '@/lib/server/store':{getRun:async()=>({id:'run'}),registerMedia:async()=>events.push('register'),appendExport:async()=>{append++;return {src:'/api/media/out.mp4',seconds:3};}},
  '@/lib/server/r2':{objectInfo:async()=>head,deleteObjectStrict:async key=>events.push(key)}
 },{RENDER_URL:'https://fixture.invalid',RENDER_SECRET:'fixture-only'},{fetch:async(url,options)=>{network.push([url,options?.method]);return url.endsWith('/health')?Response.json({protocol}):options?.method==='POST'?Response.json({id:'job'}):new Response(null,{status:404});}});
 // No fetch is available in this fixture: a finished R2 output recovers without any worker/browser state.
 await api.advanceExport('owner','job');assert.equal(record.state,'done');assert.equal(record.cleaned,false);assert.equal(record.cleanup_cursor,5);assert.equal(append,1);
 await api.advanceExport('owner','job');assert.equal(record.cleaned,true);assert.equal(append,1);assert.ok(events.includes('media/6.png'));
 await api.advanceExport('owner','job');assert.equal(append,1);
 record={...record,state:'pending',cleaned:false,overlay_ids:[],cleanup_cursor:0};head=null;
 await assert.rejects(api.advanceExport('owner','job'),/worker update required/);assert.equal(network.some(c=>c[1]==='POST'),false);
 protocol=2;await api.advanceExport('owner','job');assert.equal(record.state,'running');assert.equal(network.filter(c=>c[1]==='POST').length,1);
 console.log('PASS: durable export recovers from output without worker/browser, owned registration, single append, bounded resumable PNG cleanup and terminal replay');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
