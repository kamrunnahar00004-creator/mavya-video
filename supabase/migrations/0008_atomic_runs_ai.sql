begin;
create table if not exists public.ai_daily_usage (
 user_id uuid not null references auth.users(id) on delete cascade,kind text not null,day date not null,n integer not null,
 primary key(user_id,kind,day)
);
create table if not exists public.run_ai_requests (
 user_id uuid not null references auth.users(id) on delete cascade,run_id uuid not null references runs(id) on delete cascade,
 kind text not null,token uuid not null default gen_random_uuid(),expected text,input jsonb,primary key(run_id,kind)
);
alter table public.ai_daily_usage enable row level security;
alter table public.run_ai_requests enable row level security;
grant all on public.ai_daily_usage,public.run_ai_requests to service_role;
drop trigger if exists block_closing_account on public.run_ai_requests;
create trigger block_closing_account before insert or update on public.run_ai_requests for each row execute function public.mavya_block_closing_account();
create or replace function public.mavya_patch_run(p_user uuid,p_run uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; begin
 update runs set data=data||(p_patch-'id'-'createdAt'-'updatedAt'-'exports')||jsonb_build_object('updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),updated_at=now()
 where id=p_run and user_id=p_user returning data into result;
 return result;
end $$;
create or replace function public.mavya_append_export(p_user uuid,p_run uuid,p_media text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r runs; item jsonb; begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null; end if;
 if not exists(select 1 from media where id=p_media and user_id=p_user and mime='video/mp4') then raise exception 'Export media missing'; end if;
 select value into item from jsonb_array_elements(coalesce(r.data->'exports','[]')) where value->>'src'='/api/media/'||p_media;
 if item is not null then return item; end if;
 item:=p_result||jsonb_build_object('src','/api/media/'||p_media);
 update runs set data=data||jsonb_build_object('exports',coalesce(data->'exports','[]')||jsonb_build_array(item),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),updated_at=now() where id=p_run;
 return item;
end $$;
create or replace function public.mavya_begin_ai(p_user uuid,p_run uuid,p_kind text,p_expected text,p_input jsonb,p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare lim integer; count integer; key uuid; current jsonb; begin
 if p_kind not in ('product','script') then raise exception 'Invalid AI operation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,13003));
 if not p_admin and (mavya_allowance(p_user)->>'plan') is null then return jsonb_build_object('error','plan'); end if;
 select data into current from runs where id=p_run and user_id=p_user for update;
 if current is null or current->>'updatedAt' is distinct from p_expected then return jsonb_build_object('error','stale'); end if;
 lim:=case when p_kind='product' then 30 else 60 end;
 insert into ai_daily_usage(user_id,kind,day,n) values(p_user,p_kind,(now() at time zone 'UTC')::date,1)
 on conflict(user_id,kind,day) do update set n=ai_daily_usage.n+1 where ai_daily_usage.n<lim returning n into count;
 if count is null then return jsonb_build_object('error','limit'); end if;
 insert into run_ai_requests(user_id,run_id,kind,expected,input) values(p_user,p_run,p_kind,p_expected,p_input)
 on conflict(run_id,kind) do update set token=gen_random_uuid(),expected=excluded.expected,input=excluded.input returning token into key;
 return jsonb_build_object('token',key);
end $$;
create or replace function public.mavya_finish_ai(p_user uuid,p_run uuid,p_kind text,p_token uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare req run_ai_requests; r runs; result jsonb; begin
 select * into r from runs where id=p_run and user_id=p_user for update;
 if not found then return null; end if;
 select * into req from run_ai_requests where run_id=p_run and user_id=p_user and kind=p_kind and token=p_token for update;
 if not found then return null; end if;
 if r.data->>'updatedAt' is distinct from req.expected then return null; end if;
 result:=mavya_patch_run(p_user,p_run,p_patch);
 delete from run_ai_requests where run_id=p_run and kind=p_kind and token=p_token;
 return result;
end $$;
revoke all on function public.mavya_patch_run(uuid,uuid,jsonb),public.mavya_append_export(uuid,uuid,text,jsonb),public.mavya_begin_ai(uuid,uuid,text,text,jsonb,boolean),public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mavya_patch_run(uuid,uuid,jsonb),public.mavya_append_export(uuid,uuid,text,jsonb),public.mavya_begin_ai(uuid,uuid,text,text,jsonb,boolean),public.mavya_finish_ai(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
