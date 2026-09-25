-- Only the server service role can read/write these tables or call the RPCs.
create table if not exists public.pildam_budget (
  id integer primary key check (id = 1),
  used integer not null default 0 check (used >= 0)
);
insert into public.pildam_budget values (1,0) on conflict do nothing;
create table if not exists public.pildam_attempts (
  bucket text primary key, count integer not null, expires timestamptz not null
);
create index if not exists pildam_attempts_expiry on public.pildam_attempts(expires);
create table if not exists public.pildam_jobs (
  hash text primary key, state text not null check (state in ('pending','done','failed')),
  content text, expires timestamptz not null
);
create index if not exists pildam_jobs_expiry on public.pildam_jobs(expires);
alter table public.pildam_budget enable row level security;
alter table public.pildam_attempts enable row level security;
alter table public.pildam_jobs enable row level security;
revoke all on public.pildam_budget, public.pildam_attempts, public.pildam_jobs from anon, authenticated;
grant all on public.pildam_budget, public.pildam_attempts, public.pildam_jobs to service_role;

create or replace function public.pildam_throttle(p_bucket text, p_max integer, p_expiry timestamptz)
returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
  if length(p_bucket)>200 or p_max<1 then raise exception 'invalid request'; end if;
  insert into public.pildam_attempts as a values(p_bucket,1,p_expiry)
    on conflict(bucket) do update set count=a.count+1 returning count into n;
  return n<=p_max;
end $$;

create or replace function public.pildam_claim(p_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare n integer; job public.pildam_jobs%rowtype;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid hash'; end if;
  -- One database transaction serializes budget increments and duplicate claims.
  select used into n from public.pildam_budget where id=1 for update;
  if not found then raise exception 'missing budget'; end if;
  delete from public.pildam_jobs where hash=p_hash and expires<now();
  select * into job from public.pildam_jobs where hash=p_hash;
  if found then return jsonb_build_object('state',job.state,'text',job.content); end if;
  if n>=900 then return jsonb_build_object('state','limit'); end if;
  update public.pildam_budget set used=used+1 where id=1;
  insert into public.pildam_jobs values(p_hash,'pending',null,now()+interval '1 hour');
  return jsonb_build_object('state','claimed');
end $$;

create or replace function public.pildam_finish(p_hash text, p_text text, p_success boolean)
returns void language plpgsql set search_path='' as $$
begin
  update public.pildam_jobs set state=case when p_success then 'done' else 'failed' end,
    content=case when p_success then left(p_text,50000) else null end where hash=p_hash;
end $$;

create or replace function public.pildam_cleanup()
returns void language sql set search_path='' as $$
  delete from public.pildam_jobs where expires<now();
  delete from public.pildam_attempts where expires<now();
$$;
revoke all on function public.pildam_throttle(text,integer,timestamptz), public.pildam_claim(text), public.pildam_finish(text,text,boolean), public.pildam_cleanup() from public, anon, authenticated;
grant execute on function public.pildam_throttle(text,integer,timestamptz), public.pildam_claim(text), public.pildam_finish(text,text,boolean), public.pildam_cleanup() to service_role;
