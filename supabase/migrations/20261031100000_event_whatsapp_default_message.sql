alter table public.events
  add column if not exists mensagem_padrao_whatsapp text not null
  default 'Olá, {{nome_pessoa}}! Sua vez chegou no evento {{nome_evento}}. Sua senha é {{numero_senha}}.';
