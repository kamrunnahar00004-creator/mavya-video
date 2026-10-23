begin;
-- A renderer may begin its bounded 60-second PUT just before a six-hour signed grant expires.
alter table account_deletions alter column cleanup_after set default now()+interval '6 hours 2 minutes';
update account_deletions set cleanup_after=greatest(cleanup_after,created_at+interval '6 hours 2 minutes') where state<>'done';
commit;
