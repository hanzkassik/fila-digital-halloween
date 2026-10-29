-- The events RLS policies still restrict writes to administrators.
-- Allow inserting the new field and the update operation used by PostgREST.
-- The table-level UPDATE grant does not bypass the admin-only RLS policy.
grant insert (favicon) on public.events to authenticated;
grant update on public.events to authenticated;
