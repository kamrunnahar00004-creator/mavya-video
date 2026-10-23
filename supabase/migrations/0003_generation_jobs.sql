-- C1/H1/H2/H8: quota reservations and server-owned generation jobs.
-- Apply after 0002. All RPCs are service-role only; user IDs/admin status come from server auth.
begin;

alter table public.generations
  add column if not exists request_key uuid,
  add column if not exists state text not null default 'legacy',
  add column if not exists input jsonb,
  add column if not exists reference jsonb,
  add column if not exists note text,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists fallback_task_id text,
  add column if not exists result jsonb,
  add column if not exists error text,
  add column if not exists refunded_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists generations_request_key on public.generations(user_id, request_key) where request_key is not null;
create unique index if not exists generations_one_active_run on public.generations(user_id, run_id)
  where state in ('reserved', 'starting', 'running', 'uncertain');
create index if not exists generations_recovery on public.generations(updated_at) where state in ('reserved', 'starting', 'running');

-- Annual allocations use monthly anniversaries of the original anchor, clamped per month.
-- Recomputing from that original anchor avoids Jan 31 -> Feb 28 -> Mar 28 drift.
create or replace function public.mavya_allowance(p_user uuid, p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subscriptions; t timestamptz := now(); a timestamptz; b timestamptz;
  n integer; lim integer := 0; used bigint; paid boolean := false;
begin
  select * into s from public.subscriptions where user_id = p_user;
  paid := coalesce(s.plan is not null and s.status in ('active', 'trialing')
    and s.current_period_start <= t and s.current_period_end > t, false);
  a := date_trunc('month', t at time zone 'UTC') at time zone 'UTC';
  b := a + interval '1 month';
  if paid then
    a := s.current_period_start; b := s.current_period_end;
    if s.cycle = 'annual' then
      n := (extract(year from t at time zone 'UTC')::int - extract(year from a at time zone 'UTC')::int) * 12
        + extract(month from t at time zone 'UTC')::int - extract(month from a at time zone 'UTC')::int;
      a := ((s.current_period_start at time zone 'UTC') + make_interval(months => n)) at time zone 'UTC';
      if a > t then
        n := n - 1;
        a := ((s.current_period_start at time zone 'UTC') + make_interval(months => n)) at time zone 'UTC';
      end if;
      b := least(s.current_period_end, ((s.current_period_start at time zone 'UTC') + make_interval(months => n + 1)) at time zone 'UTC');
    end if;
    lim := case s.plan when 'starter' then 20 when 'pro' then 60 when 'studio' then 150 else 0 end;
  end if;
  select count(*) into used from public.generations
    where user_id = p_user and created_at >= a and created_at < b and refunded_at is null;
  return jsonb_build_object('plan', case when paid then s.plan else null end, 'admin', p_admin,
    'used', used, 'limit', case when p_admin then null else lim end, 'resetsAt', b, 'since', a);
end $$;

create or replace function public.mavya_reserve_generation(p_user uuid, p_run uuid, p_key uuid,
  p_note text default null, p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations; r jsonb; ref jsonb; a jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 13001));
  select data into r from public.runs where id = p_run and user_id = p_user for update;
  if r is null then return jsonb_build_object('error', 'not_found'); end if;
  select * into j from public.generations where user_id = p_user and request_key = p_key;
  if found then
    if j.run_id <> p_run then return jsonb_build_object('error', 'conflict'); end if;
    return jsonb_build_object('job', to_jsonb(j));
  end if;
  select * into j from public.generations where user_id = p_user and run_id = p_run
    and state in ('reserved', 'starting', 'running', 'uncertain') order by created_at limit 1;
  if found then return jsonb_build_object('job', to_jsonb(j)); end if;
  a := public.mavya_allowance(p_user, p_admin);
  if not p_admin and (a->>'used')::bigint >= (a->>'limit')::integer then
    return jsonb_build_object('error', 'quota', 'allowance', a);
  end if;
  if coalesce(r->>'sourceRefId', '') ~ '^[0-9a-f-]{36}$' then
    select data into ref from public.library where id = (r->>'sourceRefId')::uuid
      and (owner = 'curated' or user_id = p_user);
  end if;
  insert into public.generations(user_id, run_id, request_key, state, input, reference, note)
    values(p_user, p_run, p_key, 'reserved', r, ref, left(p_note, 300)) returning * into j;
  return jsonb_build_object('job', to_jsonb(j));
end $$;

-- Lease all work, including polling/finalizing. Starting is never replayed on an expired lease:
-- the provider may have accepted a paid request whose response we did not receive.
create or replace function public.mavya_claim_generation(p_user uuid, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations;
begin
  select * into j from public.generations where id = p_job and user_id = p_user for update;
  if not found or j.state not in ('reserved', 'starting', 'running') then return null; end if;
  if j.lease_until > now() then return null; end if;
  if j.state = 'starting' then
    update public.generations set state = 'uncertain', lease_token = null, lease_until = null,
      error = 'Generation needs recovery. Email hello@mavya.app.', updated_at = now() where id = j.id;
    return null;
  end if;
  update public.generations set state = case when state = 'reserved' then 'starting' else state end,
    lease_token = gen_random_uuid(), lease_until = now() + interval '15 minutes', updated_at = now()
    where id = j.id returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.mavya_generation_transition(p_user uuid, p_job uuid, p_token uuid,
  p_action text, p_value text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations;
begin
  select * into j from public.generations where id = p_job and user_id = p_user for update;
  if not found or j.lease_token is distinct from p_token or j.state not in ('starting', 'running') then return false; end if;
  if p_action = 'started' and j.state = 'starting' then
    if p_value !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid provider task'; end if;
    update public.generations set state = 'running', task_id = case when not fallback_used then p_value else task_id end,
      fallback_task_id = case when fallback_used then p_value else fallback_task_id end where id = j.id;
  elsif p_action = 'fallback' and not j.fallback_used then
    update public.generations set state = 'reserved', fallback_used = true where id = j.id;
  elsif p_action = 'failed' then
    update public.generations set state = 'failed', refunded_at = coalesce(refunded_at, now()),
      error = left(coalesce(p_value, 'The generation failed. Try again.'), 200) where id = j.id;
  elsif p_action = 'uncertain' then
    update public.generations set state = 'uncertain',
      error = 'Generation needs recovery. Email hello@mavya.app.' where id = j.id;
  elsif p_action <> 'release' or j.state <> 'running' then
    raise exception 'Invalid generation transition';
  end if;
  update public.generations set lease_token = null, lease_until = null, updated_at = now() where id = j.id;
  return true;
end $$;

-- The caller computes text retiming from the current run. CAS forces a retry if edits raced it.
-- Job settlement and run attachment commit together. Replaying a completion returns the stored result.
create or replace function public.mavya_complete_generation(p_user uuid, p_job uuid, p_token uuid,
  p_updated text, p_patch jsonb, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations; r public.runs; stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
begin
  select * into j from public.generations where id = p_job and user_id = p_user for update;
  if not found then return null; end if;
  if j.state = 'done' then return j.result; end if;
  if j.state <> 'running' or j.lease_token is distinct from p_token then return null; end if;
  select * into r from public.runs where id = j.run_id and user_id = p_user for update;
  if not found then
    update public.generations set state = 'done', result = p_result, lease_token = null, lease_until = null, updated_at = now() where id = j.id;
    return p_result;
  end if;
  if (r.data->>'updatedAt') is distinct from p_updated then return jsonb_build_object('retry', true); end if;
  update public.runs set data = r.data || jsonb_build_object('hook', p_patch->'hook', 'texts', p_patch->'texts', 'project', null, 'updatedAt', stamp),
    updated_at = now() where id = r.id;
  update public.generations set state = 'done', result = p_result, lease_token = null, lease_until = null, updated_at = now() where id = j.id;
  return p_result;
end $$;

revoke all on function public.mavya_allowance(uuid, boolean) from public, anon, authenticated;
revoke all on function public.mavya_reserve_generation(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.mavya_claim_generation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mavya_generation_transition(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mavya_complete_generation(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mavya_allowance(uuid, boolean), public.mavya_reserve_generation(uuid, uuid, uuid, text, boolean),
  public.mavya_claim_generation(uuid, uuid), public.mavya_generation_transition(uuid, uuid, uuid, text, text),
  public.mavya_complete_generation(uuid, uuid, uuid, text, jsonb, jsonb) to service_role;

commit;
