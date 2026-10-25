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
async function main(){await modal();console.log('PASS: actual auth modal email/Google/session/error flows and signed-in popup suppression');}
main().catch(e=>{console.error(e);process.exitCode=1;});
