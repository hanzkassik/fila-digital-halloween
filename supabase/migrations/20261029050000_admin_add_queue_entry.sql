create or replace function public.protect_queue_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted server functions use the service-role JWT. Browser users never receive this key.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

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

create or replace function public.admin_add_user_to_queue(p_evento_id uuid, p_usuario_id uuid)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.event_queue;
  trusted_backend boolean := coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin');
begin
  if not trusted_backend and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.papel = 'admin'::public.user_role
      and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  perform 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
    for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_usuario_id and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'User not found or inactive' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.event_queue q
    where q.evento_id = p_evento_id
      and q.usuario_id = p_usuario_id
      and q.status not in ('cancelado'::public.queue_status, 'inativo'::public.queue_status)
  ) then
    raise exception 'User already has an entry in this event queue' using errcode = '23505';
  end if;

  insert into public.event_queue (evento_id, usuario_id, ordem_fila)
  select p_evento_id, p_usuario_id, coalesce(max(q.ordem_fila), 0) + 1
    from public.event_queue q
    where q.evento_id = p_evento_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.admin_add_user_to_queue(uuid, uuid) from public, anon;
grant execute on function public.admin_add_user_to_queue(uuid, uuid) to authenticated, service_role;
