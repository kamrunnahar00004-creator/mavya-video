begin;
-- Deliberately survives auth deletion so interrupted requests remain resumable.
create table if not exists public.account_deletions (
 user_id uuid primary key, state text not null default 'cancel',
 subscription_ids text[] not null default '{}', checkout jsonb,
 media_ids text[] not null default '{}', cursor integer not null default 0,
 created_at timestamptz not null default now(), cleanup_after timestamptz not null default now()+interval '6 hours',
 lease_token uuid, lease_until timestamptz, error text, updated_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
grant all on public.account_deletions to service_role;
create or replace function public.mavya_block_closing_account() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.user_id is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,13002));
 if exists(select 1 from account_deletions where user_id=new.user_id) then raise exception 'Account deletion in progress'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['media','runs','generations','assets','library','subscriptions','billing_checkouts'] loop
  execute format('drop trigger if exists block_closing_account on public.%I',t);
  execute format('create trigger block_closing_account before insert or update on public.%I for each row execute function public.mavya_block_closing_account()',t);
 end loop;
end $$;
create or replace function public.mavya_begin_deletion(p_user uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform mavya_billing_assert_lock(p_user,p_token);
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,13002));
 insert into account_deletions(user_id,subscription_ids,checkout,media_ids)
 values(p_user,array(select subscription_id from billing_subscription_ids where user_id=p_user
   union select stripe_subscription_id from subscriptions where user_id=p_user and stripe_subscription_id is not null),
   (select to_jsonb(c) from billing_checkouts c where user_id=p_user),
   array(select id from media where user_id=p_user)) on conflict do nothing;
end $$;
create or replace function public.mavya_billing_lock(p_user uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,13002));
 if exists(select 1 from account_deletions where user_id=p_user) then return null; end if;
 insert into billing_locks(user_id) values(p_user) on conflict do nothing;
 update billing_locks set token=gen_random_uuid(),expires_at=now()+interval '3 minutes'
 where user_id=p_user and (expires_at is null or expires_at<=now()) returning token into result;
 return result;
end $$;
create or replace function public.mavya_claim_deletion(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d account_deletions; begin
 update account_deletions set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 where user_id=p_user and state<>'done' and (lease_until is null or lease_until<now()) returning * into d;
 if not found then return null; end if; return to_jsonb(d);
end $$;
revoke all on function public.mavya_block_closing_account(),public.mavya_begin_deletion(uuid,uuid),public.mavya_claim_deletion(uuid),public.mavya_billing_lock(uuid) from public,anon,authenticated;
grant execute on function public.mavya_begin_deletion(uuid,uuid),public.mavya_claim_deletion(uuid),public.mavya_billing_lock(uuid) to service_role;
commit;
