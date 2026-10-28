'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),{load}=require('./check-module.cjs');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const item=title=>({id:id(1),title,owner:'curated',partial:true,ai:{style:'talking'}});
async function cache(){
 let wall=100000,mono=0,calls=0,answer={items:[item('one')],next:null};
 const urls=[];const api=load('src/lib/library-cache.ts',{'@/lib/list-client':{fetchPage:async(url,cursor)=>{calls++;urls.push([url,cursor]);if(answer instanceof Error)throw answer;return structuredClone(answer);}}},{},{Date:class extends Date{static now(){return wall;}},performance:{now:()=>mono}});
 const [a,b]=await Promise.all([api.loadLibrary(),api.loadLibrary()]);assert.equal(calls,1);assert.equal(a,b);assert.ok(Object.isFrozen(a.items));assert.ok(Object.isFrozen(a.items[0].ai));assert.throws(()=>a.items.push(item('private')));
 wall+=59999;mono+=59999;await api.loadLibrary();assert.equal(calls,1);
 wall++;mono++;answer={items:[item('changed')],next:null};assert.equal((await api.loadLibrary()).items[0].title,'changed');assert.equal(calls,2);
 // A clock rollback cannot extend freshness; neither can a frozen wall clock.
 wall--;await api.loadLibrary();assert.equal(calls,3);mono+=60000;await api.loadLibrary();assert.equal(calls,4);
 api.invalidateLibrary();answer={items:[{...item('private'),owner:'user'}],next:null};await assert.rejects(api.loadLibrary(),/Invalid catalog/);
 answer={items:[item('shared')],next:'next'};await api.loadLibrary();const n=calls;
 await api.libraryMore('next');await api.libraryMore('next');assert.equal(calls,n+2,'continuations are fresh');
 api.invalidateLibrary();answer=Error('offline');await assert.rejects(api.loadLibrary(),/offline/);answer={items:[item('recovered')],next:null};assert.equal((await api.loadLibrary()).items[0].title,'recovered');
 assert.ok(urls.every(([url])=>url.includes('scope=curated')&&url.includes('view=catalog')));
 const queue=[];const race=load('src/lib/library-cache.ts',{'@/lib/list-client':{fetchPage:()=>new Promise(resolve=>queue.push(resolve))}},{},{performance:{now:()=>0}});
 const old=race.loadLibrary();race.invalidateLibrary();const current=race.loadLibrary();queue[0]({items:[item('old')],next:null});queue[1]({items:[item('new')],next:null});
 assert.equal((await old).items[0].title,'new');assert.equal((await current).items[0].title,'new');assert.equal(queue.length,2);
}

function fixture(){
 const rows=Array.from({length:331},(_,i)=>({id:id(i+1000),owner:'curated',user_id:null,created_at:'2026-10-28T00:00:00Z',data:{
  id:id(i+1000),owner:'curated',title:'Fixture hook '+i,platform:'instagram',sourceUrl:'https://fixture.invalid/video',createdAt:'2026-10-28T00:00:00Z',views:i*10000,mediaId:id(i+1000)+'.mp4',mime:'video/mp4',author:'fixture',likes:i*10,comments:i,caption:'Comment "demo"',summary:'Fixture summary',followers:10000,smallCover:true,postedAt:'2026-10-27',pending:false,review:{verdict:'keep',reason:'internal '.repeat(30),at:'2026-10-27'},ai:{style:'text_music',reason:'internal '.repeat(1000)},
  analysis:{duration:30,width:720,height:1280,cuts:[0,3,6],analyzedAt:'2026-10-27',segments:Array.from({length:10},(_,j)=>({role:j?'body':'hook',start:j*3,end:j*3+3,note:'scene detail '.repeat(100),thumb:j?'data:image/jpeg;base64,'+'A'.repeat(4000):'/api/media/'+id(i+5000)+'.jpg'}))},
  recipe:{onScreenText:[{text:'First line'},{text:'Second line'}],hook:{end:3},demo:{shots:Array(30).fill({hint:'instruction '.repeat(60)})},hookPrompt:'prompt '.repeat(1500)},history:'old history '.repeat(1000)
 }}));
 rows.push({...structuredClone(rows[0]),id:id(9),owner:'user',user_id:'alice',data:{...structuredClone(rows[0].data),title:'ALICE_PRIVATE'}}, {...structuredClone(rows[0]),id:id(8),owner:'user',user_id:'bob',data:{...structuredClone(rows[0].data),title:'BOB_PRIVATE'}});
 return rows;
}
function database(rows){
 const stats={bytes:0,selects:[],reads:0};
 const client={from(){let select,curated=false,who=null,after=null;return {
  select(v){select=v;stats.selects.push(v);return this;},eq(k,v){if(k==='owner'&&v==='curated')curated=true;return this;},or(v){if(v.includes('owner.eq.curated'))who=v.match(/user_id.eq.([^,)]+)/)?.[1];const m=v.match(/id.lt.([a-f0-9-]+)/);if(m)after=m[1];return this;},order(){return this;},async limit(n){
   stats.reads++;
   const data=rows.filter(r=>(curated?r.owner==='curated':r.owner==='curated'||r.user_id===who)&&(!after||r.id<after)).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,n).map(row=>Object.fromEntries(select.split(',').map(field=>{
    const colon=field.indexOf(':'),name=colon<0?field:field.slice(0,colon),expression=colon<0?field:field.slice(colon+1),parts=expression.replaceAll('->>','->').split('->');let value=row;for(const key of parts)value=value?.[key];return [name,value??null];
   })));
   stats.bytes+=Buffer.byteLength(JSON.stringify(data));return {data,error:null};
  }
 };}};
 return {client,stats};
}
async function payload(){
 const rows=fixture();
 async function request(root,view,scope='curated',who='alice'){
  const db=database(rows),list=load(root==='before'?'scripts/fixtures/library-before-list-pages.ts.fixture':'src/lib/server/list-pages.ts',{'@/lib/server/store':{cloud:()=>true},'@/lib/supabase/server':{createSupabaseAdminClient:()=>db.client},'@/lib/server/covers':{coverLinks:async refs=>new Map(refs.filter(r=>r.smallCover&&r.owner==='curated').map(r=>[r.id,'https://media.invalid/covers/'+r.id+'.webp?X-Amz-Expires=3600&X-Amz-Signature='+'F'.repeat(64)]))}});
  const route=load(root==='before'?'scripts/fixtures/library-before-route.ts.fixture':'src/app/api/references/route.ts',{'@/lib/server/list-pages':list,'next/server':{connection:async()=>{}},'@/lib/server/store':{},'@/lib/server/who':{currentUser:async()=>who,signInFirst:()=>new Response(null,{status:401})},'@/lib/taxonomy':{HOOK_STYLES:[],NICHES:[]}});
  const response=await route.GET(new Request('http://fixture/api/references?view='+view+'&all=1&scope='+scope)),raw=await response.text();
  return {response,raw,db:db.stats};
 }
 const old=await request('before','studio'),now=await request('','catalog');
 assert.equal(now.response.status,200);assert.match(now.response.headers.get('cache-control'),/no-store/,'no stacked HTTP cache lifetime');
 const items=JSON.parse(now.raw);assert.equal(items.length,331);assert.ok(items.every(r=>r.owner==='curated'&&r.partial===true&&r.analysis===null&&!('recipe'in r)));assert.ok(!now.raw.includes('PRIVATE'));
 for(const select of now.db.selects){assert.ok(!select.includes('recipe'));assert.ok(!select.includes('analysis:data->analysis'));assert.ok(select.includes('data->analysis->segments->0->>thumb'));}
 const bad=await request('','catalog','anything');assert.equal(bad.response.status,400);assert.equal(bad.db.reads,0);
 const out=await request('','catalog','curated',null);assert.equal(out.response.status,401);assert.equal(out.db.reads,0);
 assert.equal(JSON.parse((await request('','studio','mixed')).raw).filter(r=>r.owner==='user').length,1,'fresh mixed path still filters owned rows');
 const metrics={fixture:'331 synthetic curated references plus two private rows; actual list and handler code, projected PostgREST response simulation; not production bytes',before:{databaseBytes:old.db.bytes,httpBytes:Buffer.byteLength(old.raw),gzipBytes:zlib.gzipSync(old.raw).length,reads:old.db.reads},after:{databaseBytes:now.db.bytes,httpBytes:Buffer.byteLength(now.raw),gzipBytes:zlib.gzipSync(now.raw).length,reads:now.db.reads},projection:now.db.selects[0]};
 assert.ok(metrics.after.databaseBytes<metrics.before.databaseBytes/5);assert.ok(metrics.after.httpBytes<metrics.before.httpBytes/5);
 if(process.env.LIBRARY_PAYLOAD_METRICS)fs.writeFileSync(process.env.LIBRARY_PAYLOAD_METRICS,JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
}
(async()=>{await cache();await payload();console.log('PASS: curated-only immutable cache, strict TTL/clock bounds, invalidation race, fresh continuations, compact DB/API projection and auth/scope isolation');})().catch(e=>{console.error(e);process.exitCode=1;});
