-- Calendario de pagos. Ejecutar en Supabase > SQL Editor (se puede correr más de una vez).

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  due_date    date not null,                       -- vencimiento (o primero de la serie si se repite)
  recurrence  text not null default 'none' check (recurrence in ('none', 'monthly')),
  amount      numeric(14,2),                       -- opcional
  notes       text,
  paid_dates  date[] not null default '{}',        -- vencimientos ya pagados (fechas de cada ocurrencia)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists payments_user_due_idx on public.payments (user_id, due_date);

alter table public.payments enable row level security;

drop policy if exists "own payments: select" on public.payments;
drop policy if exists "own payments: insert" on public.payments;
drop policy if exists "own payments: update" on public.payments;
drop policy if exists "own payments: delete" on public.payments;

create policy "own payments: select" on public.payments
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own payments: insert" on public.payments
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own payments: update" on public.payments
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own payments: delete" on public.payments
  for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();
