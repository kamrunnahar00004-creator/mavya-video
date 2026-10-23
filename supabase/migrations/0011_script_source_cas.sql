begin;
-- A curated/reference edit can change the script's input without changing the run's timestamp.
create or replace function public.mavya_finish_ai(p_user uuid,p_run uuid,p_kind text,p_token uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare req run_ai_requests; r runs; source library; result jsonb; begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null;end if;
 select * into req from run_ai_requests where run_id=p_run and user_id=p_user and kind=p_kind and token=p_token for update;
 if not found or r.data->>'updatedAt' is distinct from req.expected then return null;end if;
 if p_kind='script' and jsonb_typeof(req.input->'source')='object' then
  select * into source from library where id=(req.input->'source'->>'id')::uuid and (owner='curated' or user_id=p_user) for share;
  if not found or (source.data||jsonb_build_object('id',source.id::text,'owner',source.owner)) is distinct from req.input->'source' then return null;end if;
 end if;
 result:=mavya_patch_run(p_user,p_run,p_patch);
 delete from run_ai_requests where run_id=p_run and kind=p_kind and token=p_token;
 return result;
end $$;
revoke all on function public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
