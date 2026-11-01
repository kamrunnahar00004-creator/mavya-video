// Actual production handlers, Auth SDK and HTTP transport against an offline Supabase/R2 fixture.
// node scripts/measure-agreed-reads.cjs <before-build-copy> <after-build-copy> <output.json>
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{performance}=require('node:perf_hooks'),{createServerClient}=require('@supabase/ssr');
const uid='10000000-0000-4000-8000-000000000001',rid='20000000-0000-4000-8000-000000000001',refid='30000000-0000-4000-8000-000000000001',at='2026-11-01T00:00:00Z';
const reference={id:refid,owner:'curated',title:'Fixture',createdAt:at,mediaId:refid+'.mp4',sourceUrl:'',analysis:null};
const run={id:rid,title:'Fixture',sourceRefId:refid,createdAt:at,updatedAt:at,hook:{mode:'upload',clip:null,text:'Fixture'},demo:{clip:null,frame:'none'}};
const user={id:uid,aud:'authenticated',role:'authenticated',email:'fixture@invalid.test',created_at:at,app_metadata:{},user_metadata:{}};
const calls=[],children=[];
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mavya-agreed-read-'));
 const preload=path.join(dir,'offline.mjs');
 fs.writeFileSync(preload,`const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{const u=new URL(typeof url==="string"?url:url.url??String(url));if(u.hostname.endsWith(".r2.cloudflarestorage.com")){await new Promise(r=>setTimeout(r,15));return Response.json({names:{},hidden:[]},{headers:{etag:'"fixture"'}});}if(!["localhost","127.0.0.1"].includes(u.hostname))throw Error("External network forbidden");return original(url,options)};`);
 const upstream=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');calls.push(url.pathname);
  let data=[];
  if(url.pathname==='/auth/v1/user')data=user;
  else if(url.pathname==='/rest/v1/profiles')data=[{first_name:'Fixture',last_name:'',avatar_url:''}];
  else if(url.pathname==='/rest/v1/rpc/mavya_allowance')data={plan:'starter',limit:20,used:0,admin:false};
  else if(url.pathname==='/rest/v1/subscriptions')data=[];
  else if(url.pathname==='/rest/v1/runs')data=[{id:rid,user_id:uid,created_at:at,data:run,hook:run.hook,demo:run.demo,title:run.title,updatedAt:at,sourceRefId:refid}];
  else if(url.pathname==='/rest/v1/library')data=url.searchParams.getAll('or').some(x=>x.includes('created_at.lt.'))?[]:[{id:refid,owner:'curated',created_at:at,data:reference,title:'Fixture',mediaId:reference.mediaId,analysis:null}];
  res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();
  setTimeout(()=>res.end(JSON.stringify(data)),url.pathname.includes('/auth/')?8:12);
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+upstream.address().port;
 let jar=[];const client=createServerClient(url,'fixture-anon',{cookies:{getAll:()=>jar,setAll:values=>{for(const c of values)jar=[...jar.filter(x=>x.name!==c.name),c]}}});
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map((x,i)=>Buffer.from(i===2?x:JSON.stringify(x)).toString('base64url')).join('.');
 const session=await client.auth.setSession({access_token:jwt,refresh_token:'fixture-refresh'});if(session.error)throw Error('Fixture session failed');
 const cookie=jar.map(c=>c.name+'='+c.value).join('; '),rows=[];
 try{
  for(const [phase,base] of [['before',process.argv[2]],['after',process.argv[3]]]){
   if(fs.existsSync(path.join(base,'.git'))||fs.existsSync(path.join(base,'.env.local')))throw Error('Use an isolated copy');
   const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p','0'],{cwd:base,env:{...process.env,NODE_OPTIONS:'--import '+preload,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',R2_ACCOUNT_ID:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET:'fixture',ADMIN_USER_IDS:''},stdio:['ignore','pipe','pipe']});children.push(child);
   let output='';child.stderr.on('data',d=>{output+=String(d)});
   const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Next fixture did not start: '+output)),20000);child.stdout.on('data',d=>{const m=/http:\/\/127\.0\.0\.1:(\d+)/.exec(String(d));if(m){clearTimeout(timer);resolve(m[1])}});child.once('exit',()=>reject(Error('Next exited: '+output)))});
   for(let round=0;round<3;round++)for(const api of ['/api/profile','/api/usage','/api/runs','/api/runs/'+rid,'/api/references','/api/assets','/api/file-prefs',...(phase==='before'?['combined-before']:['/api/runs/'+rid+'?view=editor'])]){
    const start=performance.now(),offset=calls.length;
    const get=async api=>{const response=await fetch('http://127.0.0.1:'+port+api,{headers:{cookie},signal:AbortSignal.timeout(15000)});const body=await response.text();if(response.status!==200)throw Error(phase+' '+api+' status '+response.status+' '+body.slice(0,100)+' '+output.slice(-1200));return response.headers.get('server-timing')};
    const timing=api==='combined-before'?(await get('/api/runs/'+rid),await get('/api/references/'+refid)):await get(api);
    if(phase==='after'){
     const values=Object.fromEntries(timing.split(', ').map(p=>p.split(';dur=')));
     if(Object.keys(values).join(',')!=='auth,account,sql,r2')throw Error('Missing duration-only phases');
     if(api==='/api/file-prefs'&&Number(values.r2)<10)throw Error('R2 body read was not measured');
     if(api!=='/api/file-prefs'&&Number(values.sql)<7)throw Error('SQL body read was not measured');
    }
    rows.push({phase,round,api,milliseconds:performance.now()-start,serverTiming:timing,upstream:calls.slice(offset)});
   }
   child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
  }
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true})}
 const result={setup:'Actual Next production handlers and Supabase Auth getUser using a dummy local Auth/SQL HTTP server (8ms Auth,12ms SQL) and offline R2 fetch15ms. No production credentials/data/calls. Phase totals are aggregate service time; parallel SQL may exceed wall time.',rows};
 fs.writeFileSync(process.argv[4],JSON.stringify(result,null,2));console.log('Recorded',rows.length,'real production-handler reads');
}
main().catch(e=>{console.error(e);for(const c of children)c.kill('SIGTERM');process.exit(1)});
