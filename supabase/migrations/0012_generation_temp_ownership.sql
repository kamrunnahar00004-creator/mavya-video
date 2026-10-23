begin;
create table if not exists public.temporary_objects (
 key text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '24 hours'
);
alter table temporary_objects enable row level security;
grant all on temporary_objects to service_role;
drop trigger if exists block_closing_account on temporary_objects;
create trigger block_closing_account before insert or update on temporary_objects for each row execute function mavya_block_closing_account();
create or replace function public.mavya_deletion_export_keys() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 new.media_ids:=array(select distinct id from (
  select unnest(new.media_ids) id union all select media_id from export_jobs where user_id=new.user_id
  union all select unnest(overlay_ids) from export_jobs where user_id=new.user_id
  union all select id::text||'.mp4' from generations where user_id=new.user_id) all_ids);
 new.extra_keys:=array(select distinct key from (
  select unnest(new.extra_keys) key union all select key from temporary_objects where user_id=new.user_id) all_keys);
 return new;
end $$;
revoke all on function public.mavya_deletion_export_keys() from public,anon,authenticated;
commit;
