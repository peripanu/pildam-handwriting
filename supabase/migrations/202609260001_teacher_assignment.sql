-- One teacher-selected passage is served only through the Edge Function.
create table if not exists public.pildam_assignment (
  id integer primary key check (id = 1),
  title text not null default '오늘의 연습 글',
  content text not null,
  updated_at timestamptz not null default now(),
  check (char_length(title) between 1 and 80),
  check (char_length(content) between 1 and 1000)
);
insert into public.pildam_assignment (id, title, content)
values (1, '맑은 날', '오늘은 맑은 하늘 아래에서 친구와 함께 책을 읽었습니다.')
on conflict (id) do nothing;
alter table public.pildam_assignment enable row level security;
revoke all on public.pildam_assignment from anon, authenticated;
grant all on public.pildam_assignment to service_role;
