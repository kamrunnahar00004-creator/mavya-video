// Offline regression fixtures for Claude's 2026-10-24 fixes. All services are stubs.
const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function attempts(){
 let count=9,error=null,admin=false,reservations=0,existing=null;
 const filters=[];
 const query={select(){return this;},eq(...args){filters.push(args);return this;},not(){return this;},gte(...args){filters.push(args);return this;},in(){return this;},order(){return this;},limit(){return this;},async maybeSingle(){return {data:existing,error:null};},then(ok,bad){return Promise.resolve({count,error}).then(ok,bad);}};
 const api=load('src/lib/server/generation-jobs.ts',{
  '@/lib/server/account-state':{},'@/lib/supabase/server':{createSupabaseAdminClient:()=>({from:()=>query,rpc:async()=>{reservations++;return {data:{job:{id:'reserved'}},error:null};}})},
  '@/lib/server/usage':{adminUser:async()=>admin},'@/lib/server/store':{cloud:()=>true},'@/lib/server/r2':{},'@/lib/server/hookgen':{},'@/lib/generation-edit':{}
 });
 assert.equal((await api.reserveGeneration('owner','run','key')).job.id,'reserved');assert.equal(reservations,1);
 count=10;assert.equal((await api.reserveGeneration('owner','run','new')).error,'attempts');assert.equal(reservations,1);
 existing={id:'existing',state:'running'};assert.equal((await api.reserveGeneration('owner','run','key')).job.id,'existing');assert.equal(reservations,1);existing=null;
 error=Error('count unavailable');await assert.rejects(api.reserveGeneration('owner','run','new'),/count unavailable/);assert.equal(reservations,1);
 admin=true;assert.equal((await api.reserveGeneration('owner','run','new')).job.id,'reserved');assert.equal(reservations,2);
 assert.ok(filters.some(args=>args[0]==='refunded_at'),'24h window follows refunds, not old job creation');
}
async function fonts(){
 // Claude P2V4 fix: Google is asked first; 400 = no 800 face (default face), a network error caches nothing.
 const links=[],calls=[];let answer=200;
 const document={createElement:()=>({remove(){this.removed=true;}}),head:{appendChild:link=>links.push(link)}};
 const fetch=async url=>{calls.push(url);if(answer==='offline')throw Error('offline');return {ok:answer===200,status:answer};};
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const api=load('src/lib/studio-data.ts',{}, {},{document,fetch});
 api.loadFonts(['anton','Arial','Helvetica','geist']);await tick();assert.equal(links.length+calls.length,0);
 api.loadFonts(['TikTok Sans']);await tick();assert.match(links[0].href,/TikTok\+Sans:wght@800/);
 api.loadFonts(['TikTok Sans']);await tick();assert.equal(links.length,1);assert.equal(calls.length,1);
 answer=400;api.loadFonts(['No Bold']);await tick();assert.ok(!links[1].href.includes('wght'),'no 800 face: default face');
 answer='offline';api.loadFonts(['Flaky']);await tick();assert.equal(links.length,2,'nothing loaded while offline');
 answer=200;api.loadFonts(['Flaky']);await tick();assert.match(links[2].href,/Flaky:wght@800/,'800 retried after a network error');
 links[2].onerror();api.loadFonts(['Flaky']);await tick();assert.equal(calls.filter(c=>c.includes('Flaky')).length,3,'failed stylesheet retries');
 api.loadFonts(['TikTok Sans','Anton Test'],'abc');assert.match(links.at(-1).href,/text=abc/);assert.ok(!links.at(-1).href.includes('wght'));
 const n=links.length;links.at(-1).onerror();api.loadFonts(['TikTok Sans','Anton Test'],'abc');assert.equal(links.length,n+1);
}
async function cron(){
 let time=0,events=[],fail=new Set(),present=true;
 class Clock extends Date {static now(){return time;}}
 const step=async name=>{events.push(name);if(fail.has(name))throw Error(name);return present;};
 const query=table=>({select(){return this;},neq(){return this;},or(){return this;},order(){return this;},in(){return this;},async limit(){return {data:present?[{id:'job',user_id:'owner'}]:[],error:null};}});
 const api=load('src/app/api/internal/generations/route.ts',{
  'node:crypto':require('node:crypto'),'@/lib/supabase/server':{createSupabaseAdminClient:()=>({from:query})},
  '@/lib/server/account-deletion':{advanceDeletion:()=>step('deletion')},'@/lib/server/uploads':{expireUploads:()=>step('upload')},
  '@/lib/server/temp-cleanup':{expireTemporaryObjects:()=>step('temp')},'@/lib/server/export-jobs':{advanceExport:()=>step('export')},'@/lib/server/generation-jobs':{advanceGeneration:()=>step('generation')}
 },{CRON_SECRET:'fixture-only-secret-with-32-characters'},{Date:Clock});
 const request=()=>new Request('https://fixture.invalid/cron',{headers:{authorization:'Bearer fixture-only-secret-with-32-characters'}});
 for(let minute=0;minute<5;minute++){time=minute*60000;events=[];assert.equal((await api.GET(request())).status,200);assert.deepEqual(events,[['deletion','upload','temp','export','generation'][minute]]);}
 time=0;events=[];fail=new Set(['deletion']);assert.equal((await api.GET(request())).status,200);assert.deepEqual(events,['deletion','upload']);
 events=[];fail=new Set(['deletion','upload','temp','export','generation']);assert.equal((await api.GET(request())).status,503);assert.equal(events.length,5);
 fail=new Set();present=false;assert.equal((await api.GET(request())).status,200);
 assert.equal((await api.GET(new Request('https://fixture.invalid/cron'))).status,401);
}
async function main(){await attempts();await fonts();await cron();console.log('PASS: capped-attempt replay/window/error/admin cases, font isolation/fallback/retry and every cron rotation/error outcome');}
main().catch(error=>{console.error(error);process.exitCode=1;});
