begin;
create table if not exists public.upload_reservations (
 media_id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 mime text not null,declared_size bigint not null check(declared_size>0 and declared_size<=314572800),
 staging_key text not null unique,expires_at timestamptz not null default now()+interval '15 minutes',
 state text not null default 'pending',lease_token uuid,lease_until timestamptz
);
alter table public.upload_reservations enable row level security;
grant all on public.upload_reservations to service_role;
drop trigger if exists block_closing_account on public.upload_reservations;
create trigger block_closing_account before insert or update on public.upload_reservations for each row execute function public.mavya_block_closing_account();
alter table public.account_deletions add column if not exists extra_keys text[] not null default '{}';
create or replace function public.mavya_claim_upload(p_user uuid,p_media text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r upload_reservations; begin
 select * into r from upload_reservations where media_id=p_media and user_id=p_user for update;
 if not found then return null; end if;
 if r.state='done' then return to_jsonb(r); end if;
 if r.expires_at<=now() or r.lease_until>now() then return null; end if;
 update upload_reservations set lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes'
 where media_id=p_media returning * into r;
 return to_jsonb(r);
end $$;
create or replace function public.mavya_finish_upload(p_user uuid,p_media text,p_token uuid,p_name text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r upload_reservations; begin
 select * into r from upload_reservations where media_id=p_media and user_id=p_user for update;
 if not found then return false; end if;
 if r.state='done' then return true; end if;
 if r.lease_token is distinct from p_token or r.lease_until<=now() or r.expires_at<=now() then return false; end if;
 insert into media(id,user_id,mime,size) values(p_media,p_user,r.mime,r.declared_size);
 if p_name is not null then insert into assets(media_id,user_id,name,kind) values(p_media,p_user,left(p_name,200),
  case when r.mime like 'image/%' then 'image' when r.mime like 'audio/%' then 'audio' else 'video' end); end if;
 update upload_reservations set state='done',lease_token=null,lease_until=null where media_id=p_media;
 return true;
end $$;
-- Include both pending and completed staging keys before auth cascades remove their ownership index.
create or replace function public.mavya_begin_deletion(p_user uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform mavya_billing_assert_lock(p_user,p_token);
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,13002));
 insert into account_deletions(user_id,subscription_ids,checkout,media_ids,extra_keys)
 values(p_user,array(select id from (
   select stripe_subscription_id id,0 priority from subscriptions where user_id=p_user and stripe_subscription_id is not null
   union all select subscription_id,1 from billing_subscription_ids where user_id=p_user) ids group by id order by min(priority)),
   (select to_jsonb(c) from billing_checkouts c where user_id=p_user),
   array(select id from media where user_id=p_user union select media_id from upload_reservations where user_id=p_user),
   array(select staging_key from upload_reservations where user_id=p_user)) on conflict do nothing;
end $$;
revoke all on function public.mavya_claim_upload(uuid,text),public.mavya_finish_upload(uuid,text,uuid,text),public.mavya_begin_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mavya_claim_upload(uuid,text),public.mavya_finish_upload(uuid,text,uuid,text),public.mavya_begin_deletion(uuid,uuid) to service_role;
commit;
