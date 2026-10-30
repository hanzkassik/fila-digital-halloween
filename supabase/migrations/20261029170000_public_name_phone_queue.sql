-- Public event registration stores the participant identity on the queue row,
-- so an account is not required. Direct table access remains revoked; public
-- clients can only use the narrow, identity-scoped RPCs below.
alter table public.event_queue
  alter column usuario_id drop not null,
  add column if not exists nome text,
  add column if not exists telefone text;

update public.event_queue q
set nome = p.nome,
    telefone = p.telefone
from public.profiles p
where q.usuario_id = p.id
  and (q.nome is null or q.telefone is null);

alter table public.event_queue
  add constraint event_queue_public_identity_check
  check (
    usuario_id is not null
    or (
      nome is not null
      and length(btrim(nome)) between 2 and 120
      and telefone ~ '^\+[1-9][0-9]{7,14}$'
    )
  );

create index event_queue_public_identity_idx
  on public.event_queue (evento_id, telefone, (lower(btrim(nome))), ordem_fila)
  where nome is not null and telefone is not null;

-- Keep account-linked queue entries usable while allowing anonymous queue
-- inserts only through the checked RPC. The browser still has no table grants.
create or replace function public.protect_queue_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_backend boolean := coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin');
  profile_name text;
  profile_phone text;
begin
  if trusted_backend or public.is_admin() then
    if tg_op = 'INSERT' and new.usuario_id is not null then
      select p.nome, p.telefone into profile_name, profile_phone
      from public.profiles p where p.id = new.usuario_id;
      new.nome := profile_name;
      new.telefone := profile_phone;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' and auth.uid() is null then
    if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
      raise exception 'Public queue registration is not allowed for this role' using errcode = '42501';
    end if;
    new.id := gen_random_uuid();
    new.usuario_id := null;
    new.nome := btrim(coalesce(new.nome, ''));
    new.telefone := btrim(coalesce(new.telefone, ''));
    if length(new.nome) not between 2 and 120
      or new.telefone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Valid name and international phone are required' using errcode = '22023';
    end if;
    new.status := 'na fila'::public.queue_status;
    new.pago := false;
    new.forma_pagamento := null;
    new.valor_pagamento := 0;
    new.atualizado_em := now();
    perform 1 from public.events e
      where e.id = new.evento_id and e.status = 'ativo'::public.record_status
      for update;
    if not found then
      raise exception 'Event not found or inactive' using errcode = '22023';
    end if;
    select coalesce(max(q.ordem_fila), 0) + 1 into new.ordem_fila
      from public.event_queue q where q.evento_id = new.evento_id;
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
    select p.nome, p.telefone into new.nome, new.telefone
      from public.profiles p where p.id = auth.uid();
    new.status := 'na fila'::public.queue_status;
    new.pago := false;
    new.forma_pagamento := null;
    new.valor_pagamento := 0;
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
      or new.nome is distinct from old.nome
      or new.telefone is distinct from old.telefone
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

create or replace function public.join_event_queue_public(
  p_evento_id uuid,
  p_nome text,
  p_telefone text
)
returns table (id uuid, ordem_fila bigint, status public.queue_status, criado_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(p_nome, ''));
  normalized_phone text := btrim(coalesce(p_telefone, ''));
begin
  if p_evento_id is null
    or length(normalized_name) not between 2 and 120
    or normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Valid event, name, and international phone are required' using errcode = '22023';
  end if;

  perform 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
    for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.event_queue q
    left join public.profiles p on p.id = q.usuario_id
    where q.evento_id = p_evento_id
      and q.status = 'na fila'::public.queue_status
      and lower(btrim(coalesce(q.nome, p.nome, ''))) = lower(normalized_name)
      and coalesce(q.telefone, p.telefone, '') = normalized_phone
  ) then
    raise exception 'An entry for this name and phone is already waiting' using errcode = '23505';
  end if;

  return query
    insert into public.event_queue as q (evento_id, usuario_id, nome, telefone, ordem_fila)
    select p_evento_id, null, normalized_name, normalized_phone,
      coalesce(max(existing.ordem_fila), 0) + 1
    from public.event_queue existing
    where existing.evento_id = p_evento_id
    returning q.id, q.ordem_fila, q.status, q.criado_em;
end;
$$;

create or replace function public.find_public_event_queue_entries(
  p_evento_id uuid,
  p_nome text,
  p_telefone text
)
returns table (id uuid, ordem_fila bigint, status public.queue_status, criado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.ordem_fila, q.status, q.criado_em
  from public.event_queue q
  join public.events e on e.id = q.evento_id
  left join public.profiles p on p.id = q.usuario_id
  where q.evento_id = p_evento_id
    and e.status = 'ativo'::public.record_status
    and q.status <> 'inativo'::public.queue_status
    and length(btrim(coalesce(p_nome, ''))) between 2 and 120
    and btrim(coalesce(p_telefone, '')) ~ '^\+[1-9][0-9]{7,14}$'
    and lower(btrim(coalesce(q.nome, p.nome, ''))) = lower(btrim(p_nome))
    and coalesce(q.telefone, p.telefone, '') = btrim(p_telefone)
  order by q.ordem_fila desc;
$$;

create or replace function public.estado_publico_fila_evento(
  p_evento_id uuid,
  p_nome text,
  p_telefone text
)
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
    and exists (
      select 1
      from public.event_queue mine
      left join public.profiles p on p.id = mine.usuario_id
      where mine.evento_id = e.id
        and mine.status <> 'inativo'::public.queue_status
        and lower(btrim(coalesce(mine.nome, p.nome, ''))) = lower(btrim(coalesce(p_nome, '')))
        and coalesce(mine.telefone, p.telefone, '') = btrim(coalesce(p_telefone, ''))
    );
$$;

-- Keep this RPC for older authenticated client versions, with identity snapshots now filled by the trigger.
revoke all on function public.join_event_queue_public(uuid, text, text) from public;
grant execute on function public.join_event_queue_public(uuid, text, text) to anon, authenticated;
revoke all on function public.find_public_event_queue_entries(uuid, text, text) from public;
grant execute on function public.find_public_event_queue_entries(uuid, text, text) to anon, authenticated;
revoke all on function public.estado_publico_fila_evento(uuid, text, text) from public;
grant execute on function public.estado_publico_fila_evento(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
