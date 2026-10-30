-- All public queue creation must pass Turnstile validation in the Edge
-- Function. Revoke direct RPC execution to prevent captcha bypass.
revoke all on function public.join_event_queue_public(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.join_event_queue_public(uuid, text, text)
  to service_role;

-- The old account-linked public RPC is no longer used by the public form and
-- would otherwise provide an authenticated path around the captcha.
revoke all on function public.join_event_queue(uuid)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
