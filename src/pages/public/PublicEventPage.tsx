import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { supabase } from '../../lib/supabase'
import type { EventRow } from '../../types'
import PhoneNumberField from '../../components/PhoneNumberField'
import ThemeToggle from '../../components/ThemeToggle'
import TurnstileWidget from '../../components/TurnstileWidget'
import { appAsset, appUrl } from '../../lib/paths'

type Props = {
  slug: string
  queueEntryId: string | null
  user: User | null
  theme: string
  onToggleTheme: () => void
  navigate: (to: string, replace?: boolean) => void
  onOpenProfile: () => void
  onLogout: () => void
}
type PublicQueueEntry = { id: string; ordem_fila: number; status: string; criado_em: string }
type QueueState = { atendendo: number | null; proxima: number | null }
type Identity = { nome: string; telefone: string }

function messageFromError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const details = error as { message: string; code?: string }
    if (details.code === '23505') return 'Já existe uma senha aguardando com este nome e telefone.'
    return details.message
  }
  return fallback
}

async function publicSignupErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'context' in error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response) {
      try {
        const body = await response.clone().json() as { error?: unknown }
        if (typeof body.error === 'string') return body.error
      } catch { /* Usa a mensagem padrão do erro da Edge Function. */ }
    }
  }
  return messageFromError(error, fallback)
}

export default function PublicEventPage({ slug, queueEntryId, user, theme, onToggleTheme, navigate, onOpenProfile, onLogout }: Props) {
  const [event, setEvent] = useState<EventRow | null>(null)
  const [eventLoading, setEventLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState<string>()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [entries, setEntries] = useState<PublicQueueEntry[]>([])
  const [queueState, setQueueState] = useState<QueueState>({ atendendo: null, proxima: null })
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaVersion, setCaptchaVersion] = useState(0)
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const notifiedEntries = useRef(new Set<string>())
  const identityStorageKey = `fila-public-identity:${slug}`
  const handleCaptchaToken = useCallback((token: string | null) => setCaptchaToken(token), [])
  const waitingEntryExists = entries.some((entry) => entry.status === 'na fila')
  const selectedEntry = entries.find((entry) => entry.id === queueEntryId) ?? entries[0]
  const isMyTurn = selectedEntry?.status === 'em atendimento'

  useEffect(() => {
    let active = true
    async function loadEvent() {
      if (!supabase) { setEventLoading(false); return }
      setEventLoading(true)
      setPageError('')
      const { data, error } = await supabase.rpc('get_public_event_by_slug', { p_slug: slug })
      if (!active) return
      if (error) setPageError(messageFromError(error, 'Não foi possível carregar este evento.'))
      const row = Array.isArray(data) ? data[0] : data
      setEvent((row as EventRow | null) ?? null)
      setEventLoading(false)
    }
    void loadEvent()
    return () => { active = false }
  }, [slug])

  useLayoutEffect(() => {
    if (queueEntryId) {
      try {
        const saved = sessionStorage.getItem(identityStorageKey)
        if (!saved) { navigate(`/events/${encodeURIComponent(slug)}`, true); return }
        const restored = JSON.parse(saved) as Identity
        if (!restored.nome || !restored.telefone) throw new Error('Identificação inválida')
        setIdentity(restored)
        setName('')
        setPhone(undefined)
      } catch {
        try { sessionStorage.removeItem(identityStorageKey) } catch { /* Continua para o formulário sem dados salvos. */ }
        navigate(`/events/${encodeURIComponent(slug)}`, true)
      }
      return
    }
    try { sessionStorage.removeItem(identityStorageKey) } catch { /* O formulário também é limpo em memória. */ }
    setName('')
    setPhone(undefined)
    setIdentity(null)
    setEntries([])
    setQueueState({ atendendo: null, proxima: null })
    setCaptchaToken(null)
    setCaptchaVersion((version) => version + 1)
    setPageError('')
  }, [queueEntryId, identityStorageKey, navigate, slug])

  useEffect(() => {
    const faviconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!faviconLink) return
    faviconLink.href = event?.favicon || `${appAsset('favicon.svg')}?v=3`
    return () => { faviconLink.href = `${appAsset('favicon.svg')}?v=3` }
  }, [event?.favicon])

  const loadQueue = useCallback(async (currentIdentity: Identity, showLoader = false) => {
    if (!supabase || !event) return
    if (showLoader) setQueueLoading(true)
    setPageError('')
    const { data, error } = await supabase.rpc('find_public_event_queue_entries', {
      p_evento_id: event.id,
      p_nome: currentIdentity.nome,
      p_telefone: currentIdentity.telefone,
    })
    if (error) {
      setPageError(messageFromError(error, 'Não foi possível consultar suas senhas.'))
      if (showLoader) setQueueLoading(false)
      return
    }
    const found = (data ?? []) as PublicQueueEntry[]
    setEntries(found)
    if (found.length) {
      const { data: stateData, error: stateError } = await supabase.rpc('estado_publico_fila_evento', {
        p_evento_id: event.id,
        p_nome: currentIdentity.nome,
        p_telefone: currentIdentity.telefone,
      })
      if (stateError) setPageError(messageFromError(stateError, 'Não foi possível consultar o andamento da fila.'))
      else {
        const state = Array.isArray(stateData) ? stateData[0] : stateData
        setQueueState({ atendendo: state?.atendendo ?? null, proxima: state?.proxima ?? null })
      }
    } else setQueueState({ atendendo: null, proxima: null })
    if (showLoader) setQueueLoading(false)
  }, [event])

  useEffect(() => {
    if (!event || !identity) { setEntries([]); setQueueState({ atendendo: null, proxima: null }); return }
    void loadQueue(identity, true)
    const timer = window.setInterval(() => void loadQueue(identity), 6000)
    return () => window.clearInterval(timer)
  }, [event, identity, loadQueue])

  useEffect(() => {
    const called = entries.find((entry) => entry.id === queueEntryId && entry.status === 'em atendimento' && !notifiedEntries.current.has(entry.id))
    if (!called) return
    notifiedEntries.current.add(called.id)
    if (typeof navigator.vibrate === 'function') navigator.vibrate([250, 120, 250, 120, 450])
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Sua vez chegou!', { body: `Senha ${String(called.ordem_fila).padStart(2, '0')} · ${event?.nome ?? 'Fila do evento'}` })
    }
  }, [entries, event?.nome, queueEntryId])

  async function advance(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    if (!supabase || !event) return
    const cleanName = name.trim()
    if (cleanName.length < 2 || cleanName.length > 120) { setPageError('Informe um nome entre 2 e 120 caracteres.'); return }
    if (!phone || !isValidPhoneNumber(phone)) { setPageError('Informe um telefone válido para o país escolhido.'); return }
    if (!captchaToken) { setPageError('Conclua a validação de segurança para continuar.'); return }

    const identityValue = { nome: cleanName, telefone: phone }
    setQueueBusy(true)
    setPageError('')
    try {
      const { data: existing, error: lookupError } = await supabase.rpc('find_public_event_queue_entries', {
        p_evento_id: event.id,
        p_nome: cleanName,
        p_telefone: phone,
      })
      if (lookupError) throw lookupError
      const currentEntries = (existing ?? []) as PublicQueueEntry[]
      let targetEntryId = currentEntries.filter((entry) => entry.status === 'na fila').sort((a, b) => a.ordem_fila - b.ordem_fila)[0]?.id
        ?? currentEntries.sort((a, b) => b.ordem_fila - a.ordem_fila)[0]?.id
      if (!currentEntries.some((entry) => entry.status === 'na fila')) {
        const { data: signupData, error: joinError } = await supabase.functions.invoke('public-queue-signup', {
          body: { evento_id: event.id, nome: cleanName, telefone: phone, captcha_token: captchaToken },
        })
        if (joinError) throw joinError
        targetEntryId = signupData?.queueEntry?.id
        if (!targetEntryId) {
          const { data: refreshed, error: refreshError } = await supabase.rpc('find_public_event_queue_entries', {
            p_evento_id: event.id,
            p_nome: cleanName,
            p_telefone: phone,
          })
          if (refreshError) throw refreshError
          const insertedEntries = (refreshed ?? []) as PublicQueueEntry[]
          targetEntryId = insertedEntries.filter((entry) => entry.status === 'na fila').sort((a, b) => b.ordem_fila - a.ordem_fila)[0]?.id
        }
      }
      if (!targetEntryId) throw new Error('Não foi possível identificar sua senha. Atualize a página e tente novamente.')
      try { sessionStorage.setItem(identityStorageKey, JSON.stringify(identityValue)) } catch { /* A navegação funciona enquanto a tela permanecer aberta. */ }
      setIdentity(identityValue)
      await loadQueue(identityValue, true)
      navigate(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(targetEntryId)}`)
    } catch (error) {
      setPageError(await publicSignupErrorMessage(error, 'Não foi possível avançar para a fila.'))
    } finally { setQueueBusy(false); setCaptchaToken(null); setCaptchaVersion((version) => version + 1) }
  }

  async function joinAgain() {
    if (!supabase || !event || !identity || waitingEntryExists) return
    if (!captchaToken) { setPageError('Conclua a validação de segurança para entrar novamente.'); return }
    setQueueBusy(true)
    setPageError('')
    try {
      const { error } = await supabase.functions.invoke('public-queue-signup', {
        body: { evento_id: event.id, nome: identity.nome, telefone: identity.telefone, captcha_token: captchaToken },
      })
      if (error) throw error
      await loadQueue(identity, true)
    } catch (caught) {
      const errorMessage = await publicSignupErrorMessage(caught, 'Não foi possível entrar novamente na fila.')
      await loadQueue(identity)
      setPageError(errorMessage)
    } finally { setQueueBusy(false); setCaptchaToken(null); setCaptchaVersion((version) => version + 1) }
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') { setNotificationPermission('unsupported'); return }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  return <main className="public-event-page">
    <header className="public-event-top">
      <a className="brand" href={appUrl('/')}>🎃 fila<span>do</span>halloween</a>
      <div>{user && <><button className="secondary public-profile-button" onClick={onOpenProfile}>Meu perfil</button><button className="secondary public-logout-button" onClick={onLogout}>Sair</button></>}<ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
    </header>
    {eventLoading ? <section className="public-event-loading"><span className="loading-skeleton skeleton-cover"/><span className="loading-skeleton skeleton-line wide"/><span className="loading-skeleton skeleton-line"/></section> : !event ? <section className="public-event-missing"><span>🕸️</span><h1>Evento não encontrado</h1><p>Este evento pode ter sido encerrado ou o endereço está incorreto.</p></section> : <>
      <section className="public-event-hero" style={{ backgroundImage: `linear-gradient(90deg, #100d18e8 0%, #100d18a8 52%, #100d1830 100%), url("${event.banner || event.imagem_capa || ''}")` }}>
        <div className="public-event-hero-content">
          {event.favicon && <img className="public-event-favicon" src={event.favicon} alt="" />}
          <small className="eyebrow">FILA DO EVENTO</small><h1>{event.nome}</h1>
          <p className="public-event-date">{new Date(event.data).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}</p>
          {event.descricao && <p className="public-event-description">{event.descricao}</p>}
          {event.imagem_capa && <img className="public-event-cover" src={event.imagem_capa} alt={`Capa do evento ${event.nome}`} />}
        </div>
      </section>
      <section className="public-event-content">
        {pageError && <div className="error public-event-alert" role="alert">{pageError}</div>}
        {!queueEntryId ? <section className="public-event-auth-card">
          <div className="public-auth-heading"><small className="eyebrow">PARTICIPE DO EVENTO</small><h2>Entre na fila</h2><p>Informe seu nome e telefone para receber sua senha e acompanhar sua vez.</p></div>
          <form className="form" onSubmit={(eventSubmit) => void advance(eventSubmit)} onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key !== 'Enter' || !(keyboardEvent.target instanceof HTMLInputElement)) return
            const input = keyboardEvent.target
            if (input.name === 'nome') {
              keyboardEvent.preventDefault()
              keyboardEvent.currentTarget.querySelector<HTMLInputElement>('.PhoneInputInput')?.focus()
            } else if (input.classList.contains('PhoneInputInput')) {
              keyboardEvent.preventDefault()
              keyboardEvent.currentTarget.requestSubmit()
            }
          }}>
            <label>Nome<input name="nome" required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(eventChange) => setName(eventChange.target.value)} placeholder="Seu nome completo" /></label>
            <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /><small>Escolha o país; o telefone será salvo no padrão internacional.</small></label>
            <TurnstileWidget key={captchaVersion} siteKey={turnstileSiteKey} onToken={handleCaptchaToken} />
            <button className="primary" disabled={queueBusy || !captchaToken}>{queueBusy ? 'Verificando...' : 'Avançar'}<span>→</span></button>
          </form>
        </section> : <section className="public-queue-card">
          <div className="public-queue-heading"><div><small className="eyebrow">SUA PARTICIPAÇÃO</small><h2>Olá, {identity?.nome.split(' ')[0] ?? 'participante'}!</h2></div><span className={'public-queue-status' + (isMyTurn ? ' your-turn' : '')}>{isMyTurn ? 'Sua vez chegou' : waitingEntryExists ? 'Na fila' : 'Sem senha aguardando'}</span></div>
          {queueLoading ? <div className="public-queue-stats-skeleton"><span/><span/><span/></div> : entries.length ? <>
            <div className="public-queue-numbers"><article className={isMyTurn ? 'highlight' : ''}><small>Sua senha</small><strong>{String((selectedEntry ?? entries[0]).ordem_fila).padStart(2, '0')}</strong></article><article><small>Em atendimento</small><strong>{queueState.atendendo ? String(queueState.atendendo).padStart(2, '0') : '—'}</strong></article><article><small>Próxima senha</small><strong>{queueState.proxima ? String(queueState.proxima).padStart(2, '0') : '—'}</strong></article></div>
            <div className="public-entry-history"><h3>Suas senhas neste evento</h3>{entries.map((entry) => <div className="public-entry-row" key={entry.id}><b>Senha {String(entry.ordem_fila).padStart(2, '0')}</b><span className={'pill state-' + entry.status.replaceAll(' ', '-')}>{entry.status === 'na fila' ? 'Na fila' : entry.status === 'em atendimento' ? 'Em atendimento' : entry.status === 'atendido' ? 'Atendido' : entry.status === 'cancelado' ? 'Cancelado' : entry.status}</span></div>)}</div>
            {isMyTurn ? <div className="notice public-turn-message" role="status">🔔 Sua vez chegou! Dirija-se ao atendimento agora.</div> : <p className="public-queue-help">Deixe esta tela aberta para receber o aviso quando sua vez chegar. A fila atualiza automaticamente.</p>}
            <div className="public-queue-actions">{notificationPermission === 'default' && <button className="secondary" onClick={() => void enableNotifications()}>Ativar notificações</button>}{notificationPermission === 'granted' && <span className="notification-enabled">✓ Notificações ativadas</span>}{notificationPermission === 'unsupported' && <span className="notification-enabled">A vibração depende do suporte do navegador.</span>}</div>
            {!waitingEntryExists && <><TurnstileWidget key={captchaVersion} siteKey={turnstileSiteKey} onToken={handleCaptchaToken} /><button className="primary public-join-button" disabled={queueBusy || !captchaToken} onClick={() => void joinAgain()}>{queueBusy ? 'Entrando...' : 'Entrar na fila novamente'}<span>→</span></button></>}
          </> : <p>Não encontramos senhas para este nome e telefone.</p>}
          {entries.length === 0 && !queueLoading && <><TurnstileWidget key={captchaVersion} siteKey={turnstileSiteKey} onToken={handleCaptchaToken} /><button className="primary public-join-button" disabled={queueBusy || !captchaToken} onClick={() => void joinAgain()}>{queueBusy ? 'Entrando...' : 'Entrar na fila'}<span>→</span></button></>}
          <button type="button" className="text-button public-mode-toggle" onClick={() => navigate(`/events/${encodeURIComponent(slug)}`, true)}>Alterar nome ou telefone</button>
        </section>}
        <footer className="public-event-footer">Acompanhe sua vez por esta página · Fila Digital Halloween</footer>
      </section>
    </>}
  </main>
}
