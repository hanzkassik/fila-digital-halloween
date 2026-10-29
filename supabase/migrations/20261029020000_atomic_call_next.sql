create or replace function public.chamar_proximo_da_fila(p_evento_id uuid)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  proximo public.event_queue;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  -- Serialize calls for the same event so two admins cannot call the same place.
  perform 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
    for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  update public.event_queue
    set status = 'atendido'::public.queue_status
    where evento_id = p_evento_id
      and status = 'em atendimento'::public.queue_status;

  select q.id into proximo.id
    from public.event_queue q
    where q.evento_id = p_evento_id
      and q.status = 'na fila'::public.queue_status
      and q.pago
    order by q.ordem_fila
    limit 1
    for update;

  if proximo.id is null then
    return null;
  end if;

  update public.event_queue q
    set status = 'em atendimento'::public.queue_status
    where q.id = proximo.id
    returning q.* into proximo;
  return proximo;
end;
$$;

revoke all on function public.chamar_proximo_da_fila(uuid) from public, anon;
grant execute on function public.chamar_proximo_da_fila(uuid) to authenticated;
