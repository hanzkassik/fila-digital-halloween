import { useEffect, useMemo, useState } from 'react'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { supabase } from '../../../lib/supabase'
import type { EventRow, Profile } from '../../../types'
import PhoneNumberField from '../../../components/PhoneNumberField'

type Props = {
  event: EventRow
  onClose: () => void
  onAdded: (name: string) => void
  onCreateNew: () => void
}
type AddMode = 'manual' | 'registered'

const paymentMethods: Record<string, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito', transferencia: 'Transferência', outro: 'Outro',
}

function searchKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

function getQueueErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
    if (code === 'PGRST202' || /admin_add_(user_to_queue|public_queue_entry).*(not found|schema cache)/i.test(error.message)) {
      return 'A função de inclusão manual na fila não foi encontrada. Aplique a migration 20261030100000_admin_add_manual_queue_entry.sql no Supabase e tente novamente.'
    }
    if (code === '42501') return 'O Supabase recusou a operação. Confirme que sua conta está ativa e com papel de administrador.'
    if (code === '22023') return 'Confira o nome, telefone, pagamento e se o evento está ativo.'
    return error.message
  }
  return 'Não foi possível adicionar à fila. Confira a conexão e tente novamente.'
}

export default function AddToQueueModal({ event, onClose, onAdded, onCreateNew }: Props) {
  const [mode, setMode] = useState<AddMode>('manual')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState<string>()
  const [paid, setPaid] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [amount, setAmount] = useState('0')
  const [loading, setLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let active = true
    supabase.from('profiles')
      .select('id,nome,email,papel,status,telefone,cpf')
      .eq('papel', 'user')
      .eq('status', 'ativo')
      .order('nome')
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setProfilesError(queryError.message)
        else setProfiles((data ?? []) as Profile[])
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const available = useMemo(() => profiles.filter((profile) => {
    const haystack = searchKey(profile.nome + ' ' + profile.email + ' ' + (profile.cpf ?? ''))
    return haystack.includes(searchKey(search))
  }), [profiles, search])
  const selected = profiles.find((profile) => profile.id === selectedId)

  function handleManualFormKeyDown(keyboardEvent: React.KeyboardEvent<HTMLFormElement>) {
    if (keyboardEvent.key !== 'Enter' || keyboardEvent.nativeEvent.isComposing) return
    const target = keyboardEvent.target
    if (!(target instanceof HTMLElement)) return
    const steps = [
      'input[name="nome"]',
      '.PhoneInputInput',
      'input[name="pago"]',
      'select[name="forma_pagamento"]',
      'input[name="valor_pagamento"]',
    ]
    const currentIndex = steps.findIndex((selector) => target.matches(selector))
    if (currentIndex < 0) return
    keyboardEvent.preventDefault()
    if (target instanceof HTMLInputElement && !target.checkValidity()) {
      target.reportValidity()
      return
    }
    const nextSelector = steps[currentIndex + 1]
    if (nextSelector) keyboardEvent.currentTarget.querySelector<HTMLElement>(nextSelector)?.focus()
    else keyboardEvent.currentTarget.requestSubmit()
  }

  function handleManualFormSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLInputElement && activeElement.name === 'nome') {
      submitEvent.preventDefault()
      submitEvent.currentTarget.querySelector<HTMLInputElement>('.PhoneInputInput')?.focus()
      return
    }
    void addManual(submitEvent)
  }

  async function addManual(eventSubmit?: React.FormEvent<HTMLFormElement>) {
    eventSubmit?.preventDefault()
    const cleanName = name.trim()
    const numericAmount = Number(amount)
    if (!cleanName || cleanName.length < 2 || cleanName.length > 120) { setError('Informe um nome entre 2 e 120 caracteres.'); return }
    if (!phone || !isValidPhoneNumber(phone)) { setError('Informe um telefone válido.'); return }
    if (!Number.isFinite(numericAmount) || numericAmount < 0) { setError('Informe um valor de pagamento válido.'); return }
    if (!supabase) return

    setBusy(true); setError('')
    try {
      const { error: rpcError } = await supabase.rpc('admin_add_public_queue_entry', {
        p_evento_id: event.id,
        p_nome: cleanName,
        p_telefone: phone,
        p_pago: paid,
        p_forma_pagamento: paymentMethod || null,
        p_valor_pagamento: numericAmount,
      })
      if (rpcError) throw rpcError
      onAdded(cleanName)
    } catch (caught) {
      setError(getQueueErrorMessage(caught))
    } finally { setBusy(false) }
  }

  async function addSelected() {
    if (!supabase || !selected) return
    setBusy(true); setError('')
    try {
      const { error: rpcError } = await supabase.rpc('admin_add_user_to_queue', {
        p_evento_id: event.id,
        p_usuario_id: selected.id,
      })
      if (rpcError) throw rpcError
      onAdded(selected.nome)
    } catch (caught) {
      setError(getQueueErrorMessage(caught))
    } finally { setBusy(false) }
  }

  return <div className="scrim add-queue-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <section className="modal add-queue-modal" aria-labelledby="add-queue-title">
      <header><div><small className="eyebrow">EVENTO · {event.nome}</small><h2 id="add-queue-title">Adicionar à fila</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
      <p className="modal-description">Adicione uma pessoa sem conta ou escolha um usuário cadastrado.</p>
      <div className="queue-add-mode" role="tablist" aria-label="Tipo de cadastro">
        <button type="button" role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'active' : ''} onClick={() => { setMode('manual'); setError('') }}>Nome e telefone</button>
        <button type="button" role="tab" aria-selected={mode === 'registered'} className={mode === 'registered' ? 'active' : ''} onClick={() => { setMode('registered'); setError('') }}>Usuário cadastrado</button>
      </div>

      {mode === 'manual' ? <form className="queue-manual-form" onSubmit={handleManualFormSubmit} onKeyDown={handleManualFormKeyDown}>
        <label>Nome<input name="nome" required minLength={2} maxLength={120} autoComplete="name" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" /></label>
        <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /></label>
        <div className="queue-payment-fields">
          <label className="check"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Pagamento realizado</label>
          <label>Forma de pagamento<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="">Não selecionada</option>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Valor (R$)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
        </div>
        {error && <div className="error queue-add-error" role="alert">{error}</div>}
        <div className="queue-modal-actions"><button type="button" className="text-button" onClick={onCreateNew}>＋ Criar conta e adicionar</button><div><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Adicionando...' : 'Adicionar à fila'}</button></div></div>
      </form> : <>
        <label className="queue-search-label">Buscar usuário<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, e-mail ou CPF" /></label>
        <div className="available-users">
          {loading ? <p className="queue-empty">Carregando usuários...</p> : profilesError ? <p className="queue-empty" role="alert">Não foi possível carregar os usuários. {profilesError}</p> : available.length ? available.map((profile) =>
            <button type="button" key={profile.id} className={'available-user ' + (selectedId === profile.id ? 'chosen' : '')} onClick={() => setSelectedId(profile.id)}>
              <span className="available-avatar">{profile.nome[0]?.toUpperCase()}</span><span className="available-details"><b>{profile.nome}</b><small>{profile.email}</small></span><span className="available-radio">{selectedId === profile.id ? '●' : '○'}</span>
            </button>
          ) : <p className="queue-empty">{profiles.length ? 'Nenhum usuário disponível encontrado.' : 'Ainda não há usuários cadastrados disponíveis.'}</p>}
        </div>
        {error && <div className="error queue-add-error" role="alert">{error}</div>}
        <div className="queue-modal-actions"><button type="button" className="text-button" onClick={onCreateNew}>＋ Criar conta e adicionar</button><div><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!selected || busy || loading} onClick={() => void addSelected()}>{busy ? 'Adicionando...' : 'Adicionar à fila'}</button></div></div>
      </>}
    </section>
  </div>
}
