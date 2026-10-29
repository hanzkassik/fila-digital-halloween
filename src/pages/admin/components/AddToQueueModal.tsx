import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { EventRow, Profile } from '../../../types'

type Props = {
  event: EventRow
  onClose: () => void
  onAdded: (name: string) => void
  onCreateNew: () => void
}

function searchKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

function getQueueErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
    if (code === 'PGRST202' || /admin_add_user_to_queue.*(not found|schema cache)/i.test(error.message)) {
      return 'A função de inclusão na fila não foi encontrada no banco. Aplique a migração 20261029050000_admin_add_queue_entry.sql no Supabase e tente novamente.'
    }
    if (code === '42501') return 'O Supabase recusou a operação. Confirme que sua conta está ativa e com papel de administrador.'
    return error.message
  }
  return 'Não foi possível adicionar à fila. Confira a conexão e tente novamente.'
}

export default function AddToQueueModal({ event, onClose, onAdded, onCreateNew }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.from('profiles')
      .select('id,nome,email,papel,status,telefone,cpf')
      .eq('papel', 'user')
      .eq('status', 'ativo')
      .order('nome')
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
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

  return <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <section className="modal add-queue-modal">
      <header><div><small className="eyebrow">EVENTO · {event.nome}</small><h2>Adicionar à fila</h2></div><button type="button" onClick={onClose}>×</button></header>
      <p className="modal-description">Escolha um usuário cadastrado ou crie um convite para alguém novo.</p>
      <label className="queue-search-label">Buscar usuário<input autoFocus type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, e-mail ou CPF" /></label>
      <div className="available-users">
        {loading ? <p className="queue-empty">Carregando usuários...</p> : available.length ? available.map((profile) =>
          <button type="button" key={profile.id} className={'available-user ' + (selectedId === profile.id ? 'chosen' : '')} onClick={() => setSelectedId(profile.id)}>
            <span className="available-avatar">{profile.nome[0]?.toUpperCase()}</span><span className="available-details"><b>{profile.nome}</b><small>{profile.email}</small></span><span className="available-radio">{selectedId === profile.id ? '●' : '○'}</span>
          </button>
        ) : <p className="queue-empty">{profiles.length ? 'Nenhum usuário disponível encontrado.' : 'Ainda não há usuários cadastrados disponíveis.'}</p>}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="queue-modal-actions"><button type="button" className="text-button" onClick={onCreateNew}>＋ Cadastrar e adicionar</button><div><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!selected || busy} onClick={() => void addSelected()}>{busy ? 'Adicionando...' : 'Adicionar à fila'}</button></div></div>
    </section>
  </div>
}

