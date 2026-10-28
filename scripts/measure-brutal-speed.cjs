// Offline production-build browser fixture. Never point at a deployed application.
// Windows Node drives a dedicated muted Chrome at :9232; both app servers are credential-free copies.
const fs = require('node:fs');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=';
const at = '2026-10-28T00:00:00.000Z';
const refs = Array.from({ length: 40 }, (_, n) => ({ id: id(n + 100), title: 'Fixture hook ' + n, owner: 'curated', platform: 'instagram', sourceUrl: '', mediaId: id(n + 100) + '.mp4', views: 10000, createdAt: at, ai: { style: 'text_music' }, analysis: { cuts: [], duration: 8, width: 720, height: 1280, segments: [{ role: 'hook', start: 0, end: 3, thumb: pixel }] }, recipe: { onScreenText: [{ text: 'Fixture' }] } }));
const video = { id: id(0), title: 'Fixture video', createdAt: at, updatedAt: at, sourceRefId: null, hook: { mode: 'upload', clip: null, text: 'Fixture text', avatarIndex: null, variationIndex: null }, demo: { clip: null, frame: 'none' }, sounds: [], texts: [], project: null };
const scenarios = [
  ['Videos to library', '/studio', '/library'],
  ['Library to videos', '/library', '/studio'],
  ['Videos to settings', '/studio', '/settings'],
  ['Settings to plans', '/settings', '/settings/plans'],
  ['Settings to billing', '/settings', '/settings/billing'],
  ['Settings to usage', '/settings', '/settings/usage'],
  ['Settings to videos', '/settings', '/studio'],
  ['Open video', '/studio', '/studio/' + id(0)],
  ['Video to videos', '/studio/' + id(0), '/studio'],
  ['New video', '/studio', 'new'],
  ['Use library hook', '/library', 'pick'],
  ['Open editor', '/studio/' + id(0), 'editor'],
  ['Reference detail (route probe)', '/library', '/library/' + id(100)],
  ['Legacy edit redirect (route probe)', '/studio', '/studio/' + id(0) + '/edit'],
  ['Landing to signup', '/', 'signup'],
  ['Close signup', '/?auth=signup', 'closeAuth'],
  ['Signup to pricing (SDK and continuation stubs)', '/?auth=signup', 'submitSignup'],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const tabs = await (await fetch('http://localhost:9232/json')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let sequence = 0;
  const pending = new Map(), errors = [], requests = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++sequence; pending.set(n, m => m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params, u = new URL(request.url);
    const dispatch = (method, params) => void send(method, params).catch(() => {});
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) { dispatch('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
    // Cold destination stress: the guarantee must hold when prefetch has not finished or is unavailable.
    if (Object.entries(request.headers).some(([k, v]) => k.toLowerCase() === 'next-router-prefetch' && v === '1')) {
      setTimeout(() => dispatch('Fetch.continueRequest', {requestId}), 2500); return;
    }
    if (u.pathname === '/auth/continue') {
      setTimeout(() => dispatch('Fetch.fulfillRequest', { requestId, responseCode: 302, responseHeaders: [{name:'Location',value:'/pricing'}], body:'' }), 250); return;
    }
    if (!u.pathname.startsWith('/api/')) { dispatch('Fetch.continueRequest', { requestId }); return; }
    requests.push({ path: u.pathname, method: request.method });
    let body = {}, status = 200, delay = 250;
    if (u.pathname === '/api/runs') body = request.method === 'POST' ? { ...video, id: JSON.parse(request.postData || '{}').id ?? id(1) } : [video];
    else if (u.pathname === '/api/references') { body = refs.map(r => ({ ...r, partial: true })); delay = 1500; }
    else if (/^\/api\/references\/[^/]+$/.test(u.pathname)) body = refs[0];
    else if (/^\/api\/runs\/[^/]+$/.test(u.pathname)) body = { ...video, id: u.pathname.split('/')[3] };
    else if (u.pathname === '/api/profile') body = { email: 'fixture@invalid.test', firstName: 'Fixture', lastName: 'User', avatar: '' };
    else if (u.pathname === '/api/usage') body = { plan: 'starter', admin: false, used: 0, limit: 20, resetsAt: '2026-11-28T00:00:00Z' };
    else if (u.pathname === '/api/billing') body = { enabled: true, subscription: { plan: 'starter', cycle: 'monthly', status: 'active', periodEnd: '2026-11-28T00:00:00Z', cancelAtPeriodEnd: false }, card: null, invoices: [] };
    else if (u.pathname === '/api/assets' || u.pathname === '/api/songs') body = [];
    else if (u.pathname.startsWith('/api/media/')) status = 404;
    setTimeout(() => dispatch('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }), delay);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 250, downloadThroughput: 1250000, uploadThroughput: 250000 });
  await send('Emulation.setCPUThrottlingRate', { rate: 2 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const rows = [];
  for (let round = 0; round < Number(process.env.ROUNDS ?? 3); round++) for (const [phase, port] of [['before', 3450], ['after', Number(process.env.AFTER_PORT ?? 3451)]]) for (const [name, source, target] of scenarios.filter(([name]) => !process.env.FILTER || name.toLowerCase().includes(process.env.FILTER.toLowerCase()))) {
    console.log('START', round, phase, name);
    await send('Network.clearBrowserCache');
    const launched = Date.now();
    const navigation = await send('Page.navigate', { url: `http://localhost:${port}${source}` });
    if (navigation.errorText) throw Error(navigation.errorText);
    let sourceReady = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      await sleep(200);
      sourceReady = await evaluate(`(() => {
        if (location.href !== ${JSON.stringify('http://localhost:')} + ${port} + ${JSON.stringify(source)} || performance.timeOrigin < ${launched-5} || document.readyState !== 'complete') return false;
        const source = ${JSON.stringify(source)}, main = document.querySelector('main') || document.body;
        if (!main) return false;
        if (source === '/') return !!main.querySelector('h1') && document.readyState === 'complete';
        if (source.startsWith('/?auth=')) return !!document.querySelector('[role="dialog"] input[type="email"]');
        if (source === '/studio') return !!main.querySelector('a[href="/studio/10000000-0000-4000-8000-000000000000"]');
        if (source === '/library') return Array.from(main.querySelectorAll('button')).some(b => b.textContent.includes('Use this hook'));
        if (source === '/settings') return !!main.querySelector('input[value="Fixture"]');
        return !!main.querySelector('input[value="Fixture video"]');
      })()`).catch(() => false);
      if (sourceReady) break;
    }
    if (!sourceReady) throw Error('Source never became usable: ' + phase + ' ' + name + ' recent ' + JSON.stringify(requests.slice(-10)));
    await sleep(source === "/" ? 1500 : 150);
    let result;
    if (target === 'submitSignup') {
      await evaluate(`(() => {
        for (const input of document.querySelectorAll('[role="dialog"] input')) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,input.type==='email'?'fixture@invalid.test':input.type==='password'?'password123':'Fixture User');
          input.dispatchEvent(new Event('input',{bubbles:true}));
        }
      })()`);
      await sleep(100);
      const start = Date.now();
      const visual = await evaluate(`new Promise(resolve => {
        const start=performance.now(),button=document.querySelector('[role="dialog"] button[type="submit"]');
        const observer=new MutationObserver(()=>{if(button.disabled){observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));}});
        observer.observe(button,{attributes:true,childList:true,subtree:true});button.click();
        setTimeout(()=>{observer.disconnect();resolve(null)},2000);
      })`);
      let usable = null;
      for (let attempt=0;attempt<100;attempt++) {
        await sleep(100);
        const done = await evaluate(`location.pathname==='/pricing' && document.body.textContent.includes('$29')`).catch(()=>false);
        if(done){usable=Date.now()-start;break;}
      }
      result={visualMs:visual,usableMs:usable,path:'/pricing'};
    } else result = await evaluate(`new Promise(resolve => {
      let start = 0; const target = ${JSON.stringify(target)}, main = document.querySelector('main') || document.body;
      if (!main || document.title === '') { resolve({error:'Source did not load'}); return; }
      let mainChanged = false;
      const hadDialog = !!document.querySelector('[role="dialog"]'); let visual = null, usable = null, started = false;
      const done = () => { observer.disconnect(); clearInterval(timer); resolve({visualMs:visual, usableMs:usable, path:location.pathname}); };
      const ready = () => {
        if (target === 'signup') return !!document.querySelector('[role="dialog"] input[type="email"]');
        if (target === 'closeAuth') return !document.querySelector('[role="dialog"]') && !location.search.includes('auth=');
        if (target === 'submitSignup') return location.pathname === '/pricing' && document.body.textContent.includes('$29');
        if (target.startsWith('/library/')) return location.pathname === target && Array.from(main.querySelectorAll('button')).some(b => b.textContent.includes('Use in a new run') && !b.disabled);
        if (target === 'editor') return !!document.querySelector('[role="dialog"][aria-label="Edit video"]');
        if (target === 'new' || target === 'pick' || /studio\\//.test(target)) return location.pathname.startsWith('/studio/') && !!document.querySelector('input[value="Fixture video"]');
        if (location.pathname !== target) return false;
        if (target === '/studio') return !!main.querySelector('a[href="/studio/10000000-0000-4000-8000-000000000000"]');
        if (target === '/library') return Array.from(main.querySelectorAll('button')).some(b => b.textContent.includes('Use this hook'));
        if (target === '/settings/plans') return main.textContent.includes('Current plan');
        if (target === '/settings/billing') return Array.from(main.querySelectorAll('button')).some(b => b.textContent.trim() === 'Update' && !b.disabled);
        if (target === '/settings') return !!main.querySelector('input[value="Fixture"]');
        return !main.querySelector('[aria-busy="true"]') && !main.textContent.includes('...') && !!main.querySelector('h1');
      };
      const check = () => {
        if (!started) return;
        const pending = document.querySelector('[aria-label="Opening page"]') || document.querySelector('[aria-label="Checking account"]');
        const changed = pending || document.querySelector('[data-navigation-pending]') || document.querySelector('[data-route-skeleton]') || (target === 'signup' ? !!document.querySelector('[role="dialog"]') : target === 'closeAuth' ? !document.querySelector('[role="dialog"]') : mainChanged || !!document.querySelector('[role="dialog"]') !== hadDialog);
        if (visual === null && changed) {
          visual = -1; requestAnimationFrame(() => requestAnimationFrame(() => { visual = performance.now()-start; }));
        }
        if (usable === null && ready()) { usable = -1; requestAnimationFrame(() => requestAnimationFrame(() => { usable = performance.now()-start; })); }
        if (visual > 0 && usable > 0) done();
      };
      const visibleNode = node => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return element && !element.closest('script,style,link,[data-review-probes]') && node.nodeType !== Node.COMMENT_NODE;
      };
      const observer = new MutationObserver(records => {
        if (records.some(r => r.type === 'childList' ? [...r.addedNodes,...r.removedNodes].some(visibleNode) : visibleNode(r.target))) mainChanged = true;
        check();
      }); observer.observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','disabled','aria-busy','inert'],characterData:true});
      const timer = setInterval(check,16);
      let node;
      if (target === 'signup') node = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '?auth=signup');
      else if (target === 'closeAuth') node = document.querySelector('[role="dialog"] button[aria-label="Close"]');
      else if (target === 'submitSignup') {
        for (const input of document.querySelectorAll('[role="dialog"] input')) {
          const value = input.type === 'email' ? 'fixture@invalid.test' : input.type === 'password' ? 'password123' : 'Fixture User';
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', {bubbles:true}));
        }
        node = document.querySelector('[role="dialog"] button[type="submit"]');
      }
      else if (target === 'new') node = Array.from(main.querySelectorAll('button')).find(b => b.textContent.trim()==='New video');
      else if (target === 'pick') node = Array.from(main.querySelectorAll('button')).find(b => b.textContent.includes('Use this hook'));
      else if (target === 'editor') node = Array.from(main.querySelectorAll('button')).find(b => b.textContent.trim()==='Edit video');
      else node = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href')===target);
      if (!node) { observer.disconnect(); clearInterval(timer); resolve({error:'Missing control',target}); return; }
      start = performance.now(); started = true; node.click(); check(); setTimeout(done,9000);
    })`);
    rows.push({ round, phase, name, ...result });
    console.log('RESULT', phase, name, JSON.stringify(result));
    if (result.error || result.usableMs === null || result.visualMs === null) console.error('INCOMPLETE', phase, name, result);
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = scenarios.map(([name]) => ({ name, ...Object.fromEntries(['before', 'after'].map(phase => [phase, Object.fromEntries(['visualMs', 'usableMs'].map(key => [key, median(rows.filter(r => r.name === name && r.phase === phase).map(r => r[key]))]))])) }));
  const result = { profile: 'Offline credential-free production builds; Chrome 156, 1440x1000, CPU 2x, 250 ms network latency, 10/2 Mbps, API fixture delay 250 ms, intentionally slow library 1500 ms, cold caches and prefetch delayed 2500 ms (it may finish before click). Visual is two animation frames after the first relevant main-content/pending DOM mutation; scripts, styles, comments and hidden route probes are ignored, not a hardware display measurement. Three rounds. API network never reaches servers. No authenticated proxy RPC latency included.', rows, summary, errors, requests,
    fixtureOverrides: ['Proxy is passthrough only in temporary copies', 'Browser Auth SDK is a 250 ms stub only in temporary copies', 'Auth continuation redirects to Pricing through a browser transport stub', 'Hidden client-link probes cover the reference detail and legacy edit alias only'],
    productHeads: {before:'bc79ce9',after:process.env.AFTER_COMMIT??'not supplied'}
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(summary, null, 2)); console.log('Runtime errors:', errors.length);
  await send('Page.navigate', {url:'about:blank'}); await sleep(100);
  await send('Fetch.disable'); await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ws.close();
  if (errors.length || rows.some(r => r.error || r.usableMs === null || r.visualMs === null)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });
