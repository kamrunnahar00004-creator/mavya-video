// Offline signing/interval measurements. Never sends an R2 request.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks'),aws=require('@aws-sdk/client-s3'),signer=require('@aws-sdk/s3-request-presigner'),{load}=require('./check-module.cjs');
const baseline=process.argv[2],out=process.argv[3];
async function main(){
 const rows=[];
 for(let round=0;round<3;round++)for(const phase of ['before','after']){
  let signs=0;
  class Client extends aws.S3Client{constructor(options){super({...options,requestHandler:{handle:async()=>{throw Error('Network forbidden');}}});}}
  const api=load(path.join(phase==='before'?baseline:process.cwd(),'src/lib/server/r2.ts'),{
   '@/lib/production-config':{assertProductionConfig(){}},'@/lib/server/work-budget':{workSignal:ms=>AbortSignal.timeout(ms)},
   'node:fs':require('node:fs'),'node:stream':require('node:stream'),'node:stream/promises':require('node:stream/promises'),
   '@aws-sdk/client-s3':{...aws,S3Client:Client},'@aws-sdk/s3-request-presigner':{getSignedUrl:(...args)=>{signs++;return signer.getSignedUrl(...args);}}
  },{R2_ACCOUNT_ID:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture-only',R2_BUCKET:'fixture'});
  const start=performance.now();await Promise.all(Array.from({length:1000},()=>api.signedGet('media/fixture.mp4')));
  rows.push({phase,round,signs,ms:performance.now()-start});
 }
 const median=v=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)],{pollDelay}=load('src/lib/polling.ts');
 const data={setup:'Node 22; actual AWS signing middleware, dummy credentials, HTTP forbidden; 1,000 concurrent identical reads, 3 rounds',rows,summary:Object.fromEntries(['before','after'].map(phase=>[phase,Object.fromEntries(['ms','signs'].map(k=>[k,median(rows.filter(r=>r.phase===phase).map(r=>r[k]))]))])),polling:{exportForegroundMs:pollDelay(2500),generationForegroundMs:pollDelay(4000),hiddenMs:pollDelay(2500,0,true),outageCeilingMs:pollDelay(2500,4)}};
 console.log(JSON.stringify(data));if(out)fs.writeFileSync(out,JSON.stringify(data,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
