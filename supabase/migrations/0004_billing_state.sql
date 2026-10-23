-- H3/H4/H6: serialize reconciliation across instances; claim/apply events atomically.
begin;
alter table public.subscriptions add column if not exists billing_revision bigint not null default 0;
create table if not exists public.billing_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid, expires_at timestamptz
);
create table if not exists public.billing_checkouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_key uuid not null default gen_random_uuid(),
  params jsonb not null, session_id text unique, status text,
  created_at timestamptz not null default now()
);
create table if not exists public.billing_subscription_ids (
  subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  retired boolean not null default false
);
create table if not exists public.billing_conflicts (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_subscription_id text, incoming_subscription_id text not null,
  created_at timestamptz not null default now()
);
insert into public.billing_subscription_ids(subscription_id,user_id)
  select stripe_subscription_id,user_id from public.subscriptions where stripe_subscription_id is not null
  on conflict do nothing;
alter table public.billing_locks enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.billing_subscription_ids enable row level security;
alter table public.billing_conflicts enable row level security;
grant all on public.billing_locks, public.billing_checkouts, public.billing_subscription_ids, public.billing_conflicts to service_role;

create or replace function public.mavya_billing_lock(p_user uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  insert into billing_locks(user_id) values(p_user) on conflict do nothing;
  update billing_locks set token=gen_random_uuid(),expires_at=now()+interval '3 minutes'
    where user_id=p_user and (expires_at is null or expires_at<=now()) returning token into result;
  return result;
end $$;
create or replace function public.mavya_billing_unlock(p_user uuid,p_token uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update billing_locks set token=null,expires_at=null where user_id=p_user and token=p_token;
$$;

-- Every mutating RPC holds this row lock until its transaction commits.
create or replace function public.mavya_billing_assert_lock(p_user uuid,p_token uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from billing_locks where user_id=p_user and token=p_token and expires_at>now() for update;
  if not found then raise exception 'Billing lease expired'; end if;
end $$;

create or replace function public.mavya_checkout_prepare(p_user uuid,p_token uuid,p_params jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c billing_checkouts;
begin
  perform mavya_billing_assert_lock(p_user,p_token);
  if exists(select 1 from subscriptions where user_id=p_user and stripe_subscription_id is not null
      and coalesce(status,'') not in ('canceled','incomplete_expired')) then raise exception 'Existing subscription'; end if;
  insert into billing_checkouts(user_id,params) values(p_user,p_params) on conflict do nothing;
  select * into c from billing_checkouts where user_id=p_user;
  return to_jsonb(c);
end $$;
create or replace function public.mavya_checkout_record(p_user uuid,p_token uuid,p_key uuid,p_session text,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform mavya_billing_assert_lock(p_user,p_token);
  update billing_checkouts set session_id=p_session,status=p_status where user_id=p_user and request_key=p_key
    and (session_id is null or session_id=p_session);
  if not found then raise exception 'Checkout identity changed'; end if;
end $$;
create or replace function public.mavya_checkout_clear(p_user uuid,p_token uuid,p_key uuid,p_subscription text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform mavya_billing_assert_lock(p_user,p_token);
  -- Server has positively confirmed expiry, or the completed subscription's terminal state.
  delete from billing_checkouts where user_id=p_user and request_key=p_key and (status='expired' or
    (status='complete' and exists(select 1 from subscriptions where user_id=p_user
      and stripe_subscription_id=p_subscription and status in ('canceled','incomplete_expired'))));
  if not found then raise exception 'Checkout not expired'; end if;
end $$;

-- Reconciled subscription state was fetched AFTER acquiring the lease. Equal-second events
-- therefore use serialized current Stripe state, never competing event payload snapshots.
create or replace function public.mavya_billing_event(p_user uuid,p_token uuid,p_event text,p_type text,
  p_created bigint,p_state jsonb,p_checkout text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare current subscriptions; incoming text:=p_state->>'stripe_subscription_id'; owner_id uuid;
  retired_id boolean; changed boolean; matches_checkout boolean; incoming_live boolean;
begin
  perform mavya_billing_assert_lock(p_user,p_token);
  insert into billing_events(id,type) values(p_event,p_type) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  if incoming is null or incoming='' or p_state->>'user_id' is distinct from p_user::text then raise exception 'Invalid billing state'; end if;
  select * into current from subscriptions where user_id=p_user for update;
  select user_id,retired into owner_id,retired_id from billing_subscription_ids where subscription_id=incoming;
  if owner_id is not null and owner_id<>p_user then raise exception 'Subscription owner mismatch'; end if;
  incoming_live:=coalesce(p_state->>'status','') not in ('canceled','incomplete_expired');
  matches_checkout:=p_checkout is not null and exists(select 1 from billing_checkouts where user_id=p_user and session_id=p_checkout);
  changed:=current.stripe_subscription_id is not null and current.stripe_subscription_id<>incoming;
  if changed and (coalesce(retired_id,false) or coalesce(current.status,'') not in ('canceled','incomplete_expired') or not matches_checkout) then
    insert into billing_subscription_ids(subscription_id,user_id,retired) values(incoming,p_user,false)
      on conflict do nothing;
    if incoming_live then
      insert into billing_conflicts(event_id,user_id,current_subscription_id,incoming_subscription_id)
        values(p_event,p_user,current.stripe_subscription_id,incoming) on conflict do nothing;
      return 'conflict';
    end if;
    return 'unrelated';
  end if;
  if current.last_event_created>p_created then return 'older'; end if;
  if changed then update billing_subscription_ids set retired=true where subscription_id=current.stripe_subscription_id; end if;
  insert into billing_subscription_ids(subscription_id,user_id) values(incoming,p_user) on conflict do nothing;
  insert into subscriptions(user_id,plan,cycle,status,price_id,current_period_start,current_period_end,
    cancel_at_period_end,stripe_customer_id,stripe_subscription_id,last_event_created,billing_revision,updated_at)
  values(p_user,p_state->>'plan',p_state->>'cycle',p_state->>'status',p_state->>'price_id',
    (p_state->>'current_period_start')::timestamptz,(p_state->>'current_period_end')::timestamptz,
    coalesce((p_state->>'cancel_at_period_end')::boolean,false),p_state->>'stripe_customer_id',incoming,
    p_created,1,now())
  on conflict(user_id) do update set plan=excluded.plan,cycle=excluded.cycle,status=excluded.status,price_id=excluded.price_id,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,stripe_customer_id=excluded.stripe_customer_id,
    stripe_subscription_id=excluded.stripe_subscription_id,last_event_created=excluded.last_event_created,
    billing_revision=subscriptions.billing_revision+1,updated_at=now();
  if matches_checkout then update billing_checkouts set status='complete' where user_id=p_user; end if;
  return 'applied';
end $$;

-- Billing actions cannot lower event time or replay over a changed subscription/revision.
create or replace function public.mavya_billing_action(p_user uuid,p_token uuid,p_subscription text,
  p_revision bigint,p_watermark bigint,p_state jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform mavya_billing_assert_lock(p_user,p_token);
  if p_state->>'stripe_subscription_id' is distinct from p_subscription or p_state->>'user_id' is distinct from p_user::text then raise exception 'Invalid billing identity'; end if;
  update subscriptions set plan=p_state->>'plan',cycle=p_state->>'cycle',status=p_state->>'status',price_id=p_state->>'price_id',
    current_period_start=(p_state->>'current_period_start')::timestamptz,current_period_end=(p_state->>'current_period_end')::timestamptz,
    cancel_at_period_end=coalesce((p_state->>'cancel_at_period_end')::boolean,false),
    billing_revision=billing_revision+1,updated_at=now()
    where user_id=p_user and stripe_subscription_id=p_subscription and billing_revision=p_revision and last_event_created=p_watermark;
  return found;
end $$;

revoke all on function public.mavya_billing_lock(uuid),public.mavya_billing_unlock(uuid,uuid),
  public.mavya_billing_assert_lock(uuid,uuid),public.mavya_checkout_prepare(uuid,uuid,jsonb),
  public.mavya_checkout_record(uuid,uuid,uuid,text,text),public.mavya_checkout_clear(uuid,uuid,uuid,text),
  public.mavya_billing_event(uuid,uuid,text,text,bigint,jsonb,text),
  public.mavya_billing_action(uuid,uuid,text,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_billing_lock(uuid),public.mavya_billing_unlock(uuid,uuid),
  public.mavya_billing_assert_lock(uuid,uuid),public.mavya_checkout_prepare(uuid,uuid,jsonb),
  public.mavya_checkout_record(uuid,uuid,uuid,text,text),public.mavya_checkout_clear(uuid,uuid,uuid,text),
  public.mavya_billing_event(uuid,uuid,text,text,bigint,jsonb,text),
  public.mavya_billing_action(uuid,uuid,text,bigint,bigint,jsonb) to service_role;
commit;
