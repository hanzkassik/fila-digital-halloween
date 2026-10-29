-- Google OAuth supplies `full_name`/`name`; phone and CPF remain optional.
-- Every newly authenticated account is still created as a regular user by
-- the column defaults on public.profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, email, telefone, cpf, data_nascimento)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nome'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'telefone'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '[^0-9]', '', 'g'), ''),
    nullif(new.raw_user_meta_data ->> 'data_nascimento', '')::date
  );
  return new;
end;
$$;
