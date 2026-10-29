-- Queue entries can only be deleted by an active administrator. Browser
-- clients use the RPC, which locks the event and deletes selected entries
-- from the highest queue number down to the lowest.
drop policy if exists "Admins delete queue entries" on public.event_queue;
create policy "Active admins delete queue entries" on public.event_queue
  for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.admin_delete_queue_entries(
  p_evento_id uuid,
  p_queue_ids uuid[]
)
returns table (deleted_id uuid, deleted_order bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry record;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;
  if p_evento_id is null or p_queue_ids is null or cardinality(p_queue_ids) = 0 then
    raise exception 'Event and at least one queue entry are required' using errcode = '22023';
  end if;

  -- Serialize deletion with queue-number allocation and other event operations.
  perform 1 from public.events e where e.id = p_evento_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  for entry in
    select q.id, q.ordem_fila
    from public.event_queue q
    where q.evento_id = p_evento_id
      and q.id = any(p_queue_ids)
    order by q.ordem_fila desc, q.id desc
    for update
  loop
    delete from public.event_queue q
    where q.id = entry.id
    returning q.id, q.ordem_fila into deleted_id, deleted_order;
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_delete_queue_entries(uuid, uuid[]) from public, anon;
grant execute on function public.admin_delete_queue_entries(uuid, uuid[]) to authenticated;
