-- 0001: accounts. One profile per signed-in person (names and picture), filled from Google at sign-up.
-- Run once in Supabase > SQL Editor (after the wipe, the public schema is empty).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 60),
  last_name text not null default '' check (char_length(last_name) <= 60),
  avatar_url text not null default '' check (char_length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each person reads and edits only their own profile; names and picture only.
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select on public.profiles to authenticated;
grant update (first_name, last_name, avatar_url, updated_at) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- New account (Google sign-up) -> profile with Google's first name, last name and photo.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, first_name, last_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'given_name', split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1)), 60),
    left(coalesce(new.raw_user_meta_data ->> 'family_name', ''), 60),
    left(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''), 500)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
