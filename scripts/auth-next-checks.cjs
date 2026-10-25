const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const {safeNext}=load('src/lib/auth-next.ts');
for(const bad of [null,'https://evil.invalid','//evil.invalid','/\t/evil.invalid','/\n/evil.invalid','/\\evil.invalid',' /studio'])assert.equal(safeNext(bad),'/studio');
assert.equal(safeNext('/settings/plans?paid=1'),'/settings/plans?paid=1');
assert.equal(safeNext('/studio/../settings'),'/settings');
console.log('PASS: shared same-origin auth destination rejects control characters and browser-normalized external paths');
async function routes(){
 let user={id:'owner'}, a={plan:null,limit:0}, fail=false, billing=null;
 const redirect=url=>new Response(null,{status:307,headers:{location:url}});
 const route=load('src/app/auth/continue/route.ts',{
  'next/server':{NextResponse:{redirect}}, '@/lib/auth-next':{safeNext},
  '@/lib/supabase/server':{getSessionUser:async()=>user},
  '@/lib/server/billing-state':{billingRow:async()=>billing},
  '@/lib/server/usage':{allowance:async()=>{if(fail)throw Error('fixture unavailable');return a;}}
 });
 const dest=async next=>(await route.GET(new Request('https://fixture.invalid/auth/continue?next='+encodeURIComponent(next)))).headers.get('location');
 assert.equal(await dest('/studio/run'),'https://fixture.invalid/pricing');
 billing={status:'past_due'};assert.equal(await dest('/studio/run'),'https://fixture.invalid/settings/billing');billing=null;
 a={plan:'pro',limit:60};assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');
 a={plan:null,limit:null};assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');
 assert.equal(await dest('//evil.invalid'),'https://fixture.invalid/studio');
 fail=true;assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');fail=false;
 user=null;assert.equal(await dest('/studio/run'),'https://fixture.invalid/?auth=login');
 let code;
 const callback=load('src/app/auth/callback/route.ts',{
  'next/server':{NextResponse:{redirect}},'@/lib/auth-next':{safeNext},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>({auth:{exchangeCodeForSession:async c=>{code=c;return {error:null};}}})}
 });
 const result=await callback.GET(new Request('https://fixture.invalid/auth/callback?code=fixture&next=%2Fstudio%2Frun'));
 assert.equal(code,'fixture');assert.equal(result.headers.get('location'),'https://fixture.invalid/auth/continue?next=%2Fstudio%2Frun');
 console.log('PASS: actual continue/callback handlers cover no plan, paid, admin, signed out, outage and exchanged-code continuation');
}
routes().catch(error=>{console.error(error);process.exitCode=1;});
