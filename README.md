# Fila Digital Halloween

Aplicação web mobile-first para organizar inscrições e atendimento em filas de eventos. O sistema combina uma página pública para participantes com um painel administrativo para gerenciar eventos, pessoas, pagamentos e chamadas da fila.

## Como funciona

### Área pública

Cada evento ativo tem um link próprio, acessado pelo slug:

```text
/events/<slug>
```

Por exemplo: `/events/inferna-party`.

Na página pública, o participante pode ver o nome e as informações disponíveis do evento, incluindo capa, descrição e identidade visual. Para consultar ou entrar na fila, informa **nome e telefone**. O sistema localiza as inscrições correspondentes daquele evento e permite criar uma nova inscrição quando não há uma inscrição ativa aguardando atendimento.

Depois de entrar na fila, o participante recebe um link individual:

```text
/events/<slug>/<id_fila>
```

Nessa página pode acompanhar o número da senha e o estado da fila. A página pode avisar quando chegar a vez, conforme os recursos disponíveis no navegador. O formulário público usa Cloudflare Turnstile quando configurado.

O fluxo público não exige a criação de conta. A consulta e a criação da inscrição são limitadas por funções seguras no Supabase para evitar acesso amplo aos registros da fila.

### Painel administrativo

O painel fica em rotas protegidas. O acesso começa em `/auth`; após autenticar, somente perfis ativos com papel de administrador podem abrir as telas administrativas. Usuários sem aprovação permanecem na tela de aprovação. O painel pode retornar à rota administrativa originalmente solicitada depois do login.

No painel, administradores podem:

- Criar, consultar, editar e inativar eventos.
- Gerenciar nome, slug, data, descrição, capa, banner, favicon e mensagem padrão para WhatsApp.
- Compartilhar o link público do evento e gerar um QR Code temático para impressão.
- Ver a fila de cada evento, ordenar por número, status ou nome, buscar por nome/telefone/senha e filtrar por status e pagamento.
- Adicionar pessoas à fila informando nome, telefone e dados de pagamento, mesmo sem criar ou selecionar uma conta.
- Chamar o próximo participante, abrir os dados de uma inscrição e contatá-lo pelo WhatsApp.
- Editar inscrições e remover uma ou várias entradas da fila.
- Criar e administrar usuários, consultar seus dados e histórico de participação por evento.
- Editar o próprio perfil e sair da conta.

A interface foi construída para uso em celular e desktop, com tema Halloween escuro e claro. No celular, o painel oferece menu lateral adaptado e acesso facilitado às ações da fila.

### Rotas principais

| Rota | Uso |
| --- | --- |
| `/auth` | Login administrativo |
| `/events` | Lista de eventos no painel |
| `/events/<id_evento>` | Fila e administração do evento |
| `/users` | Lista de usuários |
| `/users/<id_usuario>` | Dados e histórico do usuário |
| `/profile` | Perfil da conta autenticada |
| `/events/<slug>` | Página pública do evento |
| `/events/<slug>/<id_fila>` | Acompanhamento público da inscrição |

## Tecnologias

- React, TypeScript e Vite
- Supabase Auth, PostgreSQL, Row Level Security, Storage e Edge Functions
- Cloudflare Turnstile para proteção do formulário público, quando ativado
- GitHub Actions e GitHub Pages para o deploy atual

## Executar localmente

Requisitos: Node.js e npm.

```bash
npm install
```

Crie `.env.local` com base em `.env.example` e configure os valores do seu projeto Supabase:

```dotenv
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publicavel-ou-anon
VITE_TURNSTILE_SITE_KEY=sua-chave-publica-do-turnstile
```

As variáveis `VITE_*` são incorporadas ao frontend. Use somente chaves públicas do Supabase nesse arquivo. Nunca adicione `service_role`, segredo do Turnstile ou outras credenciais privadas ao código do navegador.

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

Outros comandos:

```bash
npm run build    # verifica TypeScript e gera a versão de produção em dist/
npm run lint     # executa o ESLint
npm run preview  # serve localmente a versão de produção
```

## Supabase

As migrations, políticas de RLS, Edge Functions e instruções detalhadas de configuração estão em [`supabase/README.md`](supabase/README.md) e no diretório [`supabase/migrations`](supabase/migrations).

Antes de publicar uma versão que use novas funções ou regras, aplique as migrations pendentes no projeto Supabase e implante as Edge Functions necessárias. A inscrição pública depende da função `public-queue-signup` e da configuração do Turnstile, conforme o guia do Supabase.

O upload de imagens de evento usa o bucket `fila-digital-halloween`, na estrutura `events/<id-do-evento>/`. Configure permissões e políticas do Storage conforme as migrations/documentação do projeto; uploads e alterações administrativas devem ser restritos a administradores autorizados.

### Autenticação e aprovação

Configure no Supabase Authentication os provedores desejados (e-mail e, se habilitado, Google OAuth), a URL pública do site e as URLs de redirecionamento. Contas novas começam como usuários comuns; um administrador precisa aprovar/promover o perfil antes do acesso ao painel.

## Publicação

O deploy atual usa GitHub Actions e GitHub Pages. O workflow está em [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Configure nos secrets do repositório:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TURNSTILE_SITE_KEY` (se o Turnstile estiver habilitado)

O projeto configura a base `/fila-digital-halloween/` para GitHub Pages. Se mudar de provedor ou domínio, confira `vite.config.ts`, as rotas, as URLs de redirecionamento do Supabase Auth e os domínios autorizados do Turnstile.

## Estrutura do projeto

```text
src/
  components/       Componentes compartilhados
  lib/              Cliente Supabase e utilitários
  pages/
    admin/          Painel, eventos, fila e usuários
    approval/       Aguardando aprovação
    auth/           Login administrativo
    profile/        Perfil da conta
    public/         Página pública do evento e inscrição
  styles/           Estilos e temas
supabase/
  functions/        Edge Functions
  migrations/       Estrutura, funções e políticas do banco
```

