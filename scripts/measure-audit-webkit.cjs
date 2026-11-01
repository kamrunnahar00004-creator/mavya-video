// Manual WebKit smoke check against an isolated production build only.
// PLAYWRIGHT_PATH points to a separately installed Playwright, outside this repository.
const fs=require('node:fs'),path=require('node:path');
const {webkit}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fixtureSource=fs.readFileSync(path.join(__dirname,'measure-full-audit.cjs'),'utf8');
const {run,refs,runs}=new Function(fixtureSource.slice(fixtureSource.indexOf('const id='),fixtureSource.indexOf('const sleep='))+'return {run,refs,runs}')();
(async()=>{
 const browser=await webkit.launch({headless:true}),rows=[];
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    let body={};
    if(url.pathname==='/api/runs')body=runs;
    else if(/^\/api\/runs\/[^/]+$/.test(url.pathname))body=run;
    else if(url.pathname==='/api/references')body=refs;
    else if(url.pathname==='/api/assets')body=[];
    else if(url.pathname==='/api/file-prefs')body={names:{},hidden:[]};
    else if(url.pathname==='/api/profile')body={email:'fixture@invalid.test',firstName:'Audit',lastName:'',avatar:''};
    else if(url.pathname==='/api/usage')body={plan:'starter',limit:20,used:0};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   for(const pathname of ['/studio','/studio/'+run.id]){
    await page.goto('http://127.0.0.1:'+process.argv[2]+pathname);
    await page.getByText('Audit video',{exact:true}).first().waitFor().catch(()=>{});
    await page.waitForTimeout(1200);
    const geometry=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector('main')?.getBoundingClientRect().width,videos:document.querySelectorAll('video').length,buttons:[...document.querySelectorAll('main button')].filter(b=>b.getBoundingClientRect().width>0).length}));
    if(pathname.includes('/studio/')){
     await page.getByRole('button',{name:'Edit video',exact:true}).click({force:true});
     await page.getByRole('dialog',{name:'Edit video',exact:true}).waitFor();
     geometry.editor=await page.getByRole('dialog',{name:'Edit video',exact:true}).evaluate(el=>({width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    }
    rows.push({engine:'Playwright WebKit, not branded Safari or a physical iPhone',mobile,pathname,...geometry,errors:[...errors]});
   }
   await context.close();
  }
 }finally{await browser.close()}
 fs.writeFileSync(process.argv[3],JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
})().catch(e=>{console.error(e);process.exitCode=1});
