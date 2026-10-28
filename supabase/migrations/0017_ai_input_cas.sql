begin;
-- Product reading and the demo plan run in the background while the seller keeps picking a hook and a character.
-- A finished AI result is kept when ITS inputs are unchanged, not when the whole run is untouched:
--   product: the run's product is still what it was when reading started (no newer link).
--   script:  same product brief, same chosen hook (library row unchanged, as 0011), or the same described hook.
-- A newer request of the same kind still replaces the token, so only the latest result lands.
create or replace function public.mavya_finish_ai(p_user uuid,p_run uuid,p_kind text,p_token uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare req run_ai_requests; r runs; source library; result jsonb; trimmed text; begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null;end if;
 select * into req from run_ai_requests where run_id=p_run and user_id=p_user and kind=p_kind and token=p_token for update;
 if not found then return null;end if;
 if p_kind='product' then
  if not (req.input ? 'previous') then
   -- Requests started before this migration keep the old whole-run check.
   if r.data->>'updatedAt' is distinct from req.expected then return null;end if;
  elsif coalesce(r.data->'product','null'::jsonb) is distinct from coalesce(req.input->'previous','null'::jsonb) then return null;end if;
 elsif p_kind='script' then
  if coalesce(r.data->'product','null'::jsonb) is distinct from coalesce(req.input->'product','null'::jsonb) then return null;end if;
  if jsonb_typeof(req.input->'source')='object' then
   if r.data->>'sourceRefId' is distinct from req.input->'source'->>'id' then return null;end if;
   select * into source from library where id=(req.input->'source'->>'id')::uuid and (owner='curated' or user_id=p_user) for share;
   if not found or (source.data||jsonb_build_object('id',source.id::text,'owner',source.owner)) is distinct from req.input->'source' then return null;end if;
  else
   trimmed:=regexp_replace(coalesce(r.data->'hook'->>'describe',''),'^\s+|\s+$','','g');
   if r.data->>'sourceRefId' is not null or r.data->'hook'->>'source' is distinct from 'describe' or trimmed is distinct from coalesce(req.input->>'described','') then return null;end if;
  end if;
 else
  return null;
 end if;
 result:=mavya_patch_run(p_user,p_run,p_patch);
 delete from run_ai_requests where run_id=p_run and kind=p_kind and token=p_token;
 return result;
end $$;
revoke all on function public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
