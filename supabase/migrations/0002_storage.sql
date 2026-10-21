-- 0002: everything a user makes, per account, plus the shared hook library, plan usage and subscriptions.
-- Files live in Cloudflare R2; these tables hold the records. Only the server (service role) reads and writes them:
-- row level security is on with no policies, so the public keys can never touch them directly.

-- A video project; `data` is the whole run as the app uses it.
create table public.runs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index runs_user_created on public.runs (user_id, created_at desc);

-- The hook library: curated hooks (everyone sees them) and hooks a user uploaded or pasted (only they see them).
create table public.library (
  id uuid primary key,
  owner text not null check (owner in ('curated', 'user')),
  user_id uuid references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  check (owner = 'curated' or user_id is not null)
);
create index library_owner on public.library (owner, created_at desc);
create index library_user on public.library (user_id) where user_id is not null;

-- Every file served at /api/media/<id>. user_id null = shared (library covers); otherwise only that user may read it.
create table public.media (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  mime text not null,
  size bigint not null default 0,
  created_at timestamptz not null default now()
);
create index media_user on public.media (user_id) where user_id is not null;

-- Uploads listed in My files.
create table public.assets (
  media_id text primary key references public.media (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('video', 'image', 'audio')),
  created_at timestamptz not null default now()
);
create index assets_user_created on public.assets (user_id, created_at desc);

-- One row per AI hook started: what the plan limits count. Never edited, so deleting a video does not give hooks back.
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid,
  task_id text,
  kind text not null default 'hook',
  created_at timestamptz not null default now()
);
create index generations_user_created on public.generations (user_id, created_at);

-- The plan, written by the Stripe webhook.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text check (plan in ('starter', 'pro', 'studio')),
  status text,
  cycle text check (cycle in ('monthly', 'annual')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  price_id text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  -- The Stripe event time that last wrote this row: an older event arriving late never overwrites a newer state.
  last_event_created bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Stripe webhook events already handled (a duplicate delivery is acknowledged without reprocessing).
create table public.billing_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.runs enable row level security;
alter table public.library enable row level security;
alter table public.media enable row level security;
alter table public.assets enable row level security;
alter table public.generations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
grant all on public.runs, public.library, public.media, public.assets, public.generations, public.subscriptions, public.billing_events to service_role;
