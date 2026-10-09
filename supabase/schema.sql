-- Finanzas personales: esquema para Supabase
-- Ejecutar en Supabase > SQL Editor.

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month      date not null,            -- siempre primer día del mes (2026-10-01)
  grp        text not null,            -- Ingresos | Fijos | Facturas | nombre de tarjeta
  name       text not null,            -- UBA, Split, Gasto unico, En cuotas, Luz, ...
  amount     numeric(14,2) not null default 0,
  expr       text,                     -- fórmula original si se cargó como "42727+290000"
  updated_at timestamptz not null default now(),
  constraint entries_month_first_day check (month = date_trunc('month', month)::date),
  constraint entries_unique unique (user_id, month, grp, name)
);

create index if not exists entries_user_month_idx on public.entries (user_id, month);

alter table public.entries enable row level security;

create policy "own rows: select" on public.entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.entries
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.entries
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();
