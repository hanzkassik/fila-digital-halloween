create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SQL Editor and migrations run as the trusted postgres session. Authenticated
  -- application users still need to be admins before they can change protected fields.
  if session_user not in ('postgres', 'supabase_admin') and not public.is_admin() then
    new.id := old.id;
    new.papel := old.papel;
    new.criado_em := old.criado_em;
  end if;
  return new;
end;
$$;
