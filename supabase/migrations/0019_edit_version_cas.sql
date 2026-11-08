-- Apply manually BEFORE deploying the code that uses it (founder 2026-11-08: demo captions vanished after a hook change).
-- Every editor save sends the whole caption list, hook and demo, so a page holding an older copy of the video saved
-- its old list over the new one. Now:
--  1. mavya_patch_run takes the version the save was made from (p_base) and, for an editor save (p_check), compares it
--     with the run's editVersion under the row lock: a save from an older copy changes nothing and returns
--     {"stale": true}. An accepted editor save gets a new editVersion. Nobody can set editVersion through p_patch.
--     A save carries its own id (p_save, kept as editSave) and the ids of this page's saves whose answers never came
--     (p_mine): when the video's version came from one of those, the save is this page's own retry, not an older copy.
--  2. mavya_complete_generation gives the run a new editVersion in the same write as the generated hook, so an older
--     copy can never save over a new hook and its re-timed captions (and clears editSave, so no earlier save's retry
--     counts as this page's own).
-- Safe with the code already deployed: the old 3-argument calls resolve to the new function with p_check false and
-- behave exactly as before (0018).
begin;
drop function if exists public.mavya_patch_run(uuid,uuid,jsonb);
drop function if exists public.mavya_patch_run(uuid,uuid,jsonb,text,boolean);
create or replace function public.mavya_patch_run(p_user uuid,p_run uuid,p_patch jsonb,p_base text default null,p_check boolean default false,p_save text default null,p_mine jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r runs; patch jsonb; words jsonb; result jsonb;
begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null; end if;
 if p_check and (r.data->>'editVersion') is not null and p_base is distinct from (r.data->>'editVersion')
    and not (jsonb_typeof(p_mine)='array' and (r.data->>'editSave') is not null and p_mine ? (r.data->>'editSave')) then
  -- byGeneration: the newer version is a finished generation's, made right after the version this save was based on
  -- (editPrev): not another copy, so that page saves its edits again on the generation's version.
  return jsonb_build_object('stale',true,'byGeneration',(r.data->>'editSave') is null and (r.data->>'editPrev') is not null and (r.data->>'editPrev') is not distinct from p_base);
 end if;
 patch := p_patch-'id'-'createdAt'-'updatedAt'-'exports'-'editVersion'-'editSave'-'editPrev'-'editPrevSave';
 if jsonb_typeof(patch->'hook')='object'
    and coalesce(jsonb_typeof(patch->'hook'->'generated'),'null')='null'
    and jsonb_typeof(r.data->'hook'->'generated')='object' then
  words := coalesce(patch->'hook'->'text',r.data->'hook'->'text','""'::jsonb);
  patch := jsonb_set(patch,'{hook}',(r.data->'hook')||jsonb_build_object('text',words));
  if jsonb_typeof(patch->'texts')='array' and jsonb_typeof(r.data->'texts')='array' then
   patch := jsonb_set(patch,'{texts}',coalesce((
    select jsonb_agg(case when item->>'id'='hook' then item||jsonb_build_object('text',words) else item end order by ord)
    from jsonb_array_elements(r.data->'texts') with ordinality as t(item,ord)
   ),'[]'::jsonb));
  end if;
 end if;
 if p_check then patch := patch||jsonb_build_object('editVersion',gen_random_uuid()::text,'editSave',p_save,'editPrev',null,'editPrevSave',null); end if;
 update runs set data=r.data||patch||jsonb_build_object('updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),updated_at=now()
 where id=p_run and user_id=p_user returning data into result;
 return result;
end $$;
revoke all on function public.mavya_patch_run(uuid,uuid,jsonb,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_patch_run(uuid,uuid,jsonb,text,boolean,text,jsonb) to service_role;

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
  update public.runs set data = r.data || jsonb_build_object('hook', p_patch->'hook', 'texts', p_patch->'texts', 'project', null, 'updatedAt', stamp, 'editVersion', gen_random_uuid()::text, 'editSave', null, 'editPrev', r.data->'editVersion', 'editPrevSave', r.data->'editSave'),
    updated_at = now() where id = r.id;
  update public.generations set state = 'done', result = p_result, lease_token = null, lease_until = null, updated_at = now() where id = j.id;
  return p_result;
end $$;
revoke all on function public.mavya_complete_generation(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mavya_complete_generation(uuid, uuid, uuid, text, jsonb, jsonb) to service_role;
commit;
