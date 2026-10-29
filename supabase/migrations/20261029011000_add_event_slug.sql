alter table public.events add column slug varchar(80);

-- Backfill existing events with readable, unique slugs before making the field required.
update public.events
set slug = left(
  coalesce(nullif(trim(both '-' from regexp_replace(lower(nome), '[^a-z0-9]+', '-', 'g')), ''), 'evento'),
  67
) || '-' || left(replace(id::text, '-', ''), 8);

alter table public.events
  alter column slug set not null,
  add constraint events_slug_unique unique (slug),
  add constraint events_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

grant insert (slug, nome, data, descricao, imagem_capa, banner, status) on public.events to authenticated;
grant update (slug, nome, data, descricao, imagem_capa, banner, status) on public.events to authenticated;
