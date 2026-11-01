-- Apply manually before deploying this branch. Prevent a stale browser hook section from erasing a paid result.
-- The HTTP route's read/merge occurs before the database row lock and cannot close this race on its own.
begin;
create or replace function public.mavya_patch_run(p_user uuid,p_run uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r runs; patch jsonb; words jsonb; result jsonb;
begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null; end if;
 patch := p_patch-'id'-'createdAt'-'updatedAt'-'exports';
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
 update runs set data=r.data||patch||jsonb_build_object('updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),updated_at=now()
 where id=p_run and user_id=p_user returning data into result;
 return result;
end $$;
revoke all on function public.mavya_patch_run(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_patch_run(uuid,uuid,jsonb) to service_role;
commit;
