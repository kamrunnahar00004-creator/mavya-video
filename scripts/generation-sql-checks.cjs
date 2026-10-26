// Isolated PostgreSQL integration tests. Requires an already installed postgres:16 Docker image.
// No network, ports, app environment, production database, or paid API access.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const name = `mavya-generation-check-${process.pid}`;
const root = path.resolve(__dirname, '..');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sql = (input) => execFileSync('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
const asyncSql = (input) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', err = '';
  child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
  child.on('error', reject); child.on('close', code => code ? reject(new Error(err)) : resolve(out.trim()));
  child.stdin.end(input);
});
const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const run = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
const reserve = (r = run, k = key, u = user) => `select mavya_reserve_generation('${u}','${r}','${k}');`;
const claim = (j, u = user) => JSON.parse(sql(`select mavya_claim_generation('${u}','${j}');`) || 'null');
const transition = (j, token, action, value = null) => sql(`select mavya_generation_transition('${user}','${j}','${token}','${action}',${value === null ? 'null' : `'${value}'`});`);
async function main() {
  docker('run', '--detach', '--pull=never', '--network', 'none', '--name', name, '-e', 'POSTGRES_PASSWORD=fixture-only', 'postgres:16');
  try {
    for (let i = 0; ; i++) {
      try { docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); break; }
      catch (e) { if (i === 100) throw e; await new Promise(r => setTimeout(r, 100)); }
    }
    sql(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
    for (const file of ['0001_profiles.sql', '0002_storage.sql', '0003_generation_jobs.sql', '0003_generation_jobs.sql', '0004_billing_state.sql', '0005_generation_provider_ids.sql', '0005_generation_provider_ids.sql']) {
      sql(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
    sql(`insert into auth.users(id,email) values('${user}','one@fixture.invalid'),('${other}','two@fixture.invalid');
      insert into subscriptions(user_id,plan,status,cycle,current_period_start,current_period_end)
      values('${user}','starter','active','annual',date_trunc('year',now()),date_trunc('year',now())+interval '1 year');
      insert into runs(id,user_id,data) values('${run}','${user}','{"updatedAt":"original","hook":{},"demo":{"keep":true}}');`);
    for (const status of ['active','trialing','past_due','unpaid','canceled']) {
      sql(`update subscriptions set status='${status}' where user_id='${user}'`);
      assert.equal(JSON.parse(sql(`select mavya_allowance('${user}')`)).plan, ['active','trialing'].includes(status)?'starter':null);
    }
    sql(`update subscriptions set status='active',cancel_at_period_end=true where user_id='${user}'`);
    assert.equal(JSON.parse(sql(`select mavya_allowance('${user}')`)).plan,'starter','cancelling stays usable until paid period end');
    sql(`update subscriptions set cancel_at_period_end=false where user_id='${user}'`);
    assert.equal(JSON.parse(sql(reserve(run, key, other))).error, 'not_found');
    const j = JSON.parse(sql(reserve())).job;
    assert.equal(JSON.parse(sql(reserve())).job.id, j.id);
    assert.equal(JSON.parse(sql(reserve(run, '30000000-0000-4000-8000-000000000002'))).job.id, j.id);
    assert.equal(claim(j.id, other), null);
    const lease = claim(j.id);
    assert.equal(claim(j.id), null);
    assert.equal(transition(j.id, key, 'fallback'), 'f');
    assert.throws(() => transition(j.id, lease.lease_token, 'started', 'https://attacker.invalid/task'));
    assert.throws(() => transition(j.id, lease.lease_token, 'started', 'model|id|extra'));
    assert.equal(transition(j.id, lease.lease_token, 'started', key), 't');
    const polling = claim(j.id);
    assert.equal(transition(j.id, polling.lease_token, 'fallback'), 't');
    assert.equal(transition(j.id, polling.lease_token, 'fallback'), 'f');
    const fallback = claim(j.id);
    assert.equal(fallback.fallback_used, true);
    const falTask = `fal-ai/kling-video/v2.6/pro/motion-control|${key}`;
    assert.equal(transition(j.id, fallback.lease_token, 'started', falTask), 't');
    assert.equal(sql(`select fallback_task_id from generations where id='${j.id}'`), falTask);
    const failed = claim(j.id);
    assert.equal(transition(j.id, failed.lease_token, 'failed'), 't');
    assert.equal(transition(j.id, failed.lease_token, 'failed'), 'f');
    assert.equal(sql(`select count(*) from generations where id='${j.id}' and refunded_at is not null`), '1');
    assert.equal(JSON.parse(sql(`select mavya_allowance('${user}')`)).used, 0);
    // 24 independent requests for 20 credits: reservation must serialize across connections.
    const ids = Array.from({ length: 24 }, (_, i) => `20000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
    sql(ids.map(id => `insert into runs(id,user_id,data) values('${id}','${user}','{"updatedAt":"original","hook":{},"demo":{"keep":true}}');`).join('\n'));
    const admitted = (await Promise.all(ids.map((id, i) => asyncSql(reserve(id, `30000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`))))).map(JSON.parse);
    assert.equal(admitted.filter(x => x.job).length, 20);
    assert.equal(admitted.filter(x => x.error === 'quota').length, 4);
    const allowance = JSON.parse(sql(`select mavya_allowance('${user}')`));
    assert.equal(allowance.used, 20);
    assert.ok(new Date(allowance.resetsAt) - new Date(allowance.since) <= 31 * 86400000);
    sql(`update generations set created_at = date_trunc('month',now()) - interval '1 second' where user_id='${user}';`);
    assert.equal(JSON.parse(sql(`select mavya_allowance('${user}')`)).used, 0);
    // Expired paid period grants nothing; old-generation rows still count when in the window.
    sql(`update subscriptions set current_period_end=now()-interval '1 second' where user_id='${user}';`);
    assert.equal(JSON.parse(sql(`select mavya_allowance('${user}')`)).limit, 0);
    sql(`update subscriptions set current_period_end=date_trunc('year',now())+interval '1 year' where user_id='${user}';`);
    // A Jan 31 anchor clamps February and returns to the original day in March.
    sql(`update subscriptions set current_period_start=(date_trunc('year',now())-interval '1 year')+interval '30 days', current_period_end=now()+interval '1 year' where user_id='${user}';`);
    const clamped = JSON.parse(sql(`select mavya_allowance('${user}')`));
    const now = new Date(sql('select now();'));
    const boundary = month => new Date(Date.UTC(now.getUTCFullYear(), month + 1, 0));
    const thisBoundary = boundary(now.getUTCMonth());
    const expectedStart = thisBoundary > now ? boundary(now.getUTCMonth() - 1) : thisBoundary;
    const expectedEnd = thisBoundary > now ? thisBoundary : boundary(now.getUTCMonth() + 1);
    assert.equal(new Date(clamped.since).getTime(), expectedStart.getTime());
    assert.equal(new Date(clamped.resetsAt).getTime(), expectedEnd.getTime());
    sql(`update subscriptions set current_period_start=date_trunc('year',now()) where user_id='${user}';`);
    // Completion is an atomic CAS and is idempotent, preserving unrelated run sections.
    const done = admitted.find(x => x.job).job;
    const start = claim(done.id); transition(done.id, start.lease_token, 'started', key);
    const finish = claim(done.id);
    const complete = expected => `select mavya_complete_generation('${user}','${done.id}','${finish.lease_token}','${expected}','{"hook":{"generated":{"src":"fixture"}},"texts":[]}','{"src":"fixture"}');`;
    assert.deepEqual(JSON.parse(sql(complete('stale'))), { retry: true });
    assert.deepEqual(JSON.parse(sql(complete('original'))), { src: 'fixture' });
    assert.deepEqual(JSON.parse(sql(complete('original'))), { src: 'fixture' });
    assert.equal(sql(`select data->'demo'->>'keep' from runs where id='${done.run_id}'`), 'true');
    // Lost create response never replays paid work when the lease expires.
    const uncertain = admitted.filter(x => x.job)[1].job;
    claim(uncertain.id);
    sql(`update generations set lease_until=now()-interval '1 second' where id='${uncertain.id}'`);
    assert.equal(claim(uncertain.id), null);
    assert.equal(sql(`select state from generations where id='${uncertain.id}'`), 'uncertain');
    assert.equal(sql(`select has_function_privilege('authenticated','mavya_reserve_generation(uuid,uuid,uuid,text,boolean)','execute')`), 'f');
    assert.equal(sql(`select has_function_privilege('service_role','mavya_reserve_generation(uuid,uuid,uuid,text,boolean)','execute')`), 't');

    // New admission migration is exercised only in this disposable, network-disabled database.
    for(let i=0;i<2;i++) sql(fs.readFileSync(path.join(root,'supabase/migrations/0015_atomic_refund_admission.sql'),'utf8'));
    const capRun='20000000-0000-4000-8000-000000000900', freshRun='20000000-0000-4000-8000-000000000901';
    const capJob='40000000-0000-4000-8000-000000000900', capToken='50000000-0000-4000-8000-000000000900';
    sql(`insert into runs(id,user_id,data) values('${capRun}','${other}','{"hook":{},"demo":{}}'),('${freshRun}','${other}','{"hook":{},"demo":{}}');
      insert into subscriptions(user_id,plan,status,cycle,current_period_start,current_period_end) values('${other}','starter','active','monthly',now(),now()+interval '1 month') on conflict(user_id) do update set plan='starter',status='active',current_period_start=now(),current_period_end=now()+interval '1 month';
      insert into generations(id,user_id,run_id,request_key,state,input,refunded_at)
      select gen_random_uuid(),'${other}','${capRun}',gen_random_uuid(),'failed','{}',now() from generate_series(1,9);
      insert into generations(id,user_id,run_id,request_key,state,input,lease_token,lease_until) values('${capJob}','${other}','${capRun}',gen_random_uuid(),'running','{}','${capToken}',now()+interval '1 minute');`);
    const refunding=asyncSql(`begin;select mavya_generation_transition('${other}','${capJob}','${capToken}','failed');select pg_sleep(0.7) /* part2_refund_hold */;commit;`);
    let holding=false;
    for(let i=0;i<50;i++){
      holding=sql("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and query like '%part2_refund_hold%' and wait_event='PgSleep')")==='t';
      if(holding) break;
      await new Promise(r=>setTimeout(r,10));
    }
    assert.ok(holding,'refund transaction holds the shared user lock');
    const blocked = await Promise.all(Array.from({length:6},()=>asyncSql(reserve(freshRun, require('node:crypto').randomUUID(), other))));
    await refunding;
    assert.ok(blocked.every(x=>JSON.parse(x).error==='attempts'),'parallel admission cannot pass a committing tenth refund');
    const replayKey=sql(`select request_key from generations where id='${capJob}'`);
    assert.equal(JSON.parse(sql(reserve(capRun,replayKey,other))).job.id,capJob,'existing request replay survives the cap');
    console.log('PASS: migration replay, ownership, request replay, parallel quota, shared monthly window, leases, bound legacy/fal task IDs, one fallback/refund, completion CAS/replay, uncertain recovery, RPC grants');
  } finally { docker('rm', '--force', name); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
