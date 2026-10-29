-- Public event landing pages must be able to read active event presentation data.
grant select on public.events to anon;

drop policy if exists "Public can view active events" on public.events;
create policy "Public can view active events"
on public.events for select to anon
using (status = 'ativo'::public.record_status);

-- Expose only the current and next queue numbers, never participant data.
create or replace function public.estado_fila_evento(p_evento_id uuid)
returns table (atendendo bigint, proxima bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select q.ordem_fila
      from public.event_queue q
      where q.evento_id = e.id
        and q.status = 'em atendimento'::public.queue_status
      order by q.ordem_fila
      limit 1
    ) as atendendo,
    (
      select q.ordem_fila
      from public.event_queue q
      where q.evento_id = e.id
        and q.status = 'na fila'::public.queue_status
      order by q.ordem_fila
      limit 1
    ) as proxima
  from public.events e
  where e.id = p_evento_id
    and e.status = 'ativo'::public.record_status
    and (select auth.uid()) is not null;
$$;

revoke all on function public.estado_fila_evento(uuid) from public, anon;
grant execute on function public.estado_fila_evento(uuid) to authenticated;
