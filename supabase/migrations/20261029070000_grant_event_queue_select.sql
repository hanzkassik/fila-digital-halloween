-- Table privileges are checked before RLS policies. RLS still limits which
-- rows authenticated users can read; the existing policy grants admins all
-- queue rows and regular users only their own non-inactive entries.
grant select on public.event_queue to authenticated;
