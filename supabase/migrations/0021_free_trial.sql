-- Free trial (founder 2026-11-21): 3 days, card required in Stripe Checkout, 3 AI hooks while trialing.
-- Run in Supabase before (or with) the deploy. Until it runs, the app offers no trial: checkout asks
-- mavya_trial_eligible, which does not exist yet, and falls back to a normal paid checkout.
begin;

create or replace function public.mavya_allowance(p_user uuid, p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subscriptions; t timestamptz := now(); a timestamptz; b timestamptz;
  n integer; lim integer := 0; used bigint; paid boolean := false;
begin
  select * into s from public.subscriptions where user_id = p_user;
  paid := coalesce(s.plan is not null and s.status in ('active', 'trialing')
    and s.current_period_start <= t and s.current_period_end > t, false);
  a := date_trunc('month', t at time zone 'UTC') at time zone 'UTC';
  b := a + interval '1 month';
  if paid then
    a := s.current_period_start; b := s.current_period_end;
    if s.cycle = 'annual' then
      n := (extract(year from t at time zone 'UTC')::int - extract(year from a at time zone 'UTC')::int) * 12
        + extract(month from t at time zone 'UTC')::int - extract(month from a at time zone 'UTC')::int;
      a := ((s.current_period_start at time zone 'UTC') + make_interval(months => n)) at time zone 'UTC';
      if a > t then
        n := n - 1;
        a := ((s.current_period_start at time zone 'UTC') + make_interval(months => n)) at time zone 'UTC';
      end if;
      b := least(s.current_period_end, ((s.current_period_start at time zone 'UTC') + make_interval(months => n + 1)) at time zone 'UTC');
    end if;
    -- A free trial gets TRIAL.hooks (src/lib/plans.ts), whatever the plan; the plan's own quota starts when it is paid.
    lim := case when s.status = 'trialing' then 3 else case s.plan when 'starter' then 20 when 'pro' then 60 when 'studio' then 150 else 0 end end;
  end if;
  select count(*) into used from public.generations
    where user_id = p_user and created_at >= a and created_at < b and refunded_at is null;
  return jsonb_build_object('plan', case when paid then s.plan else null end, 'admin', p_admin,
    'trial', paid and s.status = 'trialing',
    'used', used, 'limit', case when p_admin then null else lim end, 'resetsAt', b, 'since', a);
end $$;

-- One trial per account: only someone who never had a Stripe subscription (any status, even canceled).
create or replace function public.mavya_trial_eligible(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from public.billing_subscription_ids where user_id = p_user)
     and not exists (select 1 from public.subscriptions where user_id = p_user and stripe_subscription_id is not null);
$$;

revoke all on function public.mavya_allowance(uuid, boolean) from public, anon, authenticated;
revoke all on function public.mavya_trial_eligible(uuid) from public, anon, authenticated;
grant execute on function public.mavya_allowance(uuid, boolean), public.mavya_trial_eligible(uuid) to service_role;

commit;
