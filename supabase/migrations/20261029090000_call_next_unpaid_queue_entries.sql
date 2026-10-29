-- Only an active administrator may advance an event queue. Payment is
-- recorded independently; unpaid entries are eligible to be called.
-- Keep the current attendee in place if nobody is waiting.
create or replace function public.chamar_proximo_da_fila(p_evento_id uuid)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_id uuid;
  result public.event_queue;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.papel = 'admin'::public.user_role
      and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;

  perform 1 from public.events e
    where e.id = p_evento_id and e.status = 'ativo'::public.record_status
    for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  select q.id into next_id
    from public.event_queue q
    where q.evento_id = p_evento_id
      and q.status = 'na fila'::public.queue_status
    order by q.ordem_fila
    limit 1
    for update;

  if next_id is null then
    return null;
  end if;

  update public.event_queue
    set status = 'atendido'::public.queue_status
    where evento_id = p_evento_id
      and status = 'em atendimento'::public.queue_status;

  update public.event_queue q
    set status = 'em atendimento'::public.queue_status
    where q.id = next_id
    returning q.* into result;

  return result;
end;
$$;

revoke all on function public.chamar_proximo_da_fila(uuid) from public, anon;
grant execute on function public.chamar_proximo_da_fila(uuid) to authenticated;

-- The public position indicator uses the same sequential rule and does not
-- filter out a person due to payment status.
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
  order by (q.status = 'em atendimento'::public.queue_status) desc, q.ordem_fila
  limit 1;
$$;
