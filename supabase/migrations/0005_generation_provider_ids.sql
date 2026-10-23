-- C1/H8: Kling/fal task identities are model|request-id, not bare Runway UUIDs.
-- Keep the existing leased state machine. Never alter applied migration 0003.
begin;
create or replace function public.mavya_generation_transition(p_user uuid, p_job uuid, p_token uuid,
  p_action text, p_value text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.generations;
begin
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
revoke all on function public.mavya_generation_transition(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mavya_generation_transition(uuid,uuid,uuid,text,text) to service_role;
commit;
