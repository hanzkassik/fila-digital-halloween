import { useEffect, useState, type FormEvent } from 'react'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from '../../../lib/supabase'
import { formatCpf } from '../../../lib/formatters'
import PhoneNumberField from '../../../components/PhoneNumberField'
import type { EventRow } from '../../../types'

type Props = { events: EventRow[]; initialEventId?: string; onClose: () => void; onCreated: (email: string, eventId: string | null) => void }
const draftKey = 'fila-admin-create-user-draft'
const openKey = 'fila-admin-create-user-open'
type Draft = { name: string; cpf: string; email: string; birthDate: string; phone?: string; eventId: string }

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey)
    return raw ? JSON.parse(raw) as Draft : null
  } catch { return null }
}

function clearDraft() {
  try { sessionStorage.removeItem(draftKey); sessionStorage.removeItem(openKey) } catch { /* Armazenamento indisponível. */ }
}

export default function AdminCreateUserModal({ events, initialEventId, onClose, onCreated }: Props) {
  const [name, setName] = useState(() => readDraft()?.name ?? '')
  const [cpf, setCpf] = useState(() => readDraft()?.cpf ?? '')
  const [email, setEmail] = useState(() => readDraft()?.email ?? '')
  const [birthDate, setBirthDate] = useState(() => readDraft()?.birthDate ?? '')
  const [phone, setPhone] = useState<string | undefined>(() => readDraft()?.phone)
  const [eventId, setEventId] = useState(() => readDraft()?.eventId ?? initialEventId ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ name, cpf, email, birthDate, phone, eventId } satisfies Draft))
      sessionStorage.setItem(openKey, '1')
    } catch { /* Se o armazenamento estiver indisponível, o formulário segue funcionando em memória. */ }
  }, [name, cpf, email, birthDate, phone, eventId])

  function dismiss() {
    clearDraft()
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    if (cpf && cpf.replace(/\D/g, '').length !== 11) { setError('Se informado, o CPF precisa ter 11 dígitos.'); return }
    if (birthDate && birthDate > new Date().toISOString().slice(0, 10)) { setError('Informe uma data de nascimento válida.'); return }
    if (!phone || !isValidPhoneNumber(phone)) { setError('Informe um telefone válido para o país escolhido.'); return }

    setBusy(true)
    try {
      const { error: inviteError } = await supabase.functions.invoke('admin-create-user', {
        body: { nome: name.trim(), cpf: cpf ? cpf.replace(/\D/g, '') : null, email: email.trim(), telefone: phone, data_nascimento: birthDate || null, evento_id: eventId || null },
      })
      if (inviteError instanceof FunctionsHttpError || inviteError instanceof FunctionsRelayError) {
        const response = inviteError.context as Response | undefined
        let detail = ''
        try {
          const body = await response?.clone().json() as { error?: string; message?: string } | undefined
          detail = body?.error || body?.message || ''
        } catch {
          try { detail = await response?.clone().text() ?? '' } catch { /* resposta sem corpo legível */ }
        }
        throw new Error(detail || inviteError.message)
      }
      if (inviteError instanceof FunctionsFetchError) {
        console.error('Falha de rede ao chamar admin-create-user:', inviteError.context)
        throw new Error('Não foi possível conectar à Edge Function. Confira se admin-create-user foi implantada no projeto Supabase configurado e se a URL e as regras de CORS estão corretas.')
      }
      if (inviteError) throw inviteError
      clearDraft()
      onCreated(email.trim(), eventId || null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar o convite.')
    } finally { setBusy(false) }
  }

  return <div className="scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss() }}>
    <section className="modal">
      <header><div><small className="eyebrow">NOVO ACESSO</small><h2>Criar usuário</h2></div><button type="button" onClick={dismiss}>×</button></header>
      <p className="modal-description">Enviaremos um convite para o e-mail. A conta será criada como usuário padrão{eventId ? ' e adicionada à fila do evento selecionado' : ''}.</p>
      <form onSubmit={submit}>
        <label>Nome<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" /></label>
        <label>CPF (opcional)<input inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" /></label>
        <label>Data de nascimento (opcional)<input type="date" max={new Date().toISOString().slice(0, 10)} autoComplete="bday" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
        <label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@email.com" /></label>
        {!initialEventId && <label>Adicionar à fila de um evento (opcional)<select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">Criar usuário sem adicionar à fila</option>{events.filter((event) => event.status === 'ativo').map((event) => <option key={event.id} value={event.id}>{event.nome}</option>)}</select></label>}
        <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /><small>Escolha o país; será salvo no padrão internacional.</small></label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={dismiss}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Enviando convite...' : 'Enviar convite'}</button></div>
      </form>
    </section>
  </div>
}

