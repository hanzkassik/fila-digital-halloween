-- Event artwork uses the existing public bucket and is stored under events/{event_id}/.
-- Only active administrators may write files in the bucket.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'fila-digital-halloween') then
    raise exception 'The fila-digital-halloween Storage bucket must exist before this migration is applied.';
  end if;
end;
$$;

update storage.buckets
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
where id = 'fila-digital-halloween';

create or replace function public.is_active_admin()
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

revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

drop policy if exists "Active admins upload event images" on storage.objects;
create policy "Active admins upload event images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fila-digital-halloween'
  and (storage.foldername(name))[1] = 'events'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('covers', 'banners')
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
  and (storage.foldername(name))[3] in ('covers', 'banners')
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
  and (storage.foldername(name))[3] in ('covers', 'banners')
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
  and (storage.foldername(name))[3] in ('covers', 'banners')
  and (select public.is_active_admin())
);
