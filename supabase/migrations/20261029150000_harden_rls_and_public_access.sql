-- Security hardening: active admins only, user profile self-service is limited,
-- queue access is exposed only through explicitly scoped RPCs, and anonymous
-- event reads are limited to one active event resolved by its public slug.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.papel = 'admin'::public.user_role
      and p.status = 'ativo'::public.record_status
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_backend boolean := coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin', 'supabase_auth_admin');
begin
  if trusted_backend or public.is_admin() then
    return new;
  end if;

  -- Only a trusted admin/backend can change identity, role, activation, or
  -- creation metadata. Email must always match the corresponding Auth user.
  new.id := old.id;
  new.papel := old.papel;
  -- An account owner may deactivate their own active account, but cannot
  -- reactivate it or change any other protected status value.
  if not (
    old.id = (select auth.uid())
    and old.status = 'ativo'::public.record_status
    and new.status = 'inativo'::public.record_status
  ) then
    new.status := old.status;
  end if;
  new.criado_em := old.criado_em;
  new.email := (select u.email from auth.users u where u.id = old.id);
  return new;
end;
$$;

create or replace function public.protect_queue_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_backend boolean := coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin');
begin
  if trusted_backend or public.is_admin() then
    return new;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Active user profile required' using errcode = '42501';
  end if;

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
    if new.id is distinct from old.id
      or new.evento_id is distinct from old.evento_id
      or new.usuario_id is distinct from old.usuario_id
      or new.ordem_fila is distinct from old.ordem_fila
      or new.pago is distinct from old.pago
      or new.forma_pagamento is distinct from old.forma_pagamento
      or new.valor_pagamento is distinct from old.valor_pagamento
      or new.criado_em is distinct from old.criado_em then
      raise exception 'Users may not edit queue records' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
      and not (old.status = 'na fila'::public.queue_status and new.status = 'cancelado'::public.queue_status) then
      raise exception 'Users may only cancel their own waiting entry' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- User registration is a narrowly scoped RPC. The client cannot insert rows
-- directly and cannot choose their own user id, status, payment, or position.
create or replace function public.join_event_queue(p_evento_id uuid)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.event_queue;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Active authenticated user required' using errcode = '42501';
  end if;
  perform 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
    for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  insert into public.event_queue (evento_id, usuario_id, ordem_fila)
  select p_evento_id, auth.uid(), coalesce(max(q.ordem_fila), 0) + 1
    from public.event_queue q where q.evento_id = p_evento_id
  returning * into result;
  return result;
end;
$$;

-- Public event page: one active event per slug, with presentation fields only.
create or replace function public.get_public_event_by_slug(p_slug text)
returns table (
  id uuid,
  slug varchar(80),
  nome text,
  data timestamptz,
  descricao text,
  imagem_capa text,
  banner text,
  favicon text,
  status public.record_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.slug, e.nome, e.data, e.descricao, e.imagem_capa, e.banner, e.favicon, e.status
  from public.events e
  where e.slug = p_slug
    and e.status = 'ativo'::public.record_status
  limit 1;
$$;

-- Private event queue history for the admin user details screen.
create or replace function public.admin_list_user_queue(p_usuario_id uuid)
returns setof public.event_queue
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;
  return query
    select q.* from public.event_queue q
    where q.usuario_id = p_usuario_id
    order by q.criado_em desc;
end;
$$;

-- Queue detail updates are administrator-only; no browser role gets direct
-- INSERT/UPDATE/DELETE privileges on the queue table.
create or replace function public.admin_update_queue_entry(
  p_queue_id uuid,
  p_status public.queue_status,
  p_pago boolean,
  p_forma_pagamento public.payment_method,
  p_valor_pagamento numeric
)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.event_queue;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;
  if p_valor_pagamento is null or p_valor_pagamento < 0 then
    raise exception 'Payment amount must be zero or greater' using errcode = '22023';
  end if;
  update public.event_queue q
    set status = p_status,
        pago = p_pago,
        forma_pagamento = p_forma_pagamento,
        valor_pagamento = p_valor_pagamento
    where q.id = p_queue_id
    returning q.* into result;
  if not found then
    raise exception 'Queue entry not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- A regular user can see their own profile and active events, but only an
-- active admin can inspect other profiles or update protected account fields.
drop policy if exists "Profiles visible to owner or admin" on public.profiles;
create policy "Profiles visible to owner or active admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users update own profile and admins update all" on public.profiles;
create policy "Users update own profile or active admin updates all" on public.profiles
  for update to authenticated
  using (
    (id = (select auth.uid()) and status = 'ativo'::public.record_status)
    or (select public.is_admin())
  )
  with check (
    (id = (select auth.uid()) and status in ('ativo'::public.record_status, 'inativo'::public.record_status))
    or (select public.is_admin())
  );

revoke update on public.profiles from authenticated;
revoke update (id, nome, telefone, email, cpf, papel, data_nascimento, criado_em, atualizado_em, status)
  on public.profiles from authenticated;
grant update (nome, telefone, cpf, data_nascimento, status) on public.profiles to authenticated;

-- Do not allow anonymous clients to enumerate all active events through REST.
drop policy if exists "Public can view active events" on public.events;
revoke all on public.events from public, anon;
grant select on public.events to authenticated;

-- Queue rows are never selected directly. All reads go through event-scoped
-- user RPCs or admin-only history RPCs.
drop policy if exists "Queue visible to owner when active or to admin" on public.event_queue;
create policy "Queue visible to owner or active admin" on public.event_queue
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      usuario_id = (select auth.uid())
      and status <> 'inativo'::public.queue_status
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.status = 'ativo'::public.record_status
      )
    )
  );

drop policy if exists "Users join active event or admins insert" on public.event_queue;
drop policy if exists "Users update own queue status or admins update all" on public.event_queue;
drop policy if exists "Admins delete queue entries" on public.event_queue;
revoke all on public.event_queue from public, anon, authenticated;

-- Active members must provide an event id to list their queue entries. A
-- non-member cannot inspect queue state for another event.
create or replace function public.listar_fila_evento(p_evento_id uuid default null)
returns setof public.event_queue
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Active user profile required' using errcode = '42501';
  end if;
  if p_evento_id is null and not public.is_admin() then
    raise exception 'Event id is required' using errcode = '22023';
  end if;
  return query
    select q.* from public.event_queue q
    join public.events e on e.id = q.evento_id
    where (p_evento_id is null or q.evento_id = p_evento_id)
      and (public.is_admin() or e.status = 'ativo'::public.record_status)
      and (public.is_admin() or (q.usuario_id = auth.uid() and q.status <> 'inativo'::public.queue_status));
end;
$$;

-- Queue numbers are visible only to an active admin or a user with an active
-- entry in that same event.
create or replace function public.estado_fila_evento(p_evento_id uuid)
returns table (atendendo bigint, proxima bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select q.ordem_fila from public.event_queue q
      where q.evento_id = e.id and q.status = 'em atendimento'::public.queue_status
      order by q.ordem_fila limit 1) as atendendo,
    (select q.ordem_fila from public.event_queue q
      where q.evento_id = e.id and q.status = 'na fila'::public.queue_status
      order by q.ordem_fila limit 1) as proxima
  from public.events e
  where e.id = p_evento_id
    and e.status = 'ativo'::public.record_status
    and (select auth.uid()) is not null
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.profiles p
        join public.event_queue mine on mine.usuario_id = p.id
        where p.id = (select auth.uid())
          and p.status = 'ativo'::public.record_status
          and mine.evento_id = e.id
          and mine.status in ('na fila'::public.queue_status, 'em atendimento'::public.queue_status)
      )
    );
$$;

-- `proxima_ordem_fila` is obsolete and has no client callers. Keep it defined
-- for migrations/history but remove its execution right from API roles.
revoke all on function public.proxima_ordem_fila(uuid) from public, anon, authenticated;

revoke all on function public.join_event_queue(uuid) from public, anon;
grant execute on function public.join_event_queue(uuid) to authenticated;
revoke all on function public.get_public_event_by_slug(text) from public;
grant execute on function public.get_public_event_by_slug(text) to anon, authenticated;
revoke all on function public.listar_fila_evento(uuid) from public, anon;
grant execute on function public.listar_fila_evento(uuid) to authenticated;
revoke all on function public.estado_fila_evento(uuid) from public, anon;
grant execute on function public.estado_fila_evento(uuid) to authenticated;
revoke all on function public.admin_list_user_queue(uuid) from public, anon;
grant execute on function public.admin_list_user_queue(uuid) to authenticated;
revoke all on function public.admin_update_queue_entry(uuid, public.queue_status, boolean, public.payment_method, numeric)
  from public, anon;
grant execute on function public.admin_update_queue_entry(uuid, public.queue_status, boolean, public.payment_method, numeric)
  to authenticated;

