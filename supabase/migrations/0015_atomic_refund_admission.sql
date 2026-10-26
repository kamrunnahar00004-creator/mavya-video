-- Apply after review. No change to quotas, accepted work, fallback or refunds.
begin;
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
  -- Same rolling 24-hour policy, serialized with refund transitions and admission.
  -- Accepted in-flight jobs may still finish and refund; they are never revoked.
  if not p_admin and (select count(*) from public.generations
    where user_id = p_user and refunded_at >= now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'attempts');
  end if;
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
create or replace function public.mavya_generation_transition(p_user uuid, p_job uuid, p_token uuid,
  p_action text, p_value text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 13001));
  select * into j from public.generations where id = p_job and user_id = p_user for update;
  if not found or j.lease_token is distinct from p_token or j.state not in ('starting', 'running') then return false; end if;
  if p_action = 'started' and j.state = 'starting' then
    if p_value is null or not (
      p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or p_value ~ '^[A-Za-z0-9_./-]{1,200}\|[A-Za-z0-9_-]{1,128}$'
    ) then raise exception 'Invalid provider task'; end if;
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
revoke all on function public.mavya_reserve_generation(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.mavya_generation_transition(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mavya_reserve_generation(uuid,uuid,uuid,text,boolean), public.mavya_generation_transition(uuid,uuid,uuid,text,text) to service_role;
commit;
