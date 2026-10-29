# Supabase: banco da fila digital

## Aplicar a migração

No diretório do projeto, rode `supabase db push` depois de vincular a CLI ao projeto. Também é possível colar o conteúdo de `migrations/20261029003226_create_database.sql` no SQL Editor do Supabase.

O painel usa as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (ou a chave publicável equivalente). Copie `.env.example` para `.env.local` e preencha esses valores. Nunca coloque a `service_role` no navegador.

## Segurança e publicação

A migration `20261029150000_harden_rls_and_public_access.sql` endurece as permissões: somente administradores ativos podem alterar eventos e filas; usuários autenticados podem atualizar nome, telefone, CPF e nascimento do próprio perfil, além de inativar a própria conta, e entrar na fila por RPC; leituras de fila usam funções com escopo; visitantes anônimos carregam um único evento ativo pelo slug. A inativação é permitida uma única vez e o usuário não pode reativar a própria conta. Aplique as migrations pendentes antes de publicar o frontend que usa esses RPCs.

As Edge Functions administrativas devem continuar com `verify_jwt = true`. Implante ambas após qualquer alteração nelas com `supabase functions deploy admin-create-user` e `supabase functions deploy admin-update-user`. A chave `service_role` deve existir somente nos secrets do Supabase, nunca no frontend.

O botão administrativo **Criar usuário** envia um convite pela Edge Function `admin-create-user`. A função valida o JWT e confirma no banco que o chamador ainda tem papel `admin` e status `ativo`; a chave `service_role` fica somente no ambiente seguro da função. Implante com `supabase functions deploy admin-create-user` e configure `APP_URL` como secret da função para o endereço final do app (por exemplo, `supabase secrets set APP_URL=https://seu-dominio.com`). Configure a URL do site em **Authentication → URL Configuration** e um SMTP para entrega dos convites.

A tela **Usuários** consulta os perfis e o histórico de fila de cada cadastro. Alterações administrativas usam a Edge Function `admin-update-user`, que valida o JWT e o papel/status do administrador antes de editar perfil, papel, status e e-mail do usuário. Implante com `supabase functions deploy admin-update-user`.

A migração `20261029070000_grant_event_queue_select.sql` concede o privilégio SQL de leitura à role `authenticated`; as políticas RLS da tabela continuam decidindo quais registros cada usuário pode ver. Aplique com `supabase db push`.

A migração `20261029080000_allow_repeated_queue_entries.sql` permite que a mesma pessoa receba mais de uma posição no mesmo evento. As posições continuam únicas e sequenciais por evento.

Para adicionar um evento opcionalmente no mesmo formulário de criação, ou adicionar um perfil existente pela tela da fila, aplique também `migrations/20261029050000_admin_add_queue_entry.sql`. Essa migração fornece `admin_add_user_to_queue`, que valida evento e usuário ativos e atribui a próxima posição de forma serializada. A criação de novos usuários com evento usa a Edge Function `admin-create-user` e tenta desfazer a conta se a entrada na fila falhar.

Em **Authentication → Email Templates**, configure os modelos **Magic Link**, **Confirm signup** e **Reset Password** para exibir `{{ .Token }}`. O painel pede códigos de seis dígitos; os modelos padrão podem enviar um link em vez do código.

Novas contas do Supabase Auth recebem automaticamente uma linha em `public.profiles`. O campo `nome` vem de `raw_user_meta_data.nome` (ou do início do e-mail, se não for informado). Telefone internacional deve usar `+` seguido de 8 a 15 dígitos; CPF deve conter 11 dígitos sem pontuação.

## Tornar uma conta administradora

Depois de criar a conta normalmente e aplicar as migrações pendentes, um operador confiável pode promover seu perfil no SQL Editor:

```sql
update public.profiles
set papel = 'admin'
where email = 'admin@exemplo.com';
```

Não inclua papel de administrador nos metadados públicos de cadastro. A função de criação de perfil sempre define `papel = 'user'`.

## Chamadas da aplicação

- Perfis: consultar `profiles` pelo próprio `id`; a política RLS também restringe os resultados.
- Eventos: consultar `events`; usuários autenticados recebem somente ativos.
- Entrar na fila: `supabase.rpc('join_event_queue', { p_evento_id: eventoId })`. A posição é atribuída no banco em uma transação serializada por evento.
- Consultar fila: `supabase.rpc('listar_fila_evento', { p_evento_id: eventoId })`. Para administradores, `p_evento_id: null` lista todas as filas.
- Excluir inscrições como administrador: `supabase.rpc('admin_delete_queue_entries', { p_evento_id: eventoId, p_queue_ids: [queueId1, queueId2] })`. A migration `20261029160000_admin_delete_queue_entries.sql` restringe a operação a administradores ativos e processa os itens do maior número para o menor. Aplique a migration antes de usar a exclusão.
- Estado público da fila para participante: `supabase.rpc('estado_fila_evento', { p_evento_id: eventoId })`. A função só retorna números para administradores ativos e participantes ativos daquele evento. A função antiga `proxima_ordem_fila` não é mais executável pelas roles da API.
- Chamar próximo no painel: `supabase.rpc('chamar_proximo_da_fila', { p_evento_id: eventoId })`. A função valida que o chamador é administrador ativo e avança atomicamente para a próxima posição em ordem, independentemente do pagamento. Se a fila estiver vazia, mantém o atendimento atual. Aplique `20261029090000_call_next_unpaid_queue_entries.sql`.
- Criar um usuário pelo painel: `supabase.functions.invoke('admin-create-user', { body: { nome, cpf, email, telefone, data_nascimento } })`. O gatilho de criação de perfil salva a data de nascimento dos metadados de convite. A migração `20261029040000_sync_profile_email.sql` sincroniza no perfil as alterações de e-mail confirmadas pelo Supabase Auth.

## Estados

Perfis e eventos usam `ativo` / `inativo`. A fila começa em `na fila` e também aceita `em atendimento`, `atendido`, `cancelado` e `inativo`. Uma pessoa vê apenas suas entradas não inativas; administradores podem consultar todos os estados. Formas de pagamento aceitas: `pix`, `dinheiro`, `cartao_credito`, `cartao_debito`, `transferencia` e `outro`.

Eventos possuem `slug` único, obrigatório e com até 80 caracteres. Use letras minúsculas, números e hífens entre palavras (por exemplo, `festa-junina-2027`).
