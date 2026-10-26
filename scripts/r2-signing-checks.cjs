// Real signing middleware, but an HTTP handler that throws before any network access.
const assert=require('node:assert/strict'),aws=require('@aws-sdk/client-s3'),{load}=require('./check-module.cjs');
async function main(){
 let sent,signs=0;
 const signer=require("@aws-sdk/s3-request-presigner");
 class FixtureClient extends aws.S3Client{
  constructor(options){super({...options,requestHandler:{handle:async()=>{throw Error('Network forbidden');}}});}
  async send(command){sent=command.input;return {};}
 }
 const api=load('src/lib/server/r2.ts',{
  '@/lib/production-config':{assertProductionConfig(){}},'node:fs':require('node:fs'),'node:stream':require('node:stream'),'node:stream/promises':require('node:stream/promises'),
  '@/lib/server/work-budget':{workSignal:ms=>AbortSignal.timeout(ms)},
  '@aws-sdk/client-s3':{...aws,S3Client:FixtureClient},'@aws-sdk/s3-request-presigner':{getSignedUrl:(...args)=>{signs++;return signer.getSignedUrl(...args);}}
 },{R2_ACCOUNT_ID:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture-only',R2_BUCKET:'fixture'});
 const url=new URL(await api.signedPut('tmp/uploads/fixture.png','image/png',900,123));
 assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'));
 assert.equal(url.searchParams.has('x-amz-checksum-crc32'),false);
 await api.copyObject('tmp/uploads/fixture.png','media/fixture.png','verified-etag');
 assert.equal(sent.CopySourceIfMatch,'verified-etag');
 const count=signs;
 const reads=await Promise.all(Array.from({length:1000},()=>api.signedGet('media/shared-fixture.mp4')));
 assert.equal(signs-count,1,'concurrent reads share one signing operation');assert.ok(reads.every(x=>x===reads[0]));
 await api.signedGet('media/shared-fixture.mp4',3600,'download.mp4');assert.equal(signs-count,2,'download disposition has a distinct signature');
 await api.signedGet('media/shared-fixture.mp4',60);await api.signedGet('media/shared-fixture.mp4',60);assert.equal(signs-count,4,'short grants are not reused');
 console.log('PASS: offline upload signature binds Content-Length, avoids empty-body checksum and copies only the HEAD-verified object version');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
