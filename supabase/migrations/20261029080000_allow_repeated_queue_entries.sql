-- A person may hold multiple queue entries for the same event. The event row
-- lock serializes additions, while the unique constraint on (evento_id,
-- ordem_fila) continues to guarantee a distinct sequential position.
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
