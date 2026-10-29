import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { formatBirthDate, formatCpf, getAge } from '../../lib/formatters'
import PhoneNumberField from '../../components/PhoneNumberField'
import type { EventRow, Profile, QueueRow } from '../../types'

type HistoryEntry = QueueRow & { evento_id: string; evento: EventRow | null }
const roleLabels: Record<string, string> = { admin: 'Administrador', user: 'Usuário' }
const queueLabels: Record<string, string> = { 'na fila': 'Na fila', 'em atendimento': 'Em atendimento', atendido: 'Atendido', cancelado: 'Cancelado', inativo: 'Inativo' }

function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Não foi possível carregar os dados.'
}

async function getEdgeFunctionError(error: Error & { context?: unknown }) {
  if (error instanceof FunctionsFetchError) {
    console.error('Falha de rede ao chamar admin-update-user:', error.context)
    return 'Não foi possível conectar à Edge Function admin-update-user. Confirme se ela foi implantada no projeto Supabase configurado e se as regras de CORS permitem a origem atual.'
  }
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context instanceof Response ? error.context : null
    if (response) {
      try {
        const body = await response.clone().json() as { error?: string; message?: string }
        if (body.error || body.message) return body.error || body.message || error.message
      } catch {
        try {
          const text = await response.clone().text()
          if (text) return text
        } catch { /* use o texto padrão do SDK */ }
      }
    }
  }
  return error.message
}

type Props = { userId?: string; onUserSelect: (id: string) => void; onBack: () => void }

export default function UsersPage({ userId, onUserSelect, onBack }: Props) {
  const [users, setUsers] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Profile | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyError, setHistoryError] = useState('')
  const [draft, setDraft] = useState<Profile | null>(null)
  const [phone, setPhone] = useState<string | undefined>()
  const [editing, setEditing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.from('profiles').select('id,nome,email,papel,status,telefone,cpf,data_nascimento,criado_em').order('criado_em', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setUsers((data ?? []) as Profile[])
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => {
    const key = search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
    return users.filter((user) => (user.nome + ' ' + user.email + ' ' + (user.cpf ?? '') + ' ' + user.telefone)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(key))
  }, [users, search])

  async function openUser(user: Profile) {
    if (!supabase) return
    setSelected(user); setDraft({ ...user }); setPhone(user.telefone ?? undefined)
    setEditing(false); setError(''); setNotice(''); setHistory([]); setHistoryError(''); setHistoryLoading(true)
    const { data: entries, error: historyError } = await supabase.from('event_queue')
      .select('id,usuario_id,evento_id,ordem_fila,pago,forma_pagamento,valor_pagamento,status,criado_em')
      .eq('usuario_id', user.id).order('criado_em', { ascending: false })
    if (historyError) { setError(historyError.message); setHistoryError(historyError.message); setHistoryLoading(false); return }
    const rows = (entries ?? []) as (QueueRow & { evento_id: string })[]
    const eventIds = [...new Set(rows.map((row) => row.evento_id))]
    const { data: events, error: eventError } = eventIds.length
      ? await supabase.from('events').select('id,slug,nome,data,descricao,imagem_capa,banner,status').in('id', eventIds)
      : { data: [], error: null }
    if (eventError) { setError(eventError.message); setHistoryError(eventError.message) }
    const eventMap = new Map(((events ?? []) as EventRow[]).map((event) => [event.id, event]))
    setHistory(rows.map((row) => ({ ...row, evento: eventMap.get(row.evento_id) ?? null })))
    setHistoryLoading(false)
  }

  useEffect(() => {
    if (!userId) {
      if (selected) { setSelected(null); setDraft(null) }
      return
    }
    const user = users.find((item) => item.id === userId)
    if (user) {
      if (selected?.id !== user.id) void openUser(user)
    } else if (!loading) setError('Este usuário não foi encontrado.')
  // openUser is intentionally invoked when the route id resolves against loaded profiles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, users, loading, selected])

  async function saveUser(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !selected || !draft) return
    if (draft.cpf?.replace(/\D/g, '').length !== 11) { setError('Informe um CPF com 11 dígitos.'); return }
    if (!phone || !isValidPhoneNumber(phone)) { setError('Informe um telefone válido para o país escolhido.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const { error: updateError } = await supabase.functions.invoke('admin-update-user', {
        body: {
          user_id: selected.id,
          nome: draft.nome.trim(), cpf: draft.cpf.replace(/\D/g, ''), email: draft.email.trim().toLowerCase(),
          telefone: phone, data_nascimento: draft.data_nascimento || null, papel: draft.papel, status: draft.status,
        },
      })
      if (updateError) {
        throw new Error(await getEdgeFunctionError(updateError))
      }
      const updated: Profile = { ...draft, cpf: draft.cpf.replace(/\D/g, ''), telefone: phone }
      setSelected(updated); setDraft(updated); setUsers((all) => all.map((user) => user.id === updated.id ? updated : user))
      setEditing(false); setNotice('Cadastro atualizado com sucesso.')
    } catch (caught) { setError(messageOf(caught)) }
    finally { setSaving(false) }
  }

  const entriesByEvent = useMemo(() => {
    const groups = new Map<string, { event: EventRow | null; entries: HistoryEntry[] }>()
    history.forEach((entry) => {
      const key = entry.evento_id
      const group = groups.get(key) ?? { event: entry.evento, entries: [] }
      group.entries.push(entry); groups.set(key, group)
    })
    return [...groups.values()]
  }, [history])

  if (userId && selected && draft) return <section className="users-page">
    <button className="secondary user-back" onClick={onBack}>← Voltar aos usuários</button>
    <div className="user-detail-heading"><span className="user-detail-avatar">{selected.nome[0]?.toUpperCase() ?? '?'}</span><div><small className="eyebrow">CADASTRO DE USUÁRIO</small><h2>{selected.nome}</h2><p>{roleLabels[selected.papel] ?? selected.papel} · {selected.status === 'ativo' ? 'Ativo' : 'Inativo'}</p></div>
      {!editing && <button className="primary" onClick={() => { setDraft({ ...selected }); setPhone(selected.telefone ?? undefined); setEditing(true); setError(''); setNotice('') }}>✎ Editar usuário</button>}
    </div>
    {error && <div className="error user-alert">{error}</div>}{notice && <div className="notice user-alert">{notice}</div>}
    <div className="user-detail-grid">
      <article className="user-panel"><div className="user-panel-title"><h3>Dados cadastrais</h3>{editing && <span>Alterações só afetam este cadastro.</span>}</div>
        {editing ? <form className="user-edit-form" onSubmit={saveUser}>
          <label>Nome<input required maxLength={120} value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></label>
          <label>CPF<input required inputMode="numeric" maxLength={14} value={formatCpf(draft.cpf ?? '')} onChange={(e) => setDraft({ ...draft, cpf: formatCpf(e.target.value) })} /></label>
          <label>E-mail<input required type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
          <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /></label>
          <label>Data de nascimento<input type="date" value={draft.data_nascimento ?? ''} onChange={(e) => setDraft({ ...draft, data_nascimento: e.target.value || null })} /></label>
          <label>Papel<select value={draft.papel} onChange={(e) => setDraft({ ...draft, papel: e.target.value })}><option value="user">Usuário</option><option value="admin">Administrador</option></select></label>
          <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
          <div className="user-edit-actions"><button type="button" className="secondary" onClick={() => { setDraft({ ...selected }); setPhone(selected.telefone ?? undefined); setEditing(false); setError('') }}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button></div>
        </form> : <dl className="user-facts">
          <div><dt>E-mail</dt><dd>{selected.email}</dd></div><div><dt>CPF</dt><dd>{formatCpf(selected.cpf ?? '') || 'Não informado'}</dd></div>
          <div><dt>Telefone</dt><dd>{selected.telefone ?? 'Não informado'}</dd></div><div><dt>Nascimento</dt><dd>{formatBirthDate(selected.data_nascimento) ?? 'Não informado'}</dd></div>
          <div><dt>Idade</dt><dd>{getAge(selected.data_nascimento) === null ? 'Não informada' : `${getAge(selected.data_nascimento)} anos`}</dd></div>
          <div><dt>Papel</dt><dd>{roleLabels[selected.papel] ?? selected.papel}</dd></div><div><dt>Status</dt><dd>{selected.status === 'ativo' ? 'Ativo' : 'Inativo'}</dd></div>
          <div><dt>Cadastrado em</dt><dd>{selected.criado_em ? new Date(selected.criado_em).toLocaleString('pt-BR') : '—'}</dd></div>
        </dl>}
      </article>
      <article className="user-panel history-panel"><div className="user-panel-title"><div><h3>Histórico de filas</h3><span>{history.length} {history.length === 1 ? 'participação' : 'participações'}</span></div></div>
        {historyLoading ? <div className="history-skeleton-list" aria-label="Carregando histórico">{Array.from({ length: 3 }, (_, index) => <div className="history-skeleton-card" key={index}><span className="loading-skeleton skeleton-line wide"/><span className="loading-skeleton skeleton-line"/><span className="loading-skeleton skeleton-line short"/></div>)}</div> : historyError ? <div className="user-history-empty">⚠️<p>Não foi possível carregar o histórico deste usuário.</p></div> : !history.length ? <div className="user-history-empty">🎃<p>Este usuário ainda não participou de nenhuma fila.</p></div> : <div className="event-history-list">{entriesByEvent.map(({ event, entries }) => <section className="event-history" key={entries[0].evento_id}>
          <header><div><b>{event?.nome ?? 'Evento removido'}</b><small>{event?.data ? new Date(event.data).toLocaleDateString('pt-BR') : ''}</small></div><span>{entries.length} {entries.length === 1 ? 'entrada' : 'entradas'}</span></header>
          {entries.map((entry) => <div className="history-entry" key={entry.id}><b>Senha {String(entry.ordem_fila).padStart(2, '0')}</b><span className={'pill state-' + entry.status.replaceAll(' ', '-')}>{queueLabels[entry.status] ?? entry.status}</span><small>{new Date(entry.criado_em).toLocaleString('pt-BR')}</small>{entry.pago && <em>Pago · R$ {Number(entry.valor_pagamento).toFixed(2).replace('.', ',')}</em>}</div>)}
        </section>)}</div>}
      </article>
    </div>
  </section>

  return <section className="users-page">
    <div className="users-section-head"><div><h2>Usuários cadastrados <span>{users.length}</span></h2><p>Consulte perfis e o histórico de participação por evento.</p></div><label className="users-search">Buscar usuário<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, e-mail, CPF ou telefone" /></label></div>
    {error && <div className="error user-alert">{error}</div>}
    {userId && selected?.id !== userId && loading ? <div className="user-detail-loading" aria-label="Carregando usuário"><span className="loading-skeleton skeleton-line wide"/><span className="loading-skeleton skeleton-line"/><div className="user-detail-grid"><span className="loading-skeleton user-panel-loading"/><span className="loading-skeleton user-panel-loading"/></div></div> : userId && selected?.id !== userId ? <div className="empty"><span>🕸️</span><h3>Usuário não encontrado</h3><button className="secondary" onClick={onBack}>Voltar aos usuários</button></div> : loading ? <div className="registered-users users-list-skeleton" aria-label="Carregando usuários">{Array.from({ length: 6 }, (_, index) => <div className="registered-user-skeleton" key={index}><span className="loading-skeleton skeleton-avatar"/><span className="skeleton-person"><i className="loading-skeleton skeleton-line wide"/><i className="loading-skeleton skeleton-line"/></span><span className="loading-skeleton skeleton-pill"/></div>)}</div> : filtered.length ? <div className="registered-users">{filtered.map((user) => <button className="registered-user" key={user.id} onClick={() => onUserSelect(user.id)}>
      <span className="registered-avatar">{user.nome[0]?.toUpperCase() ?? '?'}</span><span className="registered-user-main"><b>{user.nome}</b><small>{user.email}</small><small className="user-birth-summary">Nascimento: {formatBirthDate(user.data_nascimento) ?? 'Não informado'} · Idade: {getAge(user.data_nascimento) === null ? '—' : `${getAge(user.data_nascimento)} anos`}</small></span><span className="registered-user-role">{roleLabels[user.papel] ?? user.papel}</span><span className={'user-status ' + (user.status === 'ativo' ? 'is-active' : '')}>{user.status === 'ativo' ? 'Ativo' : 'Inativo'}</span><span className="registered-chevron">›</span>
    </button>)}</div> : <div className="empty"><span>🕸️</span><h3>Nenhum usuário encontrado</h3><p>Tente outra busca.</p></div>}
  </section>
}
