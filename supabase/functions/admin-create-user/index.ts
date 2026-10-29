import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigins = [
  Deno.env.get('APP_URL')?.replace(/\/$/, ''),
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
].filter((origin): origin is string => Boolean(origin))

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('origin') ?? ''
  if (!allowedOrigins.includes(requestOrigin)) {
    return new Response('Origin not allowed', { status: 403 })
  }
  const headers = corsHeaders(requestOrigin)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, requestOrigin)

  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return json({ error: 'Authentication required' }, 401, requestOrigin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server authentication is not configured' }, 500, requestOrigin)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  })
  const { data: userData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !userData.user) return json({ error: 'Invalid session' }, 401, requestOrigin)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: actor, error: actorError } = await adminClient
    .from('profiles')
    .select('papel,status')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (actorError || actor?.papel !== 'admin' || actor.status !== 'ativo') {
    return json({ error: 'Administrator access required' }, 403, requestOrigin)
  }

  let payload: { nome?: string; cpf?: string | null; email?: string; telefone?: string; data_nascimento?: string | null; evento_id?: string | null }
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400, requestOrigin)
  }

  const nome = payload.nome?.trim() ?? ''
  const cpf = payload.cpf?.replace(/\D/g, '') ?? ''
  const email = payload.email?.trim().toLowerCase() ?? ''
  const telefone = payload.telefone?.trim() ?? ''
  const dataNascimento = payload.data_nascimento?.trim() ?? ''
  const eventoId = payload.evento_id?.trim() || null
  if (nome.length < 2 || nome.length > 120) return json({ error: 'Informe um nome válido.' }, 400, requestOrigin)
  if (cpf && !/^\d{11}$/.test(cpf)) return json({ error: 'Se informado, o CPF precisa ter 11 dígitos.' }, 400, requestOrigin)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Informe um e-mail válido.' }, 400, requestOrigin)
  if (!/^\+[1-9]\d{7,14}$/.test(telefone)) return json({ error: 'Informe um telefone internacional válido.' }, 400, requestOrigin)
  const parsedBirthDate = dataNascimento && /^\d{4}-\d{2}-\d{2}$/.test(dataNascimento) ? new Date(dataNascimento + 'T00:00:00.000Z') : null
  if (dataNascimento && (!parsedBirthDate || Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate.toISOString().slice(0, 10) !== dataNascimento || dataNascimento > new Date().toISOString().slice(0, 10))) {
    return json({ error: 'Informe uma data de nascimento válida.' }, 400, requestOrigin)
  }

  if (eventoId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventoId)) {
      return json({ error: 'Evento inválido.' }, 400, requestOrigin)
    }
    const { data: selectedEvent, error: eventError } = await adminClient
      .from('events').select('id').eq('id', eventoId).eq('status', 'ativo').maybeSingle()
    if (eventError || !selectedEvent) return json({ error: 'Evento não encontrado ou inativo.' }, 400, requestOrigin)
  }

  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '') || requestOrigin
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { nome, cpf: cpf || null, telefone, data_nascimento: dataNascimento || null },
    redirectTo: appUrl,
  })
  if (inviteError) return json({ error: inviteError.message }, 400, requestOrigin)

  let queueEntry = null
  if (eventoId && invited.user) {
    const { data: entry, error: queueError } = await adminClient.rpc('admin_add_user_to_queue', {
      p_evento_id: eventoId,
      p_usuario_id: invited.user.id,
    })
    if (queueError) {
      await adminClient.auth.admin.deleteUser(invited.user.id)
      return json({ error: 'O convite não foi concluído porque não foi possível adicionar o usuário à fila: ' + queueError.message }, 400, requestOrigin)
    }
    queueEntry = entry
  }

  return json({ ok: true, userId: invited.user?.id, queueEntry }, 200, requestOrigin)
})

