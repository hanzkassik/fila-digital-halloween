import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const configuredAppUrl = Deno.env.get('APP_URL')
const configuredAppOrigin = (() => {
  try { return configuredAppUrl ? new URL(configuredAppUrl).origin : undefined } catch { return undefined }
})()

const allowedOrigins = [
  configuredAppOrigin,
  'https://hanzkassik.github.io',
  'http://localhost:5173', 'http://localhost:5174',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
].filter((origin): origin is string => Boolean(origin))

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  if (!allowedOrigins.includes(origin)) return new Response('Origin not allowed', { status: 403 })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!supabaseUrl || !serviceRoleKey || !turnstileSecret) {
    return json({ error: 'O cadastro público não está configurado no servidor.' }, 500, origin)
  }

  let parsedBody: unknown
  try { parsedBody = await request.json() } catch { return json({ error: 'Dados inválidos.' }, 400, origin) }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return json({ error: 'Dados inválidos.' }, 400, origin)
  }
  const body = parsedBody as { evento_id?: unknown; nome?: unknown; telefone?: unknown; captcha_token?: unknown }
  const eventoId = typeof body.evento_id === 'string' ? body.evento_id.trim() : ''
  const nome = typeof body.nome === 'string' ? body.nome.trim() : ''
  const telefone = typeof body.telefone === 'string' ? body.telefone.trim() : ''
  const captchaToken = typeof body.captcha_token === 'string' ? body.captcha_token.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventoId)) {
    return json({ error: 'Evento inválido.' }, 400, origin)
  }
  if (nome.length < 2 || nome.length > 120) return json({ error: 'Informe um nome entre 2 e 120 caracteres.' }, 400, origin)
  if (!/^\+[1-9]\d{7,14}$/.test(telefone)) return json({ error: 'Informe um telefone internacional válido.' }, 400, origin)
  if (!captchaToken || captchaToken.length > 2048) return json({ error: 'Conclua a validação de segurança.' }, 400, origin)

  let originHost = ''
  try { originHost = new URL(origin).hostname } catch { return json({ error: 'Origem inválida.' }, 403, origin) }

  let verification: { success?: boolean; hostname?: string; action?: string; 'error-codes'?: string[] }
  try {
    const payload = new URLSearchParams({
      secret: turnstileSecret,
      response: captchaToken,
      idempotency_key: crypto.randomUUID(),
    })
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    })
    if (!response.ok) return json({ error: 'Não foi possível validar o captcha. Tente novamente.' }, 502, origin)
    verification = await response.json()
  } catch {
    return json({ error: 'Não foi possível validar o captcha. Tente novamente.' }, 502, origin)
  }

  if (!verification.success || verification.hostname !== originHost || verification.action !== 'public_queue_signup') {
    return json({ error: 'A validação de segurança expirou ou é inválida. Resolva o captcha novamente.' }, 400, origin)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await adminClient.rpc('join_event_queue_public', {
    p_evento_id: eventoId,
    p_nome: nome,
    p_telefone: telefone,
  })
  if (error) {
    const status = error.code === '23505' ? 409 : error.code === '22023' ? 400 : 500
    return json({ error: error.code === '23505' ? 'Já existe uma senha aguardando com este nome e telefone.' : error.message }, status, origin)
  }

  const entry = Array.isArray(data) ? data[0] : data
  return json({ ok: true, queueEntry: entry ? { id: entry.id, ordem_fila: entry.ordem_fila, status: entry.status, criado_em: entry.criado_em } : null }, 200, origin)
})
