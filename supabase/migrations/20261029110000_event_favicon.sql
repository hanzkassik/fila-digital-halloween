alter table public.events
  add column if not exists favicon text;

-- Permit event-specific favicons in events/{event_id}/favicons/ while keeping
-- writes restricted to active administrators and real event IDs.
drop policy if exists "Active admins upload event images" on storage.objects;
create policy "Active admins upload event images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fila-digital-halloween'
  and (storage.foldername(name))[1] = 'events'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('covers', 'banners', 'favicons')
  and exists (
    select 1 from public.events e
    where e.id::text = (storage.foldername(name))[2]
  )
  and (select public.is_active_admin())
);

drop policy if exists "Active admins update event images" on storage.objects;
create policy "Active admins update event images"
on storage.objects for update to authenticated
using (
  bucket_id = 'fila-digital-halloween'
  and (storage.foldername(name))[1] = 'events'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('covers', 'banners', 'favicons')
  and exists (
    select 1 from public.events e
    where e.id::text = (storage.foldername(name))[2]
  )
  and (select public.is_active_admin())
)
with check (
  bucket_id = 'fila-digital-halloween'
  and (storage.foldername(name))[1] = 'events'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('covers', 'banners', 'favicons')
  and exists (
    select 1 from public.events e
    where e.id::text = (storage.foldername(name))[2]
  )
  and (select public.is_active_admin())
);

drop policy if exists "Active admins delete event images" on storage.objects;
create policy "Active admins delete event images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'fila-digital-halloween'
  and (storage.foldername(name))[1] = 'events'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('covers', 'banners', 'favicons')
  and (select public.is_active_admin())
);
