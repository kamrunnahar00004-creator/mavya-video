// Free trial (founder 2026-11-21), migration 0021, in a disposable network-disabled PostgreSQL. Requires the
// postgres:16 Docker image. No app environment, production database or paid services.
// Checks: a trialing account gets 3 AI hooks on any plan (the 4th is refused by the real reservation), the paid
// quota starts fresh when the trial converts, and only an account that never had a subscription is trial-eligible.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const name = `mavya-trial-check-${process.pid}`;
const root = path.resolve(__dirname, '..');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sql = (input) => execFileSync('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const fails = (input) => { try { sql(input); return false; } catch { return true; } };
const user = '10000000-0000-4000-8000-000000000001';
const fresh = '10000000-0000-4000-8000-000000000002';
const lapsed = '10000000-0000-4000-8000-000000000003';
const bound = '10000000-0000-4000-8000-000000000004';
const runs = [1, 2, 3, 4, 5].map((i) => `20000000-0000-4000-8000-00000000000${i}`);
const keys = [1, 2, 3, 4, 5].map((i) => `30000000-0000-4000-8000-00000000000${i}`);
const allowance = (u = user) => JSON.parse(sql(`select mavya_allowance('${u}')`));
const reserve = (i, u = user) => JSON.parse(sql(`select mavya_reserve_generation('${u}','${runs[i]}','${keys[i]}')`));
const eligible = (u) => sql(`select mavya_trial_eligible('${u}')`) === 't';
const setSub = (fields) => sql(`update subscriptions set ${fields} where user_id='${user}'`);
let n = 0;
const check = (fn, label) => { try { fn(); n++; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };

async function main() {
  docker('run', '--detach', '--pull=never', '--network', 'none', '--name', name, '-e', 'POSTGRES_PASSWORD=fixture-only', 'postgres:16');
  try {
    for (let i = 0; ; i++) {
      try { docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); break; }
      catch (e) { if (i === 100) throw e; await new Promise((r) => setTimeout(r, 100)); }
    }
    sql(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
    // 0021 twice: re-running the migration is safe.
    for (const file of ['0001_profiles.sql', '0002_storage.sql', '0003_generation_jobs.sql', '0004_billing_state.sql', '0005_generation_provider_ids.sql', '0021_free_trial.sql', '0021_free_trial.sql']) {
      sql(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
    sql(`insert into auth.users(id,email) values('${user}','a@fixture.invalid'),('${fresh}','b@fixture.invalid'),('${lapsed}','c@fixture.invalid'),('${bound}','d@fixture.invalid');
      insert into subscriptions(user_id,plan,status,cycle,current_period_start,current_period_end,stripe_subscription_id)
        values('${user}','studio','trialing','monthly',now()-interval '1 hour',now()+interval '71 hours','sub_trial');
      insert into billing_subscription_ids(subscription_id,user_id) values('sub_trial','${user}');
      insert into subscriptions(user_id,plan,status,cycle,current_period_start,current_period_end,stripe_subscription_id)
        values('${lapsed}','starter','canceled','monthly',now()-interval '60 days',now()-interval '30 days','sub_old');
      insert into billing_subscription_ids(subscription_id,user_id) values('sub_bound','${bound}');
      ${runs.map((r) => `insert into runs(id,user_id,data) values('${r}','${user}','{"hook":{},"demo":{}}');`).join('\n')}`);

    // Trialing: 3 hooks whatever the plan (Studio would be 150), flagged as a trial, window = the trial itself.
    check(() => {
      const a = allowance();
      assert.equal(a.plan, 'studio'); assert.equal(a.limit, 3); assert.equal(a.trial, true); assert.equal(a.used, 0);
      assert.ok(Math.abs(Date.parse(a.resetsAt) - (Date.now() + 71 * 3600_000)) < 120_000, 'resets when the trial ends');
    }, 'trialing allowance is 3 on Studio');
    for (const plan of ['starter', 'pro']) {
      check(() => { setSub(`plan='${plan}'`); assert.equal(allowance().limit, 3); }, `trialing ${plan} is 3`);
    }
    check(() => { setSub(`cycle='annual'`); const a = allowance(); assert.equal(a.limit, 3); assert.ok(Date.parse(a.resetsAt) <= Date.now() + 72 * 3600_000, 'annual trial window ends with the trial'); setSub(`cycle='monthly'`); }, 'annual trial is 3 for the trial window');
    check(() => { setSub(`cancel_at_period_end=true`); assert.equal(allowance().limit, 3); setSub(`cancel_at_period_end=false`); }, 'a cancelled trial keeps its 3 hooks until it ends');

    // The real reservation: 3 accepted, the 4th refused with quota.
    check(() => { for (const i of [0, 1, 2]) assert.ok(reserve(i).job, `trial hook ${i + 1} accepted`); }, 'three trial hooks reserve');
    check(() => { const r = reserve(3); assert.equal(r.error, 'quota'); assert.equal(r.allowance.limit, 3); assert.equal(r.allowance.used, 3); }, 'the fourth trial hook is refused');
    check(() => { sql(`update generations set refunded_at=now() where run_id='${runs[2]}'`); assert.equal(allowance().used, 2); assert.ok(reserve(3).job, 'a refunded hook frees its slot'); }, 'refunds give a trial hook back');

    // Converts to paid: a new period from the trial end, the plan's own quota, trial hooks not counted.
    check(() => {
      setSub(`status='active',plan='starter',current_period_start=now(),current_period_end=now()+interval '30 days'`);
      const a = allowance();
      assert.equal(a.limit, 20); assert.equal(a.trial, false); assert.equal(a.used, 0);
      assert.ok(reserve(4).job, 'paid hooks reserve after conversion');
    }, 'converting starts the paid quota fresh');
    check(() => { setSub(`status='trialing',current_period_end=now()-interval '1 minute'`); const a = allowance(); assert.equal(a.plan, null); assert.equal(a.limit, 0); }, 'an expired trial window gives nothing');
    check(() => { setSub(`status='canceled',current_period_end=now()+interval '1 day'`); assert.equal(allowance().limit, 0); }, 'a canceled trial gives nothing');
    check(() => { assert.equal(allowance(fresh).limit, 0); assert.equal(allowance(fresh).trial, false); }, 'no subscription: no hooks, no trial flag');

    // One trial per account.
    check(() => assert.equal(eligible(fresh), true), 'a never-subscribed account is eligible');
    check(() => assert.equal(eligible(user), false), 'an account that had a trial is not eligible');
    check(() => assert.equal(eligible(lapsed), false), 'a lapsed paid account is not eligible');
    check(() => assert.equal(eligible(bound), false), 'any recorded subscription id blocks a second trial');

    // Only the server role can call it.
    check(() => {
      assert.ok(fails(`set role anon; select mavya_trial_eligible('${fresh}');`), 'anon cannot');
      assert.ok(fails(`set role authenticated; select mavya_trial_eligible('${fresh}');`), 'authenticated cannot');
      assert.equal(sql(`set role service_role; select mavya_trial_eligible('${fresh}');`).split('\n').pop(), 't');
      assert.ok(fails(`set role authenticated; select mavya_allowance('${fresh}');`), 'allowance stays server-only');
    }, 'grants are server-only');

    // The migration's trial limit matches the app constant.
    check(() => {
      const plans = fs.readFileSync(path.join(root, 'src/lib/plans.ts'), 'utf8');
      const m = plans.match(/TRIAL = \{ days: (\d+), hooks: (\d+) \}/);
      assert.ok(m, 'TRIAL constant found');
      assert.match(fs.readFileSync(path.join(root, 'supabase/migrations/0021_free_trial.sql'), 'utf8'), new RegExp(`status = 'trialing' then ${m[2]} else`));
    }, 'SQL trial hooks equal TRIAL.hooks');
  } finally { docker('rm', '--force', name); }
  console.log(`trial-sql-checks: ${n} checks pass`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
