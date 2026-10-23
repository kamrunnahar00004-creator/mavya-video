// Real signing middleware, but an HTTP handler that throws before any network access.
const assert=require('node:assert/strict'),aws=require('@aws-sdk/client-s3'),{load}=require('./check-module.cjs');
async function main(){
 let sent;
 class FixtureClient extends aws.S3Client{
  constructor(options){super({...options,requestHandler:{handle:async()=>{throw Error('Network forbidden');}}});}
  async send(command){sent=command.input;return {};}
 }
 const api=load('src/lib/server/r2.ts',{
  '@/lib/production-config':{assertProductionConfig(){}},'node:fs':require('node:fs'),'node:stream':require('node:stream'),'node:stream/promises':require('node:stream/promises'),
  '@aws-sdk/client-s3':{...aws,S3Client:FixtureClient},'@aws-sdk/s3-request-presigner':require('@aws-sdk/s3-request-presigner')
 },{R2_ACCOUNT_ID:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture-only',R2_BUCKET:'fixture'});
 const url=new URL(await api.signedPut('tmp/uploads/fixture.png','image/png',900,123));
 assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'));
 assert.equal(url.searchParams.has('x-amz-checksum-crc32'),false);
 await api.copyObject('tmp/uploads/fixture.png','media/fixture.png','verified-etag');
 assert.equal(sent.CopySourceIfMatch,'verified-etag');
 console.log('PASS: offline upload signature binds Content-Length, avoids empty-body checksum and copies only the HEAD-verified object version');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
