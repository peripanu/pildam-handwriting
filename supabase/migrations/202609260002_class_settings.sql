create table if not exists public.pildam_class_settings (
  id integer primary key check (id = 1),
  student_code text,
  accuracy_weight integer not null default 75 check (accuracy_weight between 50 and 90),
  updated_at timestamptz not null default now(),
  check (student_code is null or char_length(student_code) between 4 and 32)
);
insert into public.pildam_class_settings (id) values (1) on conflict (id) do nothing;
alter table public.pildam_class_settings enable row level security;
revoke all on public.pildam_class_settings from anon, authenticated;
grant all on public.pildam_class_settings to service_role;
