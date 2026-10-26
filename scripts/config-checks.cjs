const assert=require('node:assert/strict'),{load}=require('./check-module.cjs');
const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'];
const complete={NODE_ENV:'production',...Object.fromEntries(keys.map(k=>[k,'fixture']))};
assert.equal(load('src/lib/production-config.ts',{},complete).productionReady(),true);
for(const key of keys){const env={...complete};delete env[key];const api=load('src/lib/production-config.ts',{},env);assert.equal(api.productionReady(),false);assert.throws(()=>api.assertProductionConfig());}
assert.equal(load('src/lib/production-config.ts',{},{}).productionReady(),true);
for(const value of [undefined,'','wrong','whsec_','whsec_has space'])assert.equal(load('src/lib/production-config.ts',{}, {...complete,STRIPE_WEBHOOK_SECRET:value}).stripeWebhookSecret(),null);
assert.equal(load('src/lib/production-config.ts',{}, {...complete,STRIPE_WEBHOOK_SECRET:' whsec_fixture '}).stripeWebhookSecret(),'whsec_fixture');
assert.equal(load('src/lib/production-config.ts',{}, {...complete,STRIPE_WEBHOOK_SECRET:'wrong'}).productionReady(),true);
console.log('PASS: every missing production auth/storage/accounting setting fails closed; development local mode retained');
