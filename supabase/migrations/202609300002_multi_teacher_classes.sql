create table if not exists public.pildam_teachers (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_salt text not null,
  password_hash text not null,
  password_iterations integer not null default 210000,
  created_at timestamptz not null default now(),
  check (username ~ '^[a-z0-9._-]{4,32}$'),
  check (password_salt ~ '^[0-9a-f]{32}$'),
  check (password_hash ~ '^[0-9a-f]{64}$'),
  check (password_iterations between 100000 and 1000000)
);

create unique index if not exists pildam_teachers_username_lower_idx
  on public.pildam_teachers (lower(username));

create table if not exists public.pildam_classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null unique references public.pildam_teachers(id) on delete cascade,
  student_code text unique,
  title text not null default '오늘의 연습 글',
  content text not null default '오늘은 맑은 하늘 아래에서 친구와 함께 책을 읽었습니다.',
  accuracy_weight integer not null default 75,
  updated_at timestamptz not null default now(),
  check (student_code is null or char_length(student_code) between 4 and 32),
  check (char_length(title) between 1 and 80),
  check (char_length(content) between 1 and 1000),
  check (accuracy_weight between 50 and 90)
);

insert into public.pildam_teachers (id, username, password_salt, password_hash)
values (
  '00000000-0000-0000-0000-000000000001',
  'legacy-admin',
  repeat('0',32),
  repeat('0',64)
)
on conflict (id) do nothing;

insert into public.pildam_classes (id, teacher_id, student_code, title, content, accuracy_weight, updated_at)
select
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  s.student_code,
  coalesce(a.title, '오늘의 연습 글'),
  coalesce(a.content, '오늘은 맑은 하늘 아래에서 친구와 함께 책을 읽었습니다.'),
  s.accuracy_weight,
  greatest(s.updated_at, coalesce(a.updated_at, s.updated_at))
from public.pildam_class_settings s
left join public.pildam_assignment a on a.id=1
where s.id=1
on conflict (id) do nothing;

alter table public.pildam_teachers enable row level security;
alter table public.pildam_classes enable row level security;
revoke all on public.pildam_teachers, public.pildam_classes from public, anon, authenticated;
grant all on public.pildam_teachers, public.pildam_classes to service_role;
