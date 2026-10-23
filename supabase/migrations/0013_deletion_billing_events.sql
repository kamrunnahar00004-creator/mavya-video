begin;
alter table account_deletions add column if not exists known_subscription_ids text[] not null default '{}',add column if not exists stripe_customer_id text;
create or replace function public.mavya_deletion_billing_ids() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 new.known_subscription_ids:=new.subscription_ids;
 select stripe_customer_id into new.stripe_customer_id from subscriptions where user_id=new.user_id;
 return new;
end $$;
drop trigger if exists capture_billing_ids on account_deletions;
create trigger capture_billing_ids before insert on account_deletions for each row execute function mavya_deletion_billing_ids();
-- Auth/billing bindings may already be gone. Keep late Stripe lifecycle processing on the deletion tombstone.
create or replace function public.mavya_deletion_event(p_user uuid,p_event text,p_type text,p_subscription text,p_live boolean) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare d account_deletions; begin
 select * into d from account_deletions where user_id=p_user for update;
 if not found then raise exception 'Deletion request missing';end if;
 if d.lease_until>now() then raise exception 'Deletion is advancing';end if;
 insert into billing_events(id,type) values(p_event,p_type) on conflict do nothing;
 if not found then return 'duplicate';end if;
 if p_live then
  update account_deletions set subscription_ids=array(select distinct unnest(subscription_ids||array[p_subscription])),known_subscription_ids=array(select distinct unnest(known_subscription_ids||array[p_subscription])),
   state='cancel',error=null,updated_at=now() where user_id=p_user;
  return 'cancel';
 end if;
 return 'closed';
end $$;
revoke all on function public.mavya_deletion_event(uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.mavya_deletion_billing_ids() from public,anon,authenticated;
grant execute on function public.mavya_deletion_event(uuid,text,text,text,boolean) to service_role;
commit;
