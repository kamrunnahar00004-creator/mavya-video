begin;
alter table upload_reservations add column if not exists temporary boolean not null default false;
create table if not exists public.export_jobs (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,run_id uuid not null,
 media_id text not null unique,payload jsonb not null,overlay_ids text[] not null default '{}',
 state text not null default 'pending',result jsonb,cleaned boolean not null default false,cleanup_cursor integer not null default 0,progress double precision not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz
);
create unique index if not exists export_jobs_one_active on export_jobs(user_id) where state in ('pending','running');
alter table export_jobs enable row level security;
grant all on export_jobs to service_role;
drop trigger if exists block_closing_account on export_jobs;
create trigger block_closing_account before insert or update on export_jobs for each row execute function mavya_block_closing_account();
create or replace function public.mavya_reserve_export(p_user uuid,p_run uuid,p_expected text,p_id uuid,p_media text,p_payload jsonb,p_overlays text[]) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r runs; begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found or r.data->>'updatedAt' is distinct from p_expected then return false; end if;
 insert into export_jobs(id,user_id,run_id,media_id,payload,overlay_ids) values(p_id,p_user,p_run,p_media,p_payload,p_overlays);
 return true;
end $$;
create or replace function public.mavya_claim_export(p_user uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j export_jobs; begin
 update export_jobs set lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now()
 where id=p_id and user_id=p_user and (state in ('pending','running') or not cleaned) and (lease_until is null or lease_until<now()) returning * into j;
 if not found then return null; end if;return to_jsonb(j);
end $$;
create or replace function public.mavya_deletion_export_keys() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 new.media_ids:=array(select distinct id from (
  select unnest(new.media_ids) id union all select media_id from export_jobs where user_id=new.user_id
  union all select unnest(overlay_ids) from export_jobs where user_id=new.user_id) all_ids);
 return new;
end $$;
drop trigger if exists capture_export_keys on account_deletions;
create trigger capture_export_keys before insert on account_deletions for each row execute function mavya_deletion_export_keys();
-- A completed temporary PNG has six hours for rendering/cleanup, rather than the upload's 15 minutes.
create or replace function public.mavya_finish_upload(p_user uuid,p_media text,p_token uuid,p_name text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r upload_reservations; begin
 select * into r from upload_reservations where media_id=p_media and user_id=p_user for update;
 if not found then return false; end if;
 if r.state='done' then return true; end if;
 if r.lease_token is distinct from p_token or r.lease_until<=now() or r.expires_at<=now() then return false; end if;
 insert into media(id,user_id,mime,size) values(p_media,p_user,r.mime,r.declared_size);
 if p_name is not null then insert into assets(media_id,user_id,name,kind) values(p_media,p_user,left(p_name,200),case when r.mime like 'image/%' then 'image' when r.mime like 'audio/%' then 'audio' else 'video' end);end if;
 update upload_reservations set state='done',lease_token=null,lease_until=null,expires_at=case when temporary then now()+interval '6 hours' else expires_at end where media_id=p_media;
 return true;
end $$;
revoke all on function public.mavya_reserve_export(uuid,uuid,text,uuid,text,jsonb,text[]),public.mavya_claim_export(uuid,uuid),public.mavya_deletion_export_keys(),public.mavya_finish_upload(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.mavya_reserve_export(uuid,uuid,text,uuid,text,jsonb,text[]),public.mavya_claim_export(uuid,uuid),public.mavya_finish_upload(uuid,text,uuid,text) to service_role;
commit;
