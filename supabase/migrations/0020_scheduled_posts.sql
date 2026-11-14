-- Scheduled posts (founder 2026-11-15): exported videos queued on a calendar, posted to Instagram Reels and the
-- Facebook Page at their time by the per-minute recovery cron (src/lib/server/scheduled-posts.ts). Owner-only for now
-- (SCHEDULED_POSTS_USERS); the server reads and writes these tables with the service role only.
begin;
create table if not exists public.scheduled_posts (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 media_id text not null,
 title text not null default '',
 hook text not null default '',
 captions jsonb not null default '{}',
 targets text[] not null,
 at timestamptz not null,
 state text not null default 'scheduled' check (state in ('scheduled','posting','posted','failed')),
 result jsonb not null default '{}',
 attempts integer not null default 0,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz
);
create index if not exists scheduled_posts_due on scheduled_posts(state, at);
create index if not exists scheduled_posts_user_at on scheduled_posts(user_id, at);
alter table scheduled_posts enable row level security;
grant all on scheduled_posts to service_role;
drop trigger if exists block_closing_account on scheduled_posts;
create trigger block_closing_account before insert or update on scheduled_posts for each row execute function mavya_block_closing_account();

-- The caption templates ({hook} is filled from the video's hook words).
create table if not exists public.scheduled_post_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 templates jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
alter table scheduled_post_settings enable row level security;
grant all on scheduled_post_settings to service_role;
commit;
