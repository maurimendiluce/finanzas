-- Enlace privado para suscribir los vencimientos al calendario del celular.
-- Ejecutar en Supabase > SQL Editor (se puede correr más de una vez).

create table if not exists public.calendar_feed (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token      text not null unique check (length(token) >= 32),
  created_at timestamptz not null default now()
);

alter table public.calendar_feed enable row level security;

drop policy if exists "own feed: select" on public.calendar_feed;
drop policy if exists "own feed: insert" on public.calendar_feed;
drop policy if exists "own feed: update" on public.calendar_feed;
drop policy if exists "own feed: delete" on public.calendar_feed;

create policy "own feed: select" on public.calendar_feed
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own feed: insert" on public.calendar_feed
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own feed: update" on public.calendar_feed
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own feed: delete" on public.calendar_feed
  for delete to authenticated using (user_id = (select auth.uid()));
