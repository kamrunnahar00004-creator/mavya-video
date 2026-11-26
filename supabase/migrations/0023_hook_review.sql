-- Hook review (founder 2026-11-26): every library hook made with a built-in character from now on is scored by a
-- background eval (src/lib/server/hook-eval.ts), and its maker can rate it thumbs up or down. Clips that pass and
-- get a thumbs up are shortlisted for the founder; the ones he confirms go in src/lib/hook-cache.ts.
begin;
alter table public.generations
  add column if not exists eval jsonb,
  add column if not exists rating smallint check (rating in (-1, 1)),
  add column if not exists rated_at timestamptz;
create index if not exists generations_eval_due on public.generations(created_at) where state = 'done' and eval is null;
commit;
