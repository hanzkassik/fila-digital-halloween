import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigins = [
  Deno.env.get('APP_URL')?.replace(/\/$/, ''),
  'http://localhost:5173', 'http://localhost:5174',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
].filter((origin): origin is string => Boolean(origin))

function headers(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  if (!allowedOrigins.includes(origin)) return new Response('Origin not allowed', { status: 403 })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(origin) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return json({ error: 'Authentication required' }, 401, origin)
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json({ error: 'Server authentication is not configured' }, 500, origin)

  const auth = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + token } } })
  const { data: authData, error: authError } = await auth.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401, origin)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await admin.from('profiles').select('papel,status').eq('id', authData.user.id).maybeSingle()
  if (actorError || actor?.papel !== 'admin' || actor.status !== 'ativo') return json({ error: 'Administrator access required' }, 403, origin)

  let body: { user_id?: string; nome?: string; cpf?: string; email?: string; telefone?: string; data_nascimento?: string | null; papel?: string; status?: string }
  try { body = await request.json() } catch { return json({ error: 'Invalid request body' }, 400, origin) }
  const userId = body.user_id?.trim() ?? ''
  const nome = body.nome?.trim() ?? ''
  const cpf = body.cpf?.replace(/\D/g, '') ?? ''
  const email = body.email?.trim().toLowerCase() ?? ''
  const telefone = body.telefone?.trim() ?? ''
  const nascimento = body.data_nascimento || null
  const papel = body.papel
  const status = body.status

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return json({ error: 'Usuário inválido.' }, 400, origin)
  if (nome.length < 2 || nome.length > 120) return json({ error: 'Informe um nome válido.' }, 400, origin)
  if (!/^\d{11}$/.test(cpf)) return json({ error: 'Informe um CPF com 11 dígitos.' }, 400, origin)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Informe um e-mail válido.' }, 400, origin)
  if (!/^\+[1-9]\d{7,14}$/.test(telefone)) return json({ error: 'Informe um telefone internacional válido.' }, 400, origin)
  if (papel !== 'admin' && papel !== 'user') return json({ error: 'Papel de usuário inválido.' }, 400, origin)
  if (status !== 'ativo' && status !== 'inativo') return json({ error: 'Status inválido.' }, 400, origin)
  if (nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) return json({ error: 'Data de nascimento inválida.' }, 400, origin)

  const { data: target, error: targetError } = await admin.from('profiles').select('id,email').eq('id', userId).maybeSingle()
  if (targetError || !target) return json({ error: 'Usuário não encontrado.' }, 404, origin)
  const { data: emailDuplicate, error: emailDuplicateError } = await admin.from('profiles').select('id').neq('id', userId).eq('email', email).limit(1).maybeSingle()
  if (emailDuplicateError) return json({ error: 'Não foi possível validar o e-mail: ' + emailDuplicateError.message }, 400, origin)
  const { data: cpfDuplicate, error: cpfDuplicateError } = await admin.from('profiles').select('id').neq('id', userId).eq('cpf', cpf).limit(1).maybeSingle()
  if (cpfDuplicateError) return json({ error: 'Não foi possível validar o CPF: ' + cpfDuplicateError.message }, 400, origin)
  if (emailDuplicate || cpfDuplicate) return json({ error: 'Este e-mail ou CPF já está sendo usado por outro cadastro.' }, 409, origin)

  if (target.email.toLowerCase() !== email) {
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
      user_metadata: { nome, cpf, telefone },
    })
    if (authUpdateError) return json({ error: authUpdateError.message }, 400, origin)
  } else {
    const { error: metadataError } = await admin.auth.admin.updateUserById(userId, { user_metadata: { nome, cpf, telefone } })
    if (metadataError) return json({ error: metadataError.message }, 400, origin)
  }

  const { error: profileError } = await admin.from('profiles').update({
    nome, cpf, email, telefone, data_nascimento: nascimento, papel, status,
  }).eq('id', userId)
  if (profileError) return json({ error: profileError.message }, 400, origin)
  return json({ ok: true }, 200, origin)
})
