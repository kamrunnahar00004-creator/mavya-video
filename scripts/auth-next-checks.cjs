const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const {safeNext}=load('src/lib/auth-next.ts');
for(const bad of [null,'https://evil.invalid','//evil.invalid','/\t/evil.invalid','/\n/evil.invalid','/\\evil.invalid',' /studio'])assert.equal(safeNext(bad),'/studio');
assert.equal(safeNext('/settings/plans?paid=1'),'/settings/plans?paid=1');
assert.equal(safeNext('/studio/../settings'),'/settings');
console.log('PASS: shared same-origin auth destination rejects control characters and browser-normalized external paths');
async function routes(){
 let user={id:'owner'}, a={plan:null,limit:0}, fail=false;
 const redirect=url=>new Response(null,{status:307,headers:{location:url}});
 const route=load('src/app/auth/continue/route.ts',{
  'next/server':{NextResponse:{redirect}}, '@/lib/auth-next':{safeNext},
  '@/lib/supabase/server':{getSessionUser:async()=>user},
  '@/lib/server/usage':{allowance:async()=>{if(fail)throw Error('fixture unavailable');return a;}}
 });
 const dest=async next=>(await route.GET(new Request('https://fixture.invalid/auth/continue?next='+encodeURIComponent(next)))).headers.get('location');
 assert.equal(await dest('/studio/run'),'https://fixture.invalid/pricing');
 a={plan:'pro',limit:60};assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');
 a={plan:null,limit:null};assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');
 assert.equal(await dest('//evil.invalid'),'https://fixture.invalid/studio');
 fail=true;assert.equal(await dest('/studio/run'),'https://fixture.invalid/studio/run');fail=false;
 user=null;assert.equal(await dest('/studio/run'),'https://fixture.invalid/?auth=login');
 let code,signedIn=null,deleted=[],signedOut=0;
 const callback=load('src/app/auth/callback/route.ts',{
  'next/server':{NextResponse:{redirect}},'@/lib/auth-next':{safeNext},
  '@/lib/supabase/server':{
   createSupabaseServerClient:async()=>({auth:{exchangeCodeForSession:async c=>{code=c;return {data:signedIn?{user:signedIn}:undefined,error:null};},signOut:async()=>{signedOut++;}}}),
   createSupabaseAdminClient:()=>({auth:{admin:{deleteUser:async id=>{deleted.push(id);return {error:null};}}}})
  }
 });
 const back=async q=>(await callback.GET(new Request('https://fixture.invalid/auth/callback?code=fixture&next=%2Fstudio%2Frun'+q))).headers.get('location');
 assert.equal(await back(''),'https://fixture.invalid/auth/continue?next=%2Fstudio%2Frun');assert.equal(code,'fixture');
 // Founder 2026-10-25: Google Log in must not create accounts.
 const now=new Date().toISOString(),old='2026-01-01T00:00:00.000Z';
 signedIn={id:'fresh',created_at:now,last_sign_in_at:now};
 assert.equal(await back('&intent=login'),'https://fixture.invalid/?auth=signup&error=noaccount&next=%2Fstudio%2Frun');
 assert.deepEqual(deleted,['fresh']);assert.equal(signedOut,1);
 assert.equal(await back(''),'https://fixture.invalid/auth/continue?next=%2Fstudio%2Frun','Sign up keeps a new account');
 signedIn={id:'returning',created_at:old,last_sign_in_at:now};
 assert.equal(await back('&intent=login'),'https://fixture.invalid/auth/continue?next=%2Fstudio%2Frun','an existing account logs in');
 assert.deepEqual(deleted,['fresh']);
 console.log('PASS: actual continue/callback handlers cover no plan, paid, admin, signed out, outage, exchanged-code continuation and Google log in without an account');
}
routes().catch(error=>{console.error(error);process.exitCode=1;});
