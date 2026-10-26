const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function profile(){
 let failed=false;
 const api=load('src/app/api/profile/route.ts',{'node:fs/promises':{},'node:path':require('node:path'),'next/server':{connection:async()=>{}},'@/lib/profile':{},'@/lib/supabase/server':{authEnabled:()=>true,getSessionUser:async()=>({id:'owner',email:'fixture@invalid.test'}),createSupabaseServerClient:async()=>({from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:failed?null:{first_name:'First',last_name:'Last',avatar_url:''},error:failed?Error('read unavailable'):null};}})})}});
 assert.equal((await api.GET()).status,200);failed=true;const response=await api.GET();assert.equal(response.status,503);assert.ok(!('firstName' in await response.json()));
 let states=[],index=0,effects=[],networkFailure=false;
 const jsx=(type,props)=>({type,props:props??{}}),nodes=t=>!t||typeof t!=='object'?[]:[t,...[t.props?.children].flat(Infinity).flatMap(nodes)];
 const h=load('src/components/profile-view.tsx',{'react':{useState:init=>{const i=index++;if(!(i in states))states[i]=init;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef:()=>({current:null}),useCallback:f=>f,useEffect:f=>effects.push(f)},'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'@/components/settings-shell':{},'@/lib/client':{},'@/lib/profile':{NO_PROFILE:{email:'',firstName:'',lastName:'',avatar:''}}},{},{AbortController,fetch:async()=>networkFailure?new Response(null,{status:503}):Response.json({email:'fixture@invalid.test',firstName:'First',lastName:'Last',avatar:''})});
 const render=()=>{index=0;effects=[];return h.ProfileView();};
 render();effects[0]();await new Promise(r=>setImmediate(r));let tree=render();assert.equal(nodes(tree).find(n=>n.props.id==='p-first').props.value,'First');
 networkFailure=true;effects[0]();await new Promise(r=>setImmediate(r));tree=render();assert.equal(nodes(tree).find(n=>n.props.id==='p-first').props.value,'First');assert.ok(nodes(tree).some(n=>n.props.role==='alert'));
}
async function deletes(){
 let error=null;const id='10000000-0000-4000-8000-000000000001';
 const store=load('src/lib/server/store.ts',{'node:crypto':require('node:crypto'),'node:fs/promises':{},'node:path':require('node:path'),'@/lib/server/r2':{r2Enabled:()=>true},'@/lib/supabase/server':{authEnabled:()=>true,createSupabaseAdminClient:()=>({from:()=>({select(){return this;},delete(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error};},then(ok,bad){return Promise.resolve({error}).then(ok,bad);}})})}});
 await store.deleteRun(id,'owner');await store.deleteAsset(id+'.png','owner');await store.deleteReference(id,'owner');
 error=Error('delete unavailable');await assert.rejects(store.deleteRun(id,'owner'),/unavailable/);await assert.rejects(store.deleteAsset(id+'.png','owner'),/unavailable/);await assert.rejects(store.deleteReference(id,'owner'),/unavailable/);
}
async function main(){await profile();await deletes();console.log('PASS: profile outage preserves last-good data; cloud deletes distinguish absence from storage failure');}
main().catch(e=>{console.error(e);process.exitCode=1;});
