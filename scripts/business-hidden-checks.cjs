/**
 * Business (done for you) stays hidden until the service launches (founder 2026-11-21): no card, no compare column or
 * group, no FAQ entry on /pricing, and no card on the in-app Plans page. Renders the real components with SHOW_BUSINESS
 * false, then true, so turning the flag back on still shows everything.
 */
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{load}=require('./check-module.cjs');
let n=0;const ok=(c,m)=>{if(!c){console.error('FAIL:',m);process.exit(1);}n++;};
const icon=()=>null;
const plansFor=(show)=>{const p=load('src/lib/plans.ts');return {...p,SHOW_BUSINESS:show};};
const common=(plans)=>({react:React,'react/jsx-runtime':require('react/jsx-runtime'),'@/components/pending-link':{__esModule:true,default:(p)=>React.createElement('a',{href:p.href},p.children)},'lucide-react':new Proxy({},{get:()=>icon}),'@/components/contact-dialog':{ContactDialog:()=>null},'@/lib/plans':plans});
const pricing=(show)=>{const plans=plansFor(show);const m=load('src/components/pricing-page.tsx',{...common(plans),'@/components/marketing-chrome':{MarketingFooter:()=>null,MarketingHeader:()=>null,MavyaMark:()=>null}},{},{fetch:async()=>new Response('{}')});return renderToStaticMarkup(React.createElement(m.PricingPage));};
const plansView=(show)=>{const plans=plansFor(show);const cards=load('src/components/plan-cards.tsx',common(plans));
 const m=load('src/components/plans-view.tsx',{...common(plans),'next/navigation':{useRouter:()=>({push(){},refresh(){}})},'@/components/plan-cards':cards,'@/components/settings-shell':{BTN_OUTLINE:'',SettingsPage:(p)=>React.createElement('div',null,p.children),billingAction:async()=>{},useAccount:()=>({billing:null,plan:null,loaded:true,error:null,reload(){}}),useToast:()=>[null,()=>{}]}});
 return renderToStaticMarkup(React.createElement(m.PlansView));};

ok(load('src/lib/plans.ts').SHOW_BUSINESS===false,'Business is hidden in the shipped plans');
const off=pricing(false);
ok(!off.includes('Pay for results'),'pricing: no Business card');
ok(!off.includes('We run your short-form for you'),'pricing: no Business card line');
ok(!/<th[^>]*>Business<\/th>/.test(off),'pricing: no Business column in compare');
ok(!off.includes('Done for you</th>'),'pricing: no Done for you compare group');
ok(!off.includes('How does Business work?'),'pricing: no Business FAQ');
ok(off.includes('lg:grid-cols-3'),'pricing: three cards fill the row');
const rows=[...off.matchAll(/<tr class="border-t border-line">(.*?)<\/tr>/g)].map((m)=>(m[1].match(/<td/g)||[]).length);
ok(rows.length>0&&rows.every((c)=>c===3),'pricing: every compare row has one cell per plan');
const on=pricing(true);
ok(on.includes('Pay for results')&&on.includes('How does Business work?')&&/<th[^>]*>Business<\/th>/.test(on),'pricing: flag on shows Business again');
const pv=plansView(false);
ok(!pv.includes('Pay for results')&&!pv.includes('Contact us'),'Plans: no Business card');
ok(pv.includes('xl:grid-cols-3'),'Plans: three cards fill the row');
ok(plansView(true).includes('Pay for results'),'Plans: flag on shows Business again');
console.log(`business-hidden-checks: ${n} checks pass`);
