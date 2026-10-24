// Real local HTTP worker. Child preload blocks every external fetch before any job starts.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mavya-render-check-'));
 const preload=path.join(dir,'offline.mjs');
 fs.writeFileSync(preload,`import {createRequire,syncBuiltinESMExports} from 'node:module';const require=createRequire(import.meta.url);require('node:os').tmpdir=()=>${JSON.stringify(dir)};syncBuiltinESMExports();globalThis.fetch=async (_url,options={})=>new Promise((_resolve,reject)=>{if(options.signal?.aborted)reject(Error('aborted'));else options.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});`);
 const secret='fixture-only-render-secret-32-characters';
 const child=spawn(process.execPath,['--import',preload,'render/server.mjs'],{env:{...process.env,PORT:'0',RENDER_SECRET:secret},stdio:['ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('exit',resolve));
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker did not start')),5000);child.stdout.on('data',d=>{const m=/render server on (\d+)/.exec(String(d));if(m){clearTimeout(timer);resolve(m[1]);}});child.once('error',reject);});
  const base=`http://127.0.0.1:${port}`;
  const job=n=>({id:`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`,meta:{who:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`},output:{url:'https://fixture.invalid/out',contentType:'video/mp4'},spec:{width:720,height:1280,fps:30,total:3,segments:[{url:'https://fixture.invalid/in',gap:0,speed:1,volume:1,pieces:[{start:0,end:3}]}],sounds:[],overlays:[]}});
  const post=body=>fetch(`${base}/jobs`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  assert.equal((await post(job(1))).status,200);
  assert.equal((await post(job(1))).status,200);
  const changed=job(1);changed.output.url='https://fixture.invalid/changed';assert.equal((await post(changed)).status,409);
  const duplicate=job(10);duplicate.meta.who=job(1).meta.who;assert.equal((await post(duplicate)).status,429);
  for(let n=2;n<=9;n++)assert.equal((await post(job(n))).status,200);
  assert.equal((await post(job(10))).status,429);
  const health=await (await fetch(`${base}/health`)).json();assert.equal(health.queued,8);assert.equal(health.busy,true);assert.equal(health.protocol,2);
  assert.equal((await fetch(`${base}/jobs/${job(1).id}`)).status,401);
  console.log('PASS: real worker HTTP auth, idempotent dispatch, changed-payload conflict, one active export per user and queue cap; all external fetches blocked');
 }finally{
  child.kill('SIGTERM');await closed;
  assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
