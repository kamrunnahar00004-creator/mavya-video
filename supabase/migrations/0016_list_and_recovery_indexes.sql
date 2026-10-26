-- New migration only. Review and apply separately; no old migration is edited.
begin;
create index if not exists generations_user_refunded on public.generations(user_id,refunded_at) where refunded_at is not null;
create index if not exists upload_reservations_expiry on public.upload_reservations(expires_at,lease_until);
create index if not exists temporary_objects_expiry on public.temporary_objects(expires_at);
create index if not exists export_jobs_recovery on public.export_jobs(updated_at,lease_until) where state in ('pending','running') or not cleaned;
create index if not exists account_deletions_recovery on public.account_deletions(updated_at,lease_until) where state <> 'done';
create index if not exists runs_owner_page on public.runs(user_id,created_at desc,id desc);
create index if not exists assets_owner_page on public.assets(user_id,created_at desc,media_id desc);
create index if not exists library_owner_page on public.library(user_id,created_at desc,id desc);
create index if not exists library_curated_page on public.library(created_at desc,id desc) where owner='curated';
commit;
