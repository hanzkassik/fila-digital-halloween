import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { EventRow, Profile, QueueRow } from '../../types'
import ProfilePage from '../profile/ProfilePage'
import AdminCreateUserModal from './components/AdminCreateUserModal'
import AddToQueueModal from './components/AddToQueueModal'
import UsersPage from './UsersPage'
import { formatBirthDate, getAge } from '../../lib/formatters'
import { appAsset } from '../../lib/paths'

type Props = { profile: Profile; themeToggle: ReactNode; pathname: string; navigate: (to: string, replace?: boolean) => void; onLogout: () => void; onProfileUpdated: (profile: Profile) => void }
const statuses: Record<string, string> = { 'na fila': 'Na fila', 'em atendimento': 'Em atendimento', atendido: 'Atendido', cancelado: 'Cancelado', inativo: 'Inativo' }
type QueueSort = 'order-asc' | 'order-desc' | 'status' | 'name'
const queueStatusOrder: Record<string, number> = { 'em atendimento': 0, 'na fila': 1, atendido: 2, cancelado: 3, inativo: 4 }
const methods: Record<string, string> = { pix: 'Pix', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', transferencia: 'Transferência', outro: 'Outro' }
const slugify = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
const eventImagesBucket = 'fila-digital-halloween'
const createUserDraftOpenKey = 'fila-admin-create-user-open'
function hasRestorableCreateUserModal() {
  try { return sessionStorage.getItem(createUserDraftOpenKey) === '1' } catch { return false }
}
const isMissingFaviconColumn = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const details = error as { code?: string; message?: string }
  const message = details.message?.toLowerCase() ?? ''
  return message.includes('favicon') && (details.code === 'PGRST204' || details.code === '42703' || message.includes('column') || message.includes('schema cache'))
}
const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const message = typeof details.message === 'string' ? details.message : ''
    const extra = [details.details, details.hint].filter((item): item is string => typeof item === 'string' && item.length > 0)
    const code = typeof details.code === 'string' ? ` [${details.code}]` : ''
    if (message) return `${message}${code}${extra.length ? ` — ${extra.join(' · ')}` : ''}`
  }
  return fallback
}

type EventImageFieldProps = { label: string; currentUrl?: string | null; file: File | null; disabled: boolean; helperText?: string; onChange: (file: File | null) => void }

function EventImageField({ label, currentUrl, file, disabled, helperText, onChange }: EventImageFieldProps) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    if (selected && !selected.type.startsWith('image/')) {
      event.target.value = ''
      onChange(null)
      return
    }
    onChange(selected)
  }

  return <label className={'event-image-field ' + (label === 'Favicon do evento' ? 'favicon-upload' : '')}>{label}
    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={chooseFile} disabled={disabled} />
    <small>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : currentUrl ? 'Selecione outra imagem para substituir a atual.' : helperText ?? 'Anexe uma imagem (JPG, PNG, WEBP, GIF ou AVIF; até 10 MB).'}</small>
    {(preview || currentUrl) && <img className="event-image-preview" src={preview || currentUrl || ''} alt={`Prévia: ${label.toLowerCase()}`} />}
  </label>
}

export default function AdminDashboardPage({ profile, themeToggle, pathname, navigate, onLogout, onProfileUpdated }: Props) {
  const routePath = pathname.replace(/\/+$/, '') || '/'
  const userMatch = /^\/users\/([^/]+)$/.exec(routePath)
  const eventMatch = /^\/events\/([^/]+)$/.exec(routePath)
  const userId = userMatch ? decodeURIComponent(userMatch[1]) : undefined
  const routeEventId = eventMatch ? decodeURIComponent(eventMatch[1]) : undefined
  const activeView: 'dashboard' | 'users' | 'profile' = routePath === '/profile' ? 'profile' : routePath === '/users' || userId ? 'users' : 'dashboard'
  const [events, setEvents] = useState<EventRow[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [queueSort, setQueueSort] = useState<QueueSort>('order-asc')
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<QueueRow | null>(null)
  const [calledPerson, setCalledPerson] = useState<QueueRow | null>(null)
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [createUserOpen, setCreateUserOpen] = useState(hasRestorableCreateUserModal)
  const [addQueueOpen, setAddQueueOpen] = useState(false)
  const [createUserEventId, setCreateUserEventId] = useState<string | undefined>()
  const [eventForm, setEventForm] = useState<Partial<EventRow>>({ status: 'ativo' })
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const queueRequestId = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function openCreateUser(eventId?: string) {
    try { sessionStorage.setItem(createUserDraftOpenKey, '1') } catch { /* Modal segue funcionando sem persistência. */ }
    setCreateUserEventId(eventId)
    setCreateUserOpen(true)
  }

  function closeCreateUser() {
    try { sessionStorage.removeItem(createUserDraftOpenKey); sessionStorage.removeItem('fila-admin-create-user-draft') } catch { /* Modal segue funcionando sem persistência. */ }
    setCreateUserOpen(false)
    setCreateUserEventId(undefined)
  }

  function navigateFromMobileMenu(to: string) {
    setMobileMenuOpen(false)
    navigate(to)
  }

  useEffect(() => {
    if (!mobileMenuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenuOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  useEffect(() => { setMobileMenuOpen(false) }, [routePath])

  const selectedEvent = events.find((event) => event.id === routeEventId) ?? null

  useEffect(() => {
    const faviconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!faviconLink) return
    faviconLink.href = selectedEvent?.favicon || `${appAsset('favicon.svg')}?v=3`
    return () => { faviconLink.href = `${appAsset('favicon.svg')}?v=3` }
  }, [selectedEvent?.favicon])

  useEffect(() => {
    if (routePath === '/') navigate('/events', true)
    else if (!['/events', '/users', '/profile'].includes(routePath) && !userId && !routeEventId) navigate('/events', true)
  }, [routePath, userId, routeEventId, navigate])

  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    if (!supabase) { setEventsLoading(false); return }
    const { data, error: queryError } = await supabase.from('events').select('*').order('data')
    if (queryError) setError(queryError.message)
    else setEvents((data ?? []) as EventRow[])
    setEventsLoading(false)
  }, [])
  useEffect(() => { void loadEvents() }, [loadEvents])

  const loadQueue = useCallback(async (event: EventRow) => {
    const requestId = ++queueRequestId.current
    setQueueLoading(true)
    setError('')
    try {
      if (!supabase) return [] as QueueRow[]
      const { data, error: queryError } = await supabase.rpc('listar_fila_evento', { p_evento_id: event.id })
      if (queryError) throw queryError
      const rows = (data ?? []) as QueueRow[]
      const ids = [...new Set(rows.map((row) => row.usuario_id).filter((id): id is string => Boolean(id)))]
      const result = ids.length
        ? await supabase.from('profiles').select('id,nome,email,papel,status,telefone,cpf,data_nascimento').in('id', ids)
        : { data: [], error: null }
      if (result.error) throw result.error
      const people = (result.data ?? []) as Profile[]
      const populated = rows.map((row) => ({ ...row, profile: row.usuario_id ? people.find((person) => person.id === row.usuario_id) : undefined }))
      if (requestId === queueRequestId.current) {
        setQueue(populated)
        const loadedIds = new Set(populated.map((row) => row.id))
        setSelectedQueueIds((current) => current.filter((id) => loadedIds.has(id)))
      }
      return populated
    } catch (caught) {
      if (requestId === queueRequestId.current) {
        setQueue([])
        setError(errorMessage(caught, 'Não foi possível carregar a fila deste evento.'))
      }
      return [] as QueueRow[]
    } finally {
      if (requestId === queueRequestId.current) setQueueLoading(false)
    }
  }, [])
  useEffect(() => { if (selectedEvent) void loadQueue(selectedEvent) }, [selectedEvent, loadQueue])

  const visibleEvents = useMemo(() => events.filter((event) => showInactive || event.status === 'ativo'), [events, showInactive])
  const currentServing = queue.find((item) => item.status === 'em atendimento')
  const waitingCount = queue.filter((item) => item.status === 'na fila').length
  const sortedQueue = useMemo(() => [...queue].sort((a, b) => {
    if (queueSort === 'order-desc') return b.ordem_fila - a.ordem_fila
    if (queueSort === 'status') return (queueStatusOrder[a.status] ?? 99) - (queueStatusOrder[b.status] ?? 99) || a.ordem_fila - b.ordem_fila
    if (queueSort === 'name') return (a.profile?.nome ?? a.nome ?? '').localeCompare(b.profile?.nome ?? b.nome ?? '', 'pt-BR', { sensitivity: 'base' }) || a.ordem_fila - b.ordem_fila
    return a.ordem_fila - b.ordem_fila
  }), [queue, queueSort])

  async function saveEvent(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError('')
    const uploadedPaths: string[] = []
    let eventId = eventForm.id
    let insertedEvent = false
    try {
      const basePayload = {
        slug: eventForm.slug?.trim() || slugify(eventForm.nome ?? ''),
        nome: eventForm.nome?.trim(),
        data: eventForm.data,
        descricao: eventForm.descricao || null,
        status: eventForm.status ?? 'ativo',
      }
      if (!eventId) {
        let { data, error: insertError } = await supabase.from('events').insert({ ...basePayload, imagem_capa: null, banner: null, favicon: null }).select('id').single()
        if (insertError && isMissingFaviconColumn(insertError) && !faviconFile) {
          const retry = await supabase.from('events').insert({ ...basePayload, imagem_capa: null, banner: null }).select('id').single()
          data = retry.data
          insertError = retry.error
        } else if (insertError && isMissingFaviconColumn(insertError) && faviconFile) {
          throw new Error('Aplique a migration do favicon antes de enviar um favicon para o evento.')
        }
        if (insertError) throw insertError
        if (!data) throw new Error('O evento foi inserido, mas não foi possível obter o ID para salvar as imagens.')
        eventId = data.id
        insertedEvent = true
      }

      const uploadImage = async (file: File, kind: 'covers' | 'banners' | 'favicons') => {
        if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem válido.')
        if (file.size > 10 * 1024 * 1024) throw new Error('Cada imagem pode ter no máximo 10 MB.')
        const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
        const extension = extensions[file.type]
        if (!extension) throw new Error('Formato não aceito. Use JPG, PNG, WEBP, GIF ou AVIF.')
        const path = `events/${eventId}/${kind}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase!.storage.from(eventImagesBucket).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
        if (uploadError) throw new Error(`Falha ao enviar ${kind === 'covers' ? 'a imagem de capa' : kind === 'banners' ? 'o banner' : 'o favicon'}: ${errorMessage(uploadError, 'Erro desconhecido no Storage.')}`)
        uploadedPaths.push(path)
        return supabase!.storage.from(eventImagesBucket).getPublicUrl(path).data.publicUrl
      }

      const coverUrl = coverFile ? await uploadImage(coverFile, 'covers') : eventForm.imagem_capa || null
      const bannerUrl = bannerFile ? await uploadImage(bannerFile, 'banners') : eventForm.banner || null
      const faviconUrl = faviconFile ? await uploadImage(faviconFile, 'favicons') : eventForm.favicon || null
      const payload = {
        ...basePayload,
        imagem_capa: coverUrl,
        banner: bannerUrl,
        favicon: faviconUrl,
      }
      if (!insertedEvent || coverFile || bannerFile || faviconFile) {
        let { error: updateError } = await supabase.from('events').update(payload).eq('id', eventId)
        if (updateError && isMissingFaviconColumn(updateError) && !faviconFile) {
          const { favicon: _favicon, ...payloadWithoutFavicon } = payload
          const retry = await supabase.from('events').update(payloadWithoutFavicon).eq('id', eventId)
          updateError = retry.error
          if (!updateError) setMessage('Evento atualizado. Aplique a migration do favicon para habilitar esse recurso.')
        } else if (updateError && isMissingFaviconColumn(updateError) && faviconFile) {
          throw new Error('Aplique a migration do favicon antes de enviar um favicon para o evento.')
        }
        if (updateError) throw updateError
      }
      setEventModalOpen(false); setEventForm({ status: 'ativo' }); setCoverFile(null); setBannerFile(null); setFaviconFile(null); await loadEvents()
    } catch (caught) {
      if (uploadedPaths.length) {
        try { await supabase.storage.from(eventImagesBucket).remove(uploadedPaths) } catch { /* Keep the original save error. */ }
      }
      if (insertedEvent && eventId) {
        try { await supabase.from('events').delete().eq('id', eventId) } catch { /* Keep the original save error. */ }
      }
      setError(errorMessage(caught, 'Não foi possível salvar o evento.'))
    }
    finally { setBusy(false) }
  }

  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedPerson || !selectedEvent) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const { error: updateError } = await supabase.rpc('admin_update_queue_entry', {
        p_queue_id: selectedPerson.id,
        p_status: String(form.get('status')),
        p_pago: form.get('pago') === 'on',
        p_forma_pagamento: String(form.get('forma_pagamento') || '') || null,
        p_valor_pagamento: Number(form.get('valor_pagamento') || 0),
      })
      if (updateError) throw updateError
      setSelectedPerson(null); await loadQueue(selectedEvent)
    } catch (caught) { setError(errorMessage(caught, 'Não foi possível atualizar a fila.')) }
    finally { setBusy(false) }
  }

  async function callNext() {
    if (!supabase || !selectedEvent) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error: rpcError } = await supabase.rpc('chamar_proximo_da_fila', { p_evento_id: selectedEvent.id })
      if (rpcError) throw rpcError
      const refreshed = await loadQueue(selectedEvent)
      const called = (Array.isArray(data) ? data[0] : data) as QueueRow | null
      if (called) {
        const row = refreshed.find((item) => item.id === called.id) ?? called
        if (row.profile) setCalledPerson(row)
        else if (called.usuario_id) {
          const { data: person } = await supabase.from('profiles').select('id,nome,email,papel,status,telefone,cpf,data_nascimento').eq('id', called.usuario_id).maybeSingle()
          setCalledPerson({ ...row, profile: (person as Profile | null) ?? undefined })
        } else setCalledPerson(row)
        setMessage('Senha ' + String(called.ordem_fila).padStart(2, '0') + ' chamada.')
      } else {
        setMessage('Não há pessoas aguardando na fila.')
      }
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string'
        ? caught.message
        : 'Não foi possível chamar a próxima pessoa.')
    }
    finally { setBusy(false) }
  }

  async function deleteSelectedQueueEntries() {
    if (!supabase || !selectedEvent || selectedQueueIds.length === 0) return
    const ids = [...selectedQueueIds]
    if (!window.confirm(`Excluir ${ids.length} ${ids.length === 1 ? 'item' : 'itens'} selecionado${ids.length === 1 ? '' : 's'} da fila? Esta ação não pode ser desfeita.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error: deleteError } = await supabase.rpc('admin_delete_queue_entries', {
        p_evento_id: selectedEvent.id,
        p_queue_ids: ids,
      })
      if (deleteError) throw deleteError
      const deleted = (data ?? []) as { deleted_id: string; deleted_order: number }[]
      setSelectedQueueIds([])
      await loadQueue(selectedEvent)
      setMessage(deleted.length === ids.length
        ? `${deleted.length} ${deleted.length === 1 ? 'item excluído' : 'itens excluídos'} em ordem decrescente da fila.`
        : `${deleted.length} de ${ids.length} itens foram excluídos; os demais não estavam mais nesta fila.`)
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível excluir os itens selecionados.'))
    } finally { setBusy(false) }
  }

  return <main className="dashboard">
    {mobileMenuOpen && <button type="button" className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />}
    <aside className={'sidebar' + (mobileMenuOpen ? ' is-open' : '')}>
      <a className="brand" href="/events" onClick={(event) => { event.preventDefault(); navigateFromMobileMenu('/events') }}>🎃 fila<span>do</span><br /> halloween</a>
      <small className="side-label">MENU PRINCIPAL</small>
      <button className={'nav-link ' + (activeView === 'dashboard' && !routeEventId ? 'active' : '')} onClick={() => navigateFromMobileMenu('/events')}>▦　Eventos</button>
      <button className={'nav-link ' + (activeView === 'users' ? 'active' : '')} onClick={() => navigateFromMobileMenu('/users')}>♙　Usuários</button>
      {selectedEvent && <button className="nav-link active" onClick={() => setMobileMenuOpen(false)}>☷　Fila do evento</button>}
      <button className={'nav-link ' + (activeView === 'profile' ? 'active' : '')} onClick={() => navigateFromMobileMenu('/profile')}>♙　Meu perfil</button>
      <div className="side-bottom">
        <div className="user-block"><b>{profile.nome[0]?.toUpperCase()}</b><span><strong>{profile.nome}</strong><small>Administrador</small></span></div>
        {themeToggle}<button onClick={() => { setMobileMenuOpen(false); onLogout() }}>↪ Sair da conta</button>
      </div>
    </aside>
    <section className="main-panel">
      <header className="mobile-top"><button type="button" className="mobile-menu-toggle" aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><span aria-hidden="true">{mobileMenuOpen ? '×' : '☰'}</span><small>{mobileMenuOpen ? 'Fechar' : 'Menu'}</small></button><button className="brand" onClick={() => navigateFromMobileMenu('/events')}>🎃 fila<span>do</span>halloween</button>{themeToggle}</header>
      <div className="page-title">
        <div><small className="eyebrow">PAINEL ADMINISTRATIVO</small><h1>{activeView === 'profile' ? 'Meu perfil' : activeView === 'users' ? userId ? 'Detalhes do usuário' : 'Usuários cadastrados' : selectedEvent?.nome ?? (routeEventId ? eventsLoading ? 'Carregando evento...' : 'Evento não encontrado' : 'Boa noite, ' + profile.nome.split(' ')[0])}</h1><p>{activeView === 'profile' ? 'Gerencie seus dados pessoais e de acesso.' : activeView === 'users' ? 'Consulte cadastros e participações por evento.' : selectedEvent ? 'Organize a fila deste evento.' : routeEventId ? 'Verifique o link ou volte para a lista de eventos.' : 'Gerencie seus eventos e acompanhe as filas.'}</p></div>
        {activeView === 'profile' ? <button className="secondary" onClick={() => navigate('/events')}>← Voltar ao painel</button> : activeView === 'users' ? userId ? <button className="secondary" onClick={() => navigate('/users')}>← Usuários</button> : <button className="secondary create-user-button" onClick={() => openCreateUser()}>＋ Criar usuário</button> : <div className="page-actions"><button className="secondary create-user-button" onClick={() => openCreateUser(routeEventId)}>＋ Criar usuário</button>{selectedEvent || routeEventId ? <button className="secondary" onClick={() => navigate('/events')}>← Eventos</button> : <button className="primary" onClick={() => { setEventForm({ status: 'ativo' }); setCoverFile(null); setBannerFile(null); setFaviconFile(null); setEventModalOpen(true) }}>＋ Criar evento</button>}</div>}
      </div>
      {error && <div className="error alert">{error}<button onClick={() => setError('')}>×</button></div>}
      {message && <div className="notice alert">{message}<button onClick={() => setMessage('')}>×</button></div>}

      {activeView === 'profile' ? <ProfilePage profile={profile} onProfileUpdated={onProfileUpdated} onLogout={onLogout} /> : activeView === 'users' ? <UsersPage userId={userId} onUserSelect={(id) => navigate('/users/' + encodeURIComponent(id))} onBack={() => navigate('/users')} /> : !selectedEvent && routeEventId ? eventsLoading ? <div className="empty"><span>🎃</span><p>Carregando evento...</p></div> : <div className="empty"><span>🕸️</span><h3>Evento não encontrado</h3><button className="secondary" onClick={() => navigate('/events')}>Voltar para eventos</button></div> : !selectedEvent ? <>
        <div className="stats">
          <article><span>✦</span><small>Eventos ativos</small><b>{events.filter((event) => event.status === 'ativo').length}</b></article>
          <article><span>☷</span><small>Eventos no total</small><b>{events.length}</b></article>
        </div>
        <div className="section-head"><div><h2>Seus eventos</h2><p>Selecione um evento para abrir a fila.</p></div><label className="inactive-toggle"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inativos</label></div>
        {visibleEvents.length ? <div className="event-grid">{visibleEvents.map((event) =>
          <button className="event-card" key={event.id} onClick={() => { setMobileMenuOpen(false); setQueue([]); setQueueLoading(true); setError(''); navigate('/events/' + encodeURIComponent(event.id)); setMessage('') }}>
            <div className="cover" style={event.imagem_capa ? { backgroundImage: 'linear-gradient(180deg, transparent, #17131de8), url(' + event.imagem_capa + ')' } : undefined}><span>● {event.status === 'ativo' ? 'Ativo' : 'Inativo'}</span><b>🎃</b></div>
            <div className="event-info"><small>{new Date(event.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</small><h3>{event.nome}</h3><p>{event.descricao || 'Um evento especial está esperando por você.'}</p><div>/{event.slug}<span>↗</span></div></div>
          </button>
        )}</div> : eventsLoading ? <div className="event-grid event-grid-skeleton" aria-label="Carregando eventos">{Array.from({ length: 3 }, (_, index) => <div className="event-card-skeleton" key={index}><span className="loading-skeleton skeleton-cover"/><span className="loading-skeleton skeleton-line wide"/><span className="loading-skeleton skeleton-line"/><span className="loading-skeleton skeleton-line short"/></div>)}</div> : <div className="empty"><span>🕸️</span><h3>Nenhum evento por aqui</h3><p>Crie seu primeiro evento para organizar a fila.</p></div>}
      </> : <>
        <div className="queue-summary">
          <div className="serving"><small className="eyebrow">AGORA EM ATENDIMENTO</small><strong>{queueLoading ? '…' : currentServing ? String(currentServing.ordem_fila).padStart(2, '0') : '—'}</strong><span>{queueLoading ? 'Carregando fila…' : currentServing?.profile?.nome ?? currentServing?.nome ?? 'Nenhuma chamada'}</span><i>🎃</i></div>
          <div className="waiting-stat"><small>Aguardando</small><b>{queueLoading ? '…' : waitingCount}</b><span>pessoas</span></div>
          <button className="call-next" disabled={busy || queueLoading || selectedEvent.status !== 'ativo'} onClick={() => void callNext()}>📣 <b>{busy ? 'Chamando...' : 'Chamar próximo'}<small>Avançar em ordem da fila</small></b> →</button>
        </div>
        <div className="section-head queue-head"><div><h2>Fila do evento <span>{queueLoading ? '…' : queue.length}</span></h2><p>Clique em uma pessoa para editar os dados.</p></div><label className="queue-sort-control">Ordenar por<select value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSort)} aria-label="Ordenar fila"><option value="order-asc">Número: menor para maior</option><option value="order-desc">Número: maior para menor</option><option value="status">Status</option><option value="name">Nome</option></select></label><button className="primary" disabled={queueLoading || selectedEvent.status !== 'ativo'} onClick={() => setAddQueueOpen(true)}>＋ Adicionar à fila</button><button className="secondary" onClick={() => { setEventForm({ ...selectedEvent, data: new Date(selectedEvent.data).toISOString().slice(0, 16) }); setCoverFile(null); setBannerFile(null); setFaviconFile(null); setEventModalOpen(true) }}>✎ Editar evento</button><button className="refresh" disabled={queueLoading} onClick={() => void loadQueue(selectedEvent)} aria-label="Atualizar fila">↻</button></div>
        {!queueLoading && queue.length > 0 && <div className="queue-selection-toolbar">
          <label className="queue-select-all"><input type="checkbox" checked={queue.length > 0 && queue.every((item) => selectedQueueIds.includes(item.id))} onChange={(event) => setSelectedQueueIds(event.target.checked ? queue.map((item) => item.id) : [])} /> <span>Selecionar todos</span></label>
          <span>{selectedQueueIds.length} selecionado{selectedQueueIds.length === 1 ? '' : 's'}</span>
          {selectedQueueIds.length > 0 && <button className="danger-outline queue-delete-button" disabled={busy} onClick={() => void deleteSelectedQueueEntries()}>{busy ? 'Excluindo...' : `Excluir selecionados (${selectedQueueIds.length})`}</button>}
        </div>}
        {queueLoading ? <div className="queue-list queue-list-skeleton" aria-label="Carregando fila">{Array.from({ length: 5 }, (_, index) => <div className="queue-skeleton-row" key={index}><span className="loading-skeleton skeleton-position"/><span className="loading-skeleton skeleton-avatar"/><span className="skeleton-person"><i className="loading-skeleton skeleton-line wide"/><i className="loading-skeleton skeleton-line short"/></span><span className="loading-skeleton skeleton-pill"/></div>)}</div> : queue.length ? <div className="queue-list">{sortedQueue.map((item) =>
          <div key={item.id} className={'queue-row ' + (item.status === 'em atendimento' ? 'currently-serving' : '')}>
            <label className="queue-row-selector" aria-label={`Selecionar senha ${item.ordem_fila}`} onClick={(event) => event.stopPropagation()}>
              <input className="queue-row-select" type="checkbox" checked={selectedQueueIds.includes(item.id)} onChange={(event) => setSelectedQueueIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
            </label>
            <button className="queue-row-content" onClick={() => setSelectedPerson(item)}>
              <b className="position">{String(item.ordem_fila).padStart(2, '0')}</b><span className="person-avatar">{(item.profile?.nome ?? item.nome)?.[0]?.toUpperCase() ?? '?'}</span>
              <span className="person-name"><b>{item.profile?.nome ?? item.nome ?? 'Participante'}</b><small>{item.profile?.email ?? item.profile?.telefone ?? item.telefone ?? 'Cadastro público'}</small></span>
              <span className="queue-row-meta"><span className={item.pago ? 'paid' : 'unpaid'}>{item.pago ? '✓ Pago' : '◷ Pendente'}</span><span className={'pill state-' + item.status.replaceAll(' ', '-')}>{statuses[item.status] ?? item.status}</span></span>
              <span className="chevron">›</span>
            </button>
          </div>
        )}</div> : <div className="empty"><span>🦇</span><h3>A fila está vazia</h3><p>As inscrições aparecerão aqui.</p></div>}
      </> }
    </section>

    {createUserOpen && <AdminCreateUserModal events={events} initialEventId={createUserEventId ?? routeEventId} onClose={closeCreateUser} onCreated={(email, eventId) => { closeCreateUser(); setMessage(eventId ? 'Convite enviado para ' + email + ' e usuário adicionado à fila.' : 'Convite enviado para ' + email + '.'); if (selectedEvent && eventId === selectedEvent.id) void loadQueue(selectedEvent) }} />}

    {addQueueOpen && selectedEvent && <AddToQueueModal event={selectedEvent} onClose={() => setAddQueueOpen(false)} onAdded={(name) => { setAddQueueOpen(false); setMessage(name + ' foi adicionado à fila.'); void loadQueue(selectedEvent) }} onCreateNew={() => { setAddQueueOpen(false); openCreateUser(selectedEvent.id) }} />}

    {eventModalOpen && <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setEventModalOpen(false) }}>
      <section className="modal"><header><div><small className="eyebrow">EVENTO</small><h2>{eventForm.id ? 'Editar evento' : 'Criar evento'}</h2></div><button onClick={() => setEventModalOpen(false)}>×</button></header>
        <form onSubmit={saveEvent}>
          <label>Nome<input required value={eventForm.nome ?? ''} onChange={(e) => setEventForm({ ...eventForm, nome: e.target.value, slug: eventForm.id ? eventForm.slug : slugify(e.target.value) })} placeholder="Noite das Bruxas" /></label>
          <label>Slug<div className="slug"><span>/</span><input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={eventForm.slug ?? ''} onChange={(e) => setEventForm({ ...eventForm, slug: e.target.value })} placeholder="noite-das-bruxas" /></div><small>Único, minúsculo e separado por hífens.</small></label>
          <label>Data e horário<input required type="datetime-local" value={eventForm.data ?? ''} onChange={(e) => setEventForm({ ...eventForm, data: e.target.value })} /></label>
          <label>Descrição<textarea rows={3} value={eventForm.descricao ?? ''} onChange={(e) => setEventForm({ ...eventForm, descricao: e.target.value })} /></label>
          <EventImageField label="Imagem de capa" currentUrl={eventForm.imagem_capa} file={coverFile} disabled={busy} onChange={setCoverFile} />
          <EventImageField label="Banner" currentUrl={eventForm.banner} file={bannerFile} disabled={busy} onChange={setBannerFile} />
          <EventImageField label="Favicon do evento" currentUrl={eventForm.favicon} file={faviconFile} disabled={busy} helperText="Imagem quadrada recomendada. Será exibida na aba ao abrir este evento." onChange={setFaviconFile} />
          <label>Status<select value={eventForm.status ?? 'ativo'} onChange={(e) => setEventForm({ ...eventForm, status: e.target.value })}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setEventModalOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar evento'}</button></div>
        </form>
      </section>
    </div>}

    {selectedPerson && <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedPerson(null) }}>
      <section className="modal"><header><div><small className="eyebrow">DETALHES · SENHA {String(selectedPerson.ordem_fila).padStart(2, '0')}</small><h2>{selectedPerson.profile?.nome ?? selectedPerson.nome ?? 'Participante'}</h2></div><button onClick={() => setSelectedPerson(null)}>×</button></header>
        <div className="details"><span>✉️ {selectedPerson.profile?.email ?? 'Sem e-mail cadastrado'}</span><span>☎️ {selectedPerson.profile?.telefone ?? selectedPerson.telefone ?? 'Sem telefone'}</span><span>🪪 CPF {selectedPerson.profile?.cpf ?? 'Não informado'}</span><span>🎂 Nascimento: {formatBirthDate(selectedPerson.profile?.data_nascimento) ?? 'Não informado'}</span><span>🎈 Idade: {getAge(selectedPerson.profile?.data_nascimento) === null ? 'Não informada' : `${getAge(selectedPerson.profile?.data_nascimento)} anos`}</span></div>
        <form onSubmit={savePerson}>
          <label>Status<select name="status" defaultValue={selectedPerson.status}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="check"><input name="pago" type="checkbox" defaultChecked={selectedPerson.pago} /> Pagamento confirmado</label>
          <label>Forma de pagamento<select name="forma_pagamento" defaultValue={selectedPerson.forma_pagamento ?? ''}><option value="">Não selecionada</option>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Valor pago (R$)<input name="valor_pagamento" type="number" min="0" step="0.01" defaultValue={selectedPerson.valor_pagamento} /></label>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setSelectedPerson(null)}>Fechar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></div>
        </form>
      </section>
    </div>}

    {calledPerson && <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setCalledPerson(null) }}>
      <section className="modal called-person-modal" role="dialog" aria-modal="true" aria-labelledby="called-person-title">
        <header><div><small className="eyebrow">CHAMADA REALIZADA · {selectedEvent?.nome}</small><h2 id="called-person-title">Senha {String(calledPerson.ordem_fila).padStart(2, '0')}</h2></div><button type="button" onClick={() => setCalledPerson(null)} aria-label="Fechar">×</button></header>
        <div className="called-person-card"><span className="called-avatar">{(calledPerson.profile?.nome ?? calledPerson.nome)?.[0]?.toUpperCase() ?? '?'}</span><div><h3>{calledPerson.profile?.nome ?? calledPerson.nome ?? 'Participante'}</h3><p>Está sendo atendido agora.</p></div></div>
        <div className="details"><span>☎️ {calledPerson.profile?.telefone ?? calledPerson.telefone ?? 'Sem telefone cadastrado'}</span><span>✉️ {calledPerson.profile?.email ?? 'Sem e-mail cadastrado'}</span><span>🎂 Nascimento: {formatBirthDate(calledPerson.profile?.data_nascimento) ?? 'Não informado'}</span><span>🎈 Idade: {getAge(calledPerson.profile?.data_nascimento) === null ? 'Não informada' : `${getAge(calledPerson.profile?.data_nascimento)} anos`}</span></div>
        {(calledPerson.profile?.telefone ?? calledPerson.telefone) ? <a className="whatsapp-button" href={'https://wa.me/' + (calledPerson.profile?.telefone ?? calledPerson.telefone)!.replace(/\D/g, '') + '?text=' + encodeURIComponent('Olá, ' + (calledPerson.profile?.nome ?? calledPerson.nome ?? 'tudo bem') + '! Sua vez chegou no evento ' + (selectedEvent?.nome ?? '') + '. Sua senha é ' + String(calledPerson.ordem_fila).padStart(2, '0') + '.') } target="_blank" rel="noreferrer">☏ Chamar no WhatsApp</a> : <p className="whatsapp-missing">Cadastre um telefone no perfil para chamar pelo WhatsApp.</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setCalledPerson(null)}>Fechar</button></div>
      </section>
    </div>}
  </main>
}

