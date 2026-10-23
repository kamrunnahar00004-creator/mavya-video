begin;
create table if not exists public.contact_inquiries (
 id uuid primary key default gen_random_uuid(),ip_hash text not null,
 email text not null check(length(email)<=254),message text not null check(length(message) between 2 and 4000),
 status text not null default 'pending',created_at timestamptz not null default now()
);
create index if not exists contact_rate_window on contact_inquiries(ip_hash,created_at);
alter table contact_inquiries enable row level security;
grant all on contact_inquiries to service_role;
create or replace function public.mavya_contact_inquiry(p_bucket text,p_email text,p_message text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_bucket,13004));
 if (select count(*) from contact_inquiries where ip_hash=p_bucket and created_at>now()-interval '1 hour')>=5 then return null;end if;
 insert into contact_inquiries(ip_hash,email,message) values(p_bucket,p_email,p_message) returning id into result;
 return result;
end $$;
revoke all on function public.mavya_contact_inquiry(text,text,text) from public,anon,authenticated;
grant execute on function public.mavya_contact_inquiry(text,text,text) to service_role;
commit;
