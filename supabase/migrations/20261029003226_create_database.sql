-- Core schema for Fila Digital. Profiles are linked to Supabase Auth users.
create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'user');
create type public.record_status as enum ('ativo', 'inativo');
create type public.queue_status as enum ('na fila', 'em atendimento', 'atendido', 'inativo', 'cancelado');
create type public.payment_method as enum ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'outro');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  telefone text,
  email text not null,
  cpf text,
  papel public.user_role not null default 'user',
  data_nascimento date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  status public.record_status not null default 'ativo',
  constraint profiles_email_unique unique (email),
  constraint profiles_cpf_unique unique (cpf),
  constraint profiles_phone_format check (telefone is null or telefone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint profiles_cpf_format check (cpf is null or cpf ~ '^[0-9]{11}$')
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data timestamptz not null,
  descricao text,
  imagem_capa text,
  banner text,
  status public.record_status not null default 'ativo',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.event_queue (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.events(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  ordem_fila bigint not null,
  pago boolean not null default false,
  forma_pagamento public.payment_method,
  valor_pagamento numeric(12,2) not null default 0 check (valor_pagamento >= 0),
  status public.queue_status not null default 'na fila',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint event_queue_order_unique unique (evento_id, ordem_fila),
  constraint event_queue_order_positive check (ordem_fila > 0)
);

create index event_queue_user_event_idx on public.event_queue (usuario_id, evento_id);
create index event_queue_event_status_order_idx on public.event_queue (evento_id, status, ordem_fila);

-- Read the role without recursing through profiles RLS.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.papel = 'admin'::public.user_role
  );
$$;

-- Create a regular profile on sign-up. Admins must be assigned deliberately by a trusted operator.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, email, telefone, cpf, data_nascimento)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'telefone',
    new.raw_user_meta_data ->> 'cpf',
    nullif(new.raw_user_meta_data ->> 'data_nascimento', '')::date
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger queue_set_updated_at before update on public.event_queue
  for each row execute function public.set_updated_at();

-- Row policies alone do not protect individual columns. This prevents a user from
-- promoting themselves or changing immutable identity/creation fields.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    new.id := old.id;
    new.papel := old.papel;
    new.criado_em := old.criado_em;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_fields before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Enforce user-controlled queue fields at the database boundary, including direct REST writes.
create or replace function public.protect_queue_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.id := gen_random_uuid();
      new.usuario_id := auth.uid();
      new.status := 'na fila'::public.queue_status;
      new.pago := false;
      new.forma_pagamento := null;
      new.valor_pagamento := 0;
      new.ordem_fila := null;
      new.criado_em := now();
      new.atualizado_em := now();
      perform 1 from public.events e
        where e.id = new.evento_id and e.status = 'ativo'::public.record_status
        for update;
      if not found then
        raise exception 'Event not found or inactive' using errcode = '22023';
      end if;
      select coalesce(max(q.ordem_fila), 0) + 1 into new.ordem_fila
        from public.event_queue q where q.evento_id = new.evento_id;
    else
      if new.evento_id is distinct from old.evento_id
        or new.usuario_id is distinct from old.usuario_id
        or new.ordem_fila is distinct from old.ordem_fila
        or new.pago is distinct from old.pago
        or new.forma_pagamento is distinct from old.forma_pagamento
        or new.valor_pagamento is distinct from old.valor_pagamento
        or new.criado_em is distinct from old.criado_em then
        raise exception 'Users may only change queue status' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger queue_protect_fields before insert or update on public.event_queue
  for each row execute function public.protect_queue_fields();

-- Allocate a unique, sequential position atomically for each event.
create or replace function public.join_event_queue(p_evento_id uuid)
returns public.event_queue
language plpgsql security invoker
set search_path = ''
as $$
declare
  result public.event_queue;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
  ) then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  -- The event row lock serializes allocations for this event.
  perform 1 from public.events e where e.id = p_evento_id for update;
  insert into public.event_queue (evento_id, usuario_id, ordem_fila)
  select p_evento_id, auth.uid(), coalesce(max(q.ordem_fila), 0) + 1
  from public.event_queue q where q.evento_id = p_evento_id
  returning * into result;
  return result;
end;
$$;

-- Returns the position currently being served, or the next paid active position.
create or replace function public.proxima_ordem_fila(p_evento_id uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select q.ordem_fila
  from public.event_queue q
  join public.events e on e.id = q.evento_id
  where q.evento_id = p_evento_id
    and e.status = 'ativo'::public.record_status
    and q.status in ('em atendimento'::public.queue_status, 'na fila'::public.queue_status)
    and (q.status = 'em atendimento'::public.queue_status or q.pago)
  order by (q.status = 'em atendimento'::public.queue_status) desc, q.ordem_fila
  limit 1;
$$;

-- Queue reads require an event id for regular users. Admins may pass NULL to list all.
create or replace function public.listar_fila_evento(p_evento_id uuid default null)
returns setof public.event_queue
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_evento_id is null and not public.is_admin() then
    raise exception 'Event id is required' using errcode = '22023';
  end if;
  return query
    select q.* from public.event_queue q
    join public.events e on e.id = q.evento_id
    where (p_evento_id is null or q.evento_id = p_evento_id)
      and (public.is_admin() or e.status = 'ativo'::public.record_status)
      and (public.is_admin() or (q.usuario_id = auth.uid() and q.status <> 'inativo'::public.queue_status))
    order by q.evento_id, q.ordem_fila;
end;
$$;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_queue enable row level security;

create policy "Profiles visible to owner or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "Users update own profile and admins update all" on public.profiles
  for update to authenticated using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create policy "Events visible when active or to admin" on public.events
  for select to authenticated using (status = 'ativo'::public.record_status or (select public.is_admin()));
create policy "Admins create events" on public.events
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins update events" on public.events
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete events" on public.events
  for delete to authenticated using ((select public.is_admin()));

create policy "Queue visible to owner when active or to admin" on public.event_queue
  for select to authenticated using (
    (usuario_id = (select auth.uid()) and status <> 'inativo'::public.queue_status)
    or (select public.is_admin())
  );
create policy "Users join active event or admins insert" on public.event_queue
  for insert to authenticated with check (
    (select public.is_admin())
    or (
      usuario_id = (select auth.uid())
      and status = 'na fila'::public.queue_status
      and pago = false
      and forma_pagamento is null
      and valor_pagamento = 0
      and exists (select 1 from public.events e where e.id = evento_id and e.status = 'ativo'::public.record_status)
    )
  );
create policy "Users update own queue status or admins update all" on public.event_queue
  for update to authenticated using (usuario_id = (select auth.uid()) or (select public.is_admin()))
  with check (usuario_id = (select auth.uid()) or (select public.is_admin()));
create policy "Admins delete queue entries" on public.event_queue
  for delete to authenticated using ((select public.is_admin()));

-- Column grants ensure users cannot bypass the intended insert/update fields through the API.
revoke all on public.profiles, public.events, public.event_queue from anon, authenticated;
grant select on public.profiles, public.events to authenticated;
grant update (nome, telefone, email, cpf, data_nascimento, status) on public.profiles to authenticated;
grant insert (nome, data, descricao, imagem_capa, banner, status) on public.events to authenticated;
grant update (nome, data, descricao, imagem_capa, banner, status) on public.events to authenticated;
grant delete on public.events to authenticated;
grant insert (evento_id, usuario_id, ordem_fila, pago, forma_pagamento, valor_pagamento, status) on public.event_queue to authenticated;
grant update (status, pago, forma_pagamento, valor_pagamento, evento_id, usuario_id, ordem_fila) on public.event_queue to authenticated;
grant delete on public.event_queue to authenticated;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.join_event_queue(uuid) from public, anon;
revoke all on function public.proxima_ordem_fila(uuid) from public, anon;
revoke all on function public.listar_fila_evento(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.join_event_queue(uuid) to authenticated;
grant execute on function public.proxima_ordem_fila(uuid) to authenticated;
grant execute on function public.listar_fila_evento(uuid) to authenticated;
