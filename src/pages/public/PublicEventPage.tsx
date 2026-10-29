import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { supabase } from '../../lib/supabase'
import type { EventRow, Profile, QueueRow } from '../../types'
import { formatCpf } from '../../lib/formatters'
import PhoneNumberField from '../../components/PhoneNumberField'
import ThemeToggle from '../../components/ThemeToggle'
import { appAsset, appUrl } from '../../lib/paths'

type Props = { slug: string; user: User | null; profile: Profile | null; theme: string; onToggleTheme: () => void; onLogout: () => void }
type QueueState = { atendendo: number | null; proxima: number | null }
type CustomerQueueRow = QueueRow & { evento_id?: string }
const passwordRules = [
  { label: 'Pelo menos 8 caracteres', test: (value: string) => value.length >= 8 },
  { label: 'Uma letra maiúscula', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Uma letra minúscula', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Um número', test: (value: string) => /\d/.test(value) },
  { label: 'Um caractere especial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

function messageFromError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

export default function PublicEventPage({ slug, user, profile, theme, onToggleTheme, onLogout }: Props) {
  const [event, setEvent] = useState<EventRow | null>(null)
  const [eventLoading, setEventLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginWithPassword, setLoginWithPassword] = useState(true)
  const [name, setName] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupFieldErrors, setSignupFieldErrors] = useState<Record<string, string>>({})
  const [signupSubmitError, setSignupSubmitError] = useState('')
  const [cpf, setCpf] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [phone, setPhone] = useState<string>()
  const [authBusy, setAuthBusy] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [myEntry, setMyEntry] = useState<CustomerQueueRow | null>(null)
  const [queueState, setQueueState] = useState<QueueState>({ atendendo: null, proxima: null })
  const [queueMessage, setQueueMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const notifiedEntryId = useRef<string | null>(null)
  const signupFormRef = useRef<HTMLFormElement>(null)

  function focusSignupField(field: string) {
    window.requestAnimationFrame(() => {
      const target = signupFormRef.current?.querySelector<HTMLElement>(`[data-signup-field="${field}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const focusTarget = field === 'phone' ? target?.querySelector<HTMLElement>('input[type="tel"]') : target
      focusTarget?.focus()
    })
  }

  useEffect(() => {
    let active = true
    async function loadEvent() {
      if (!supabase) { setEventLoading(false); return }
      setEventLoading(true)
      setPageError('')
      const { data, error: loadError } = await supabase.from('events').select('*').eq('slug', slug).eq('status', 'ativo').maybeSingle()
      if (!active) return
      if (loadError) setPageError(messageFromError(loadError, 'Não foi possível carregar este evento.'))
      setEvent((data as EventRow | null) ?? null)
      setEventLoading(false)
    }
    void loadEvent()
    return () => { active = false }
  }, [slug])

  useEffect(() => {
    const faviconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!faviconLink) return
    faviconLink.href = event?.favicon || `${appAsset('favicon.svg')}?v=3`
    return () => { faviconLink.href = `${appAsset('favicon.svg')}?v=3` }
  }, [event?.favicon])

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const errorCode = params.get('error_code')
    const authError = params.get('error')
    if (!errorCode && !authError) return
    setPageError(errorCode === 'otp_expired'
      ? 'Este link de acesso expirou ou já foi usado. Solicite um novo link e abra o e-mail mais recente.'
      : 'Não foi possível confirmar seu acesso. Solicite um novo link e tente novamente.')
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])

  const loadQueue = useCallback(async (showLoader = false) => {
    if (!supabase || !event || !user) return
    if (showLoader) setQueueLoading(true)
    const [entriesResult, stateResult] = await Promise.all([
      supabase.rpc('listar_fila_evento', { p_evento_id: event.id }),
      supabase.rpc('estado_fila_evento', { p_evento_id: event.id }),
    ])
    if (entriesResult.error) setPageError(messageFromError(entriesResult.error, 'Não foi possível carregar sua posição na fila.'))
    else {
      const entries = (entriesResult.data ?? []) as CustomerQueueRow[]
      const activeEntries = entries.filter((entry) => entry.status === 'na fila' || entry.status === 'em atendimento')
      activeEntries.sort((a, b) => b.ordem_fila - a.ordem_fila)
      setMyEntry(activeEntries[0] ?? null)
    }
    if (stateResult.error) setPageError(messageFromError(stateResult.error, 'Não foi possível consultar o andamento da fila.'))
    else {
      const state = Array.isArray(stateResult.data) ? stateResult.data[0] : stateResult.data
      setQueueState({ atendendo: state?.atendendo ?? null, proxima: state?.proxima ?? null })
    }
    if (showLoader) setQueueLoading(false)
  }, [event, user])

  useEffect(() => {
    if (!event || !user) { setMyEntry(null); setQueueState({ atendendo: null, proxima: null }); return }
    void loadQueue(true)
    const timer = window.setInterval(() => void loadQueue(), 6000)
    return () => window.clearInterval(timer)
  }, [event, user, loadQueue])

  useEffect(() => {
    if (myEntry?.status !== 'em atendimento' || notifiedEntryId.current === myEntry.id) return
    notifiedEntryId.current = myEntry.id
    setQueueMessage('Sua vez chegou! Dirija-se ao atendimento.')
    if (typeof navigator.vibrate === 'function') navigator.vibrate([250, 120, 250, 120, 450])
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Sua vez chegou!', { body: `Senha ${String(myEntry.ordem_fila).padStart(2, '0')} · ${event?.nome ?? 'Fila do evento'}` })
    }
  }, [myEntry, event?.nome])

  const eventRedirect = () => `${window.location.origin}${appUrl(`/events/${encodeURIComponent(slug)}`)}`

  async function sendLoginLink(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setPageError(''); setEmailSent(false)
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: eventRedirect() },
      })
      if (authError) throw authError
      setEmailSent(true)
    } catch (caught) { setPageError(messageFromError(caught, 'Não foi possível enviar o link de acesso.')) }
    finally { setAuthBusy(false) }
  }

  async function signInWithPassword(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setPageError(''); setEmailSent(false)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password: loginPassword })
      if (authError) throw authError
    } catch (caught) { setPageError(messageFromError(caught, 'Não foi possível entrar com esses dados.')) }
    finally { setAuthBusy(false) }
  }

  async function register(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    if (!supabase) return
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = 'Informe seu nome.'
    if (!email.trim()) errors.email = 'Informe seu e-mail.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Informe um e-mail válido.'
    if (!phone || !isValidPhoneNumber(phone)) errors.phone = 'Informe um telefone válido para o país selecionado.'
    if (cpf && cpf.replace(/\D/g, '').length !== 11) errors.cpf = 'Se informar o CPF, preencha os 11 dígitos.'
    if (passwordRules.some((rule) => !rule.test(signupPassword))) errors.password = 'A senha precisa cumprir todos os requisitos abaixo.'
    if (!confirmPassword) errors.confirmPassword = 'Confirme sua senha.'
    else if (signupPassword !== confirmPassword) errors.confirmPassword = 'As senhas não coincidem.'
    setSignupFieldErrors(errors)
    setSignupSubmitError('')
    setPageError('')
    if (Object.keys(errors).length) { focusSignupField(Object.keys(errors)[0]); return }
    setAuthBusy(true); setEmailSent(false)
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password: signupPassword,
        options: {
          emailRedirectTo: eventRedirect(),
          data: { nome: name.trim(), telefone: phone, cpf: cpf ? cpf.replace(/\D/g, '') : null, data_nascimento: birthDate || null },
        },
      })
      if (authError) throw authError
      setEmailSent(true)
    } catch (caught) { setSignupSubmitError(messageFromError(caught, 'Não foi possível iniciar o cadastro.')); focusSignupField('submit') }
    finally { setAuthBusy(false) }
  }

  async function joinQueue() {
    if (!supabase || !event || !user) return
    setQueueBusy(true); setPageError(''); setQueueMessage('')
    try {
      const { error: joinError } = await supabase.rpc('join_event_queue', { p_evento_id: event.id })
      if (joinError) throw joinError
      setQueueMessage('Você entrou na fila. Acompanhe seu número nesta tela.')
      await loadQueue(true)
    } catch (caught) { setPageError(messageFromError(caught, 'Não foi possível entrar na fila.')) }
    finally { setQueueBusy(false) }
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') { setNotificationPermission('unsupported'); return }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    setQueueMessage(permission === 'granted' ? 'Notificações ativadas para esta tela.' : 'Notificações não foram autorizadas. Você ainda verá o aviso enquanto esta tela estiver aberta.')
  }

  const currentNumber = myEntry?.ordem_fila
  const isMyTurn = myEntry?.status === 'em atendimento'

  return <main className="public-event-page">
    <header className="public-event-top"><a className="brand" href={appUrl('/')}>🎃 fila<span>do</span>halloween</a><div>{user && <button className="secondary" onClick={onLogout}>Sair</button>}<ThemeToggle theme={theme} onToggle={onToggleTheme} /></div></header>
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
        {pageError && <div className="error public-event-alert">{pageError}</div>}
        {emailSent && <div className="notice public-event-alert">Enviamos um link para o e-mail informado. Abra o e-mail mais recente para continuar e voltar a este evento.</div>}
        {user ? <section className="public-queue-card">
          <div className="public-queue-heading"><div><small className="eyebrow">SUA PARTICIPAÇÃO</small><h2>{profile?.nome ? `Olá, ${profile.nome.split(' ')[0]}!` : 'Acompanhe sua vez'}</h2></div><span className={'public-queue-status' + (isMyTurn ? ' your-turn' : '')}>{isMyTurn ? 'Sua vez chegou' : currentNumber ? 'Na fila' : 'Pronto para entrar'}</span></div>
          {profile?.status === 'inativo' ? <div className="error">Seu cadastro está inativo. Fale com a organização do evento.</div> : queueLoading ? <div className="public-queue-stats-skeleton"><span/><span/><span/></div> : currentNumber ? <>
            <div className="public-queue-numbers"><article className={isMyTurn ? 'highlight' : ''}><small>Sua senha</small><strong>{String(currentNumber).padStart(2, '0')}</strong></article><article><small>Em atendimento</small><strong>{queueState.atendendo ? String(queueState.atendendo).padStart(2, '0') : '—'}</strong></article><article><small>Próxima senha</small><strong>{queueState.proxima ? String(queueState.proxima).padStart(2, '0') : '—'}</strong></article></div>
            {isMyTurn ? <div className="notice public-turn-message" role="status">🔔 Sua vez chegou! Dirija-se ao atendimento agora.</div> : <p className="public-queue-help">Deixe esta tela aberta para receber o aviso quando sua vez chegar. A fila atualiza automaticamente.</p>}
            <div className="public-queue-actions">{notificationPermission === 'default' && <button className="secondary" onClick={() => void enableNotifications()}>Ativar notificações</button>}{notificationPermission === 'granted' && <span className="notification-enabled">✓ Notificações ativadas</span>}{notificationPermission === 'unsupported' && <span className="notification-enabled">A vibração depende do suporte do navegador.</span>}</div>
          </> : <>
            <p>Entre na fila do evento e acompanhe sua senha pelo celular.</p>
            <button className="primary public-join-button" disabled={queueBusy || profile?.status === 'inativo'} onClick={() => void joinQueue()}>{queueBusy ? 'Entrando na fila...' : 'Entrar na fila'} <span>→</span></button>
          </>}
          {queueMessage && <div className="notice public-event-alert" role="status">{queueMessage}</div>}
        </section> : <section className="public-event-auth-card">
          <div className="public-auth-heading"><small className="eyebrow">PARTICIPE DO EVENTO</small><h2>{mode === 'login' ? 'Entre na sua conta' : 'Crie seu cadastro'}</h2><p>{mode === 'login' ? 'Entre com seu e-mail e senha ou receba um link seguro por e-mail.' : 'Preencha seus dados, escolha uma senha e confirme seu e-mail para entrar na fila.'}</p></div>
          {mode === 'login' ? <form className="form" onSubmit={(e) => void (loginWithPassword ? signInWithPassword(e) : sendLoginLink(e))}>
            <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" /></label>
            {loginWithPassword && <label>Senha<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Sua senha" /></label>}
            <button className="primary" disabled={authBusy}>{authBusy ? (loginWithPassword ? 'Entrando...' : 'Enviando link...') : (loginWithPassword ? 'Entrar' : 'Enviar link por e-mail')}<span>→</span></button>
            <button type="button" className="text-button public-mode-toggle" onClick={() => { setLoginWithPassword(!loginWithPassword); setPageError(''); setEmailSent(false) }}>{loginWithPassword ? 'Prefiro receber link por e-mail' : 'Entrar com senha'}</button>
            <button type="button" className="text-button public-mode-toggle" onClick={() => { setMode('signup'); setPageError(''); setEmailSent(false) }}>Ainda não tenho cadastro · Criar conta</button>
          </form> : <form ref={signupFormRef} className="form" noValidate onSubmit={(e) => void register(e)}>
            <div className="public-form-field"><label htmlFor="public-signup-name">Seu nome</label><input id="public-signup-name" data-signup-field="name" name="nome" autoComplete="name" value={name} aria-invalid={!!signupFieldErrors.name} aria-describedby={signupFieldErrors.name ? 'signup-name-error' : undefined} onChange={(e) => { setName(e.target.value); setSignupFieldErrors((current) => ({ ...current, name: '' })) }} placeholder="Seu nome completo" />{signupFieldErrors.name && <small id="signup-name-error" className="field-error">{signupFieldErrors.name}</small>}</div>
            <div className="public-form-field"><label htmlFor="public-signup-email">E-mail</label><input id="public-signup-email" data-signup-field="email" name="email" type="email" autoComplete="email" value={email} aria-invalid={!!signupFieldErrors.email} aria-describedby={signupFieldErrors.email ? 'signup-email-error' : undefined} onChange={(e) => { setEmail(e.target.value); setSignupFieldErrors((current) => ({ ...current, email: '' })) }} placeholder="voce@email.com" />{signupFieldErrors.email && <small id="signup-email-error" className="field-error">{signupFieldErrors.email}</small>}</div>
            <label>Telefone<div data-signup-field="phone"><PhoneNumberField value={phone} onChange={(value) => { setPhone(value); setSignupFieldErrors((current) => ({ ...current, phone: '' })) }} /></div><small>Usado pela organização para contato.</small>{signupFieldErrors.phone && <small className="field-error">{signupFieldErrors.phone}</small>}</label>
            <label>CPF (opcional)<input data-signup-field="cpf" inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} aria-invalid={!!signupFieldErrors.cpf} onChange={(e) => { setCpf(formatCpf(e.target.value)); setSignupFieldErrors((current) => ({ ...current, cpf: '' })) }} placeholder="000.000.000-00" />{signupFieldErrors.cpf && <small className="field-error">{signupFieldErrors.cpf}</small>}</label>
            <label>Data de nascimento (opcional)<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label>
            <div className="public-form-field"><label htmlFor="public-signup-password">Senha</label><input id="public-signup-password" data-signup-field="password" type="password" autoComplete="new-password" value={signupPassword} aria-invalid={!!signupFieldErrors.password} onChange={(e) => { setSignupPassword(e.target.value); setSignupFieldErrors((current) => ({ ...current, password: '' })) }} placeholder="Crie uma senha" />{signupFieldErrors.password && <small className="field-error">{signupFieldErrors.password}</small>}</div>
            <ul className="password-rules" aria-label="Requisitos da senha">{passwordRules.map((rule) => { const valid = rule.test(signupPassword); return <li key={rule.label} className={valid ? 'valid' : ''}><span>{valid ? '✓' : '•'}</span>{rule.label}</li> })}</ul>
            <div className="public-form-field"><label htmlFor="public-signup-confirm-password">Confirmar senha</label><input id="public-signup-confirm-password" data-signup-field="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} aria-invalid={!!signupFieldErrors.confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setSignupFieldErrors((current) => ({ ...current, confirmPassword: '' })) }} placeholder="Digite a senha novamente" />{signupFieldErrors.confirmPassword && <small className="field-error">{signupFieldErrors.confirmPassword}</small>}</div>
            {confirmPassword && <p className={'password-match' + (signupPassword === confirmPassword ? ' valid' : '')}>{signupPassword === confirmPassword ? 'As senhas coincidem.' : 'As senhas não coincidem.'}</p>}
            {signupSubmitError && <div className="error signup-submit-error" role="alert">{signupSubmitError}</div>}
            <button className="primary" data-signup-field="submit" disabled={authBusy}>{authBusy ? 'Criando cadastro...' : 'Cadastrar e continuar'}<span>→</span></button>
            <button type="button" className="text-button public-mode-toggle" onClick={() => { setMode('login'); setPageError(''); setEmailSent(false) }}>Já tenho cadastro · Entrar</button>
          </form>}
        </section>}
        <footer className="public-event-footer">Acompanhe sua vez por esta página · Fila Digital Halloween</footer>
      </section>
    </>}
  </main>
}
