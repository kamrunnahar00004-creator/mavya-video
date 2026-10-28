const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
async function main(){
 let count=0,releases=[],values=[],state=0,fail=false;
 const react={useState(initial){const index=state++;values[index]=initial;return [initial,value=>values[index]=value];},useRef:value=>({current:value}),useCallback:f=>f,useEffect(){}};
 const api=load('src/components/settings-shell.tsx',{'react':react,'react/jsx-runtime':{},'@/components/pending-link':{},'next/navigation':{},'lucide-react':{},'@/lib/profile':{},'@/lib/plans':{planById:()=>null}}, {}, {fetch:async(url,options)=>{count++;assert.ok(options.signal);await new Promise(resolve=>releases.push(resolve));return fail?new Response(null,{status:503}):Response.json(url.includes('usage')?{plan:null}:{subscription:null});}});
 const account=api.useAccount({billing:true});
 const first=account.reload(),second=account.reload();assert.equal(first,second);assert.equal(count,2);
 releases.splice(0).forEach(resolve=>resolve());await first;assert.equal(values[3],false);
 fail=true;const unavailable=account.reload();releases.splice(0).forEach(resolve=>resolve());await unavailable;assert.equal(values[3],true);assert.equal(count,4);
 console.log('PASS: settings reload deduplicates concurrent requests, uses deadlines and distinguishes transport failure from no subscription');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
