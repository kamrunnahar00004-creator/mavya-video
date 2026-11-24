-- Trial reels (founder 2026-11-25): a scheduled post can go to Instagram as a trial reel, shown to non-followers
-- first (Graph API trial_params). Facebook posts normally. Apply by hand in the Supabase SQL editor.
alter table public.scheduled_posts add column if not exists ig_trial boolean not null default false;
