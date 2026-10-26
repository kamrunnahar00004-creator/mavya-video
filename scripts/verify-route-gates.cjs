// Inventory every exported API method and exercise the real session gate for all five account personas.
const fs=require('node:fs'),assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let claims=null,plan=null;
 const cookie=()=>({getAll:()=>[],set(){}}),reply=status=>({status,cookies:cookie()});
 const api=load('src/lib/supabase/session.ts',{'next/server':{NextResponse:{next:()=>reply(200),redirect:()=>reply(307),json:(_body,options)=>reply(options.status)}},'@supabase/ssr':{createServerClient:()=>({auth:{getClaims:async()=>({data:{claims}})}})}},{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',ADMIN_USER_IDS:'admin-id'},{fetch:async()=>Response.json({plan})});
 const publicRoutes=new Set(['/api/contact','/api/stripe/webhook','/api/internal/generations']);
 let methods=0,checks=0;
 for(const file of fs.readdirSync('src/app/api',{recursive:true}).filter(f=>f.endsWith('route.ts'))){
  const path='/api/'+file.replace(/\/route.ts$/,'').replace(/^route.ts$/,'').replace(/\[id\]/g,'fixture-id').replace(/\[code\]/g,'clip123');
  for(const match of fs.readFileSync('src/app/api/'+file,'utf8').matchAll(/export async function (GET|POST|PATCH|DELETE|PUT|HEAD)\(/g)){
   const method=match[1];methods++;
   for(const persona of ['out','unpaid','paid','past_due','admin']){
    claims=persona==='out'?null:{sub:persona==='admin'?'admin-id':'owner'};plan=persona==='paid'?'pro':null;
    const url=new URL('https://app.invalid'+path),actual=await api.updateSession({url:url.href,nextUrl:url,method,cookies:cookie()});
    const costs=/^\/api\/(uploads$|media$|runs\/[^/]+\/export$)/.test(path)||(['POST','PATCH'].includes(method)&&/^\/api\/(songs\/[^/]+|runs(?:\/[^/]+)?|references(?:\/[^/]+)?)$/.test(path));
    const expected=publicRoutes.has(path)?200:persona==='out'?401:costs&&['unpaid','past_due'].includes(persona)?402:200;
    assert.equal(actual.status,expected,`${method} ${path} ${persona}`);checks++;
   }
  }
 }
 console.log(`PASS: ${methods} actual API methods x five personas = ${checks} gate decisions; handler-specific ownership/allowance checks remain in their focused suites`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
