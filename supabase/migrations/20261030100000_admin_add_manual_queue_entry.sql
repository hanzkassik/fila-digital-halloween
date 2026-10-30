-- Lets an active administrator add an unlinked attendee directly to an event
-- queue while setting payment information. The browser cannot insert directly.
create or replace function public.admin_add_public_queue_entry(
  p_evento_id uuid,
  p_nome text,
  p_telefone text,
  p_pago boolean,
  p_forma_pagamento public.payment_method,
  p_valor_pagamento numeric
)
returns public.event_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.event_queue;
  clean_name text := btrim(coalesce(p_nome, ''));
  clean_phone text := btrim(coalesce(p_telefone, ''));
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.papel = 'admin'::public.user_role
      and p.status = 'ativo'::public.record_status
  ) then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;

  if p_evento_id is null or length(clean_name) not between 2 and 120
    or clean_phone !~ '^\+[1-9][0-9]{7,14}$'
    or p_valor_pagamento is null or p_valor_pagamento < 0 then
    raise exception 'Valid event, name, phone, and payment amount are required' using errcode = '22023';
  end if;

  perform 1 from public.events e
  where e.id = p_evento_id and e.status = 'ativo'::public.record_status
  for update;
  if not found then
    raise exception 'Event not found or inactive' using errcode = '22023';
  end if;

  insert into public.event_queue (
    evento_id, usuario_id, nome, telefone, ordem_fila, pago,
    forma_pagamento, valor_pagamento, status
  )
  select p_evento_id, null, clean_name, clean_phone,
    coalesce(max(q.ordem_fila), 0) + 1, coalesce(p_pago, false),
    p_forma_pagamento, p_valor_pagamento, 'na fila'::public.queue_status
  from public.event_queue q
  where q.evento_id = p_evento_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.admin_add_public_queue_entry(uuid, text, text, boolean, public.payment_method, numeric)
  from public, anon;
grant execute on function public.admin_add_public_queue_entry(uuid, text, text, boolean, public.payment_method, numeric)
  to authenticated;

notify pgrst, 'reload schema';
