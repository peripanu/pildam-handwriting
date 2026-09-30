alter table public.pildam_budget
  add column if not exists period_start date;

update public.pildam_budget
set period_start = date_trunc('month', timezone('Asia/Seoul', now()))::date
where period_start is null;

alter table public.pildam_budget
  alter column period_start set default date_trunc('month', timezone('Asia/Seoul', now()))::date,
  alter column period_start set not null;

create or replace function public.pildam_claim(p_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare
  n integer;
  budget_period date;
  current_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  job public.pildam_jobs%rowtype;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid hash'; end if;

  select used, period_start
    into n, budget_period
  from public.pildam_budget
  where id=1
  for update;
  if not found then raise exception 'missing budget'; end if;

  if budget_period <> current_period then
    update public.pildam_budget
      set used=0, period_start=current_period
    where id=1;
    n := 0;
  end if;

  delete from public.pildam_jobs where hash=p_hash and expires<now();
  select * into job from public.pildam_jobs where hash=p_hash;
  if found then
    if job.state='done' and job.quality is null then
      if n>=10000 then return jsonb_build_object('state','limit'); end if;
      delete from public.pildam_jobs where hash=p_hash;
      update public.pildam_budget set used=used+1 where id=1;
      insert into public.pildam_jobs(hash,state,content,expires,quality)
        values(p_hash,'pending',null,now()+interval '1 hour',null);
      return jsonb_build_object('state','claimed');
    end if;
    return jsonb_build_object('state',job.state,'text',job.content,'quality',job.quality);
  end if;

  if n>=10000 then return jsonb_build_object('state','limit'); end if;
  update public.pildam_budget set used=used+1 where id=1;
  insert into public.pildam_jobs(hash,state,content,expires,quality)
    values(p_hash,'pending',null,now()+interval '1 hour',null);
  return jsonb_build_object('state','claimed');
end $$;
