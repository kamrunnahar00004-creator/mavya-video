// Auth/provider/browser/DB services are stubs. Never signs up real accounts or creates Checkout sessions.
const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const jsx=(type,props)=>({type,props:props??{}});
function harness(file,stubs,globals={}){
 let states=[],index=0,effects=[];
 const react={useState:init=>{const i=index++;if(!(i in states))states[i]=typeof init==='function'?init():init;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useEffect:f=>effects.push(f),useRef:v=>({current:v}),useCallback:f=>f,useSyncExternalStore:()=>true};
 const api=load(file,{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},...stubs},{},globals);
 return {api,render(f,props){index=0;effects=[];return f(props);},effects:()=>effects,reset(){states=[];}};
}
const nodes=(tree)=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
async function modal(){
 let auth='signup',user=null,result={data:{session:{},user:{}},error:null},calls=[],navigations=[];
 const client={auth:{getUser:async()=>({data:{user}}),signUp:async input=>{calls.push(['signup',input]);return result;},signInWithPassword:async input=>{calls.push(['password',input]);return result;},signInWithOAuth:async input=>{calls.push(['google',input]);return {error:null};}}};
 const safeNext=load('src/lib/auth-next.ts').safeNext,authError=load('src/lib/auth-error.ts').authError;
 const h=harness('src/components/auth-modal.tsx',{'@/lib/auth-next':{safeNext},'@/lib/auth-error':{authError},'react-dom':{createPortal:x=>x},'next/navigation':{useSearchParams:()=>new URLSearchParams({auth,next:'/library'}),useRouter:()=>({replace(){}}),usePathname:()=>'/'} ,'lucide-react':{Eye:'Eye',EyeOff:'EyeOff',Loader2:'Loader2',X:'X'},'@/lib/supabase/client':{createSupabaseBrowserClient:()=>client}},{window:{location:{origin:'https://fixture.invalid',assign:url=>navigations.push(url)}},document:{body:{}}});
 async function open(mode){auth=mode;h.reset();assert.equal(h.render(h.api.AuthModalHost),null);await h.effects()[0]();await new Promise(r=>setImmediate(r));const host=h.render(h.api.AuthModalHost);assert.ok(host);h.reset();return host;}
 async function submit(mode,error=null,session={}){
  result={data:{session},error};const host=await open(mode);let tree=h.render(host.type,host.props);
  for(const node of nodes(tree).filter(n=>n.type==='input')){if(node.props.type==='email')node.props.onChange({target:{value:'fixture@example.invalid'}});else if(node.props.autoComplete==='new-password'||node.props.autoComplete==='current-password')node.props.onChange({target:{value:'password123'}});}
  tree=h.render(host.type,host.props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});return h.render(host.type,host.props);
 }
 await submit('signup');assert.equal(calls.at(-1)[0],'signup');assert.ok(!('emailRedirectTo' in calls.at(-1)[1].options));assert.equal(navigations.at(-1),'/auth/continue?next=%2Flibrary');
 await submit('login');assert.equal(calls.at(-1)[0],'password');
 let tree=await submit('signup',{code:'user_already_exists',message:'User already registered'});assert.ok(nodes(tree).some(n=>n.props.role==='alert'&&n.props.children==='You already have an account. Log in instead.'));
 tree=await submit('login',{code:'invalid_credentials',message:'Invalid credentials'});assert.ok(nodes(tree).some(n=>n.props.children==='Wrong email or password.'));
 tree=await submit('login',{code:'over_request_rate_limit',message:'Try later'});assert.ok(nodes(tree).some(n=>n.props.children==='Try later'));
 tree=await submit('signup',null,null);assert.ok(nodes(tree).some(n=>n.props.children==='Sign-up could not sign you in. Try again or contact us.'));
 for(const mode of ['login','signup']){const host=await open(mode),tree=h.render(host.type,host.props);await nodes(tree).find(n=>n.type==='button'&&n.props.children?.includes?.('Continue with Google')).props.onClick();await new Promise(r=>setImmediate(r));assert.equal(calls.at(-1)[0],'google');assert.equal(calls.at(-1)[1].provider,'google');assert.ok(!JSON.stringify(calls.at(-1)[1]).includes('shouldCreateUser'));}
 user={id:'known'};h.reset();h.render(h.api.AuthModalHost);h.effects()[0]();await new Promise(r=>setImmediate(r));assert.equal(navigations.at(-1),'/auth/continue?next=%2Flibrary');assert.equal(h.render(h.api.AuthModalHost),null);
}
async function gate(){
 let claims=null,plan=null,fail=false,calls=[];
 function cookies(){const jar=new Map();return {getAll:()=>[...jar.values()],set:(name,value,options)=>{const c=typeof name==='object'?name:{name,value,...options};jar.set(c.name,c);}};}
 const next={next:()=>({status:200,cookies:cookies()}),redirect:to=>({status:307,location:String(to),cookies:cookies()}),json:(body,{status})=>({status,body,cookies:cookies()})};
 const api=load('src/lib/supabase/session.ts',{'next/server':{NextResponse:next},'@supabase/ssr':{createServerClient:(_url,_key,options)=>({auth:{getClaims:async()=>{options.cookies.setAll([{name:'session',value:'refreshed',options:{httpOnly:true}}]);return {data:{claims}};}}})}},{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',ADMIN_EMAILS:' Admin@fixture.invalid '},{fetch:async(url,options)=>{calls.push([url,options]);if(fail)throw Error('DB unavailable');return Response.json({plan});}});
 const run=async(path,headers={})=>{const url=new URL('https://app.invalid'+path);return api.updateSession({url:url.href,nextUrl:url,cookies:cookies(),headers:new Headers(headers)});};
 const pages=['/studio','/studio/run','/studio/run/edit','/library','/library/item','/login'];
 for(const path of pages){claims=null;let r=await run(path);assert.equal(r.status,307);assert.ok(r.location.includes('auth=signup'));assert.ok(r.location.includes('next='));claims={sub:'owner',email:'user@fixture.invalid'};plan=null;r=await run(path);assert.equal(r.location,'https://app.invalid/pricing');plan='pro';r=await run(path,{rsc:'1','next-router-prefetch':'1'});assert.equal(r.status,path==='/login'?307:200);}
 const paid=['/api/uploads','/api/media','/api/runs/run/export'];
 for(const path of paid){claims=null;assert.equal((await run(path)).status,401);claims={sub:'owner'};plan=null;const r=await run(path);assert.equal(r.status,402);assert.equal(r.body.needsPlan,true);assert.equal(r.cookies.getAll()[0].value,'refreshed');plan='starter';assert.equal((await run(path)).status,200);}
 claims={sub:'owner'};plan=null;
 for(const path of ['/settings','/settings/billing','/settings/plans','/settings/usage','/billing','/api/media/owned.mp4','/api/runs/run/generate','/api/runs/run/product','/api/runs/run/script'])assert.equal((await run(path)).status,200,path);
 for(const path of ['/api/contact','/api/stripe/webhook','/api/internal/generations']){claims=null;assert.equal((await run(path)).status,200);}
 claims={sub:'owner'};fail=true;assert.equal((await run('/studio')).location,'https://app.invalid/pricing');assert.equal((await run('/api/uploads')).status,402);
 claims={sub:'owner',email:'ADMIN@fixture.invalid'};calls=[];assert.equal((await run('/studio')).status,200);assert.equal(calls.length,0);
 claims={sub:'owner',email:'user@fixture.invalid'};fail=false;await run('/studio');assert.equal(calls.at(-1)[1].headers.apikey,'service-fixture');assert.equal(JSON.parse(calls.at(-1)[1].body).p_user,'owner');
 // This demonstrates the open admin-email trust issue: no verified identity check is requested.
 const usage=load('src/lib/server/usage.ts',{'@/lib/server/store':{cloud:()=>true},'@/lib/supabase/server':{getSessionUser:async()=>({id:'new-signup',email:'admin@fixture.invalid',email_confirmed_at:null}),createSupabaseAdminClient(){throw Error('unexpected DB');}}},{ADMIN_EMAILS:'admin@fixture.invalid'});
 assert.equal(await usage.adminUser('new-signup'),true);
 const fs=require('fs');
 const proxy=fs.readFileSync('src/proxy.ts','utf8');for(const root of ['/studio/:path*','/library/:path*','/settings/:path*','/billing/:path*','/api/:path*','/login'])assert.ok(proxy.includes('"'+root+'"'));
 for(const file of fs.readdirSync('src/app/(app)',{recursive:true}).filter(f=>f.endsWith('page.tsx')))assert.ok(/^(studio|library|settings|billing)\//.test(file),file);
 assert.match(fs.readFileSync('src/app/(app)/billing/page.tsx','utf8'),/redirect\("\/settings\/billing"\)/);
}
async function pricing(){
 const plans=load('src/lib/plans.ts');
 for(const scenario of [{status:401},{usage:{plan:null,limit:0}},{usage:{plan:'pro',limit:60}},{usage:{plan:null,limit:null}},{usage:{plan:null,limit:0,billingStatus:'past_due'}}]){
  const calls=[],nav=[];
  const h=harness('src/components/pricing-page.tsx',{'next/link':{default:'Link'},'lucide-react':{},'@/components/contact-dialog':{},'@/components/marketing-chrome':{},'@/lib/plans':plans},{window:{location:{assign:url=>nav.push(url)}},fetch:async(url,opts)=>{calls.push([url,opts]);return url==='/api/usage'?Response.json(scenario.usage??{},{status:scenario.status??200}):Response.json({url:'https://checkout.fixture.invalid'});}});
  h.render(h.api.PricingPage);h.effects()[0]();await new Promise(r=>setImmediate(r));
  const tree=h.render(h.api.PricingPage),card=nodes(tree).find(n=>n.props.plan?.id==='starter');assert.ok(card);
  const button=nodes(h.render(card.type,card.props)).find(n=>n.props.viewer);h.reset();const output=h.render(button.type,button.props);
  if(scenario.status===401)assert.equal(output.props.href,'/?auth=signup&next=%2Fpricing');
  else if(scenario.usage.billingStatus==='past_due')assert.equal(output.props.href,'/settings/billing');
  else if(scenario.usage.plan||scenario.usage.limit===null)assert.equal(output.props.href,'/settings/plans');
  else {for(const cycle of ['monthly','annual']){h.reset();const b=h.render(button.type,{...button.props,cycle});b.props.children.find(n=>n?.type==='button').props.onClick();await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(calls.at(-1)[1].body).cycle,cycle);assert.equal(JSON.parse(calls.at(-1)[1].body).plan,'starter');assert.equal(nav.at(-1),'https://checkout.fixture.invalid');}}
 }
}
async function main(){await modal();await gate();await pricing();console.log('PASS: auth modal, app/API gate matrix, admin trust reproduction, matcher inventory and pricing viewer/checkout matrix');}
main().catch(e=>{console.error(e);process.exitCode=1;});
