import { useEffect, useState, type FormEvent } from 'react'
import { isValidPhoneNumber } from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { supabase } from '../../lib/supabase'
import { formatCpf } from '../../lib/formatters'
import PhoneNumberField from '../../components/PhoneNumberField'

type Step = 'login' | 'signup' | 'recover' | 'verify'
type Purpose = 'login' | 'signup' | 'recover'
type Props = { theme: string; onToggleTheme: () => void }

const passwordRules = [
  { label: 'Pelo menos 8 caracteres', test: (value: string) => value.length >= 8 },
  { label: 'Uma letra maiúscula', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Uma letra minúscula', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Um número', test: (value: string) => /\d/.test(value) },
  { label: 'Um caractere especial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

export default function AuthPage({ theme, onToggleTheme }: Props) {
  const [step, setStep] = useState<Step>('login')
  const [purpose, setPurpose] = useState<Purpose>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState<string | undefined>()
  const [token, setToken] = useState('')
  const [passwordMode, setPasswordMode] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    const errorCode = params.get('error_code')
    const authError = params.get('error')
    if (!errorCode && !authError) return

    if (errorCode === 'otp_expired') {
      setError('Este link de acesso expirou ou já foi usado. Solicite um novo link e abra o e-mail mais recente.')
    } else if (authError === 'access_denied') {
      setError('Não foi possível confirmar seu acesso. Solicite um novo link e tente novamente.')
    } else {
      setError('Não foi possível concluir o login pelo link. Solicite um novo e-mail e tente novamente.')
    }

    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])

  function showVerification(action: Purpose, text: string) {
    setPurpose(action); setStep('verify'); setToken(''); setMessage(text); setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (step === 'login' && passwordMode) {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) throw authError
      } else if (step === 'login') {
        const { error: authError } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
        if (authError) throw authError
        showVerification('login', 'Enviamos um código de acesso para seu e-mail.')
      } else if (step === 'signup') {
        if (cpf.replace(/\D/g, '').length !== 11) throw new Error('Informe um CPF válido com 11 dígitos.')
        if (passwordRules.some((rule) => !rule.test(password))) throw new Error('A senha ainda não atende a todos os requisitos.')
        if (password !== confirmPassword) throw new Error('A senha e a confirmação precisam ser iguais.')
        if (!phone || !isValidPhoneNumber(phone)) throw new Error('Informe um telefone válido para o país selecionado.')
        const { error: authError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { nome: name.trim(), cpf: cpf.replace(/\D/g, ''), telefone: phone } },
        })
        if (authError) throw authError
        showVerification('signup', 'Código enviado. Confirme seu e-mail para concluir o cadastro.')
      } else if (step === 'recover') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim())
        if (authError) throw authError
        showVerification('recover', 'Se houver uma conta com esse e-mail, enviaremos um código de recuperação.')
      } else {
        if (token.trim().length < 6) throw new Error('Digite o código enviado por e-mail.')
        if (purpose === 'recover' && newPassword.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.')
        const type = purpose === 'signup' ? 'signup' : purpose === 'recover' ? 'recovery' : 'email'
        const { error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type })
        if (verifyError) throw verifyError
        if (purpose === 'recover') {
          const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
          if (updateError) throw updateError
          setMessage('Senha alterada. Você já está conectado.')
        } else setMessage('E-mail confirmado. Verificando seu acesso...')
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível concluir.') }
    finally { setBusy(false) }
  }

  async function resendCode() {
    if (!supabase) return
    setBusy(true); setError('')
    try {
      const result = purpose === 'recover'
        ? await supabase.auth.resetPasswordForEmail(email.trim())
        : purpose === 'signup'
          ? await supabase.auth.resend({ type: 'signup', email: email.trim() })
          : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
      if (result.error) throw result.error
      setMessage('Enviamos um novo código.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível reenviar.') }
    finally { setBusy(false) }
  }

  return <main className="auth-shell">
    <header className="auth-top"><a className="brand" href="#">🎃 fila<span>do</span>halloween</a><button className="theme-toggle" onClick={onToggleTheme}>{theme === 'dark' ? '☀️ Tema claro' : '🌙 Tema escuro'}</button></header>
    <section className="auth-card">
      <div className="auth-art"><span>☾</span><b>🎃</b><i>✦</i></div>
      <small className="eyebrow">SUA NOITE, SEM ESPERA</small>
      <h1>{step === 'signup' ? 'Entre para a fila' : step === 'recover' ? 'Vamos recuperar' : step === 'verify' ? 'Confira seu e-mail' : 'A magia começa aqui'}</h1>
      <p className="description">{step === 'signup' ? 'Crie sua conta e aguarde a aprovação da equipe.' : step === 'recover' ? 'Enviaremos um código para você criar uma nova senha.' : step === 'verify' ? 'Digite o código enviado para ' + email : 'Acesse sua conta para acompanhar eventos especiais.'}</p>
      {step !== 'verify' ? <div className="tabs"><button className={step === 'login' ? 'active' : ''} onClick={() => { setStep('login'); setError(''); setMessage('') }}>Entrar</button><button className={step === 'signup' ? 'active' : ''} onClick={() => { setStep('signup'); setError(''); setMessage('') }}>Criar conta</button></div> : <div className="verify-caption">✉️ Código de verificação</div>}
      <form className="form" onSubmit={submit}>
        {step === 'signup' && <>
          <label>Seu nome<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Como podemos te chamar?" required /></label>
          <label>CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} maxLength={14} placeholder="000.000.000-00" required /></label>
          <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /><small>Escolha o país. O telefone será salvo no padrão internacional.</small></label>
        </>}
        {(step === 'login' || step === 'signup' || step === 'recover') && <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="voce@email.com" required /></label>}
        {step === 'login' && passwordMode && <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Sua senha" required /></label>}
        {step === 'signup' && <>
          <label>Crie uma senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Escolha uma senha segura" required aria-describedby="password-rules" /></label>
          <ul className="password-rules" id="password-rules" aria-live="polite">
            {passwordRules.map((rule) => <li key={rule.label} className={rule.test(password) ? 'valid' : ''}><span>{rule.test(password) ? '✓' : '○'}</span>{rule.label}</li>)}
          </ul>
          <label>Confirme sua senha<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Digite a senha novamente" required aria-invalid={Boolean(confirmPassword) && password !== confirmPassword} /></label>
          {confirmPassword && <div className={password === confirmPassword ? 'password-match valid' : 'password-match'}>{password === confirmPassword ? '✓ As senhas coincidem.' : 'As senhas ainda não coincidem.'}</div>}
        </>}
        {step === 'verify' && <>
          <label>Código de 6 dígitos<input className="otp" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(e) => setToken(e.target.value.replace(/\s/g, ''))} placeholder="000000" required /></label>
          {purpose === 'recover' && <label>Nova senha<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} autoComplete="new-password" required /></label>}
        </>}
        {message && <div className="notice">{message}</div>}{error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Só um instante...' : step === 'login' ? (passwordMode ? 'Entrar na conta' : 'Enviar código por e-mail') : step === 'signup' ? 'Criar conta e enviar código' : step === 'recover' ? 'Enviar código de recuperação' : purpose === 'recover' ? 'Redefinir senha' : 'Confirmar código'}<span>→</span></button>
      </form>
      {step === 'login' && <div className="auth-links"><button onClick={() => setPasswordMode(!passwordMode)}>{passwordMode ? 'Entrar com código por e-mail' : 'Entrar com senha'}</button><button onClick={() => { setStep('recover'); setError(''); setMessage('') }}>Esqueci minha senha</button></div>}
      {step === 'verify' && <div className="auth-links"><button disabled={busy} onClick={() => void resendCode()}>Reenviar código</button><button onClick={() => setStep(purpose === 'signup' ? 'signup' : 'login')}>Voltar</button></div>}
      {step === 'recover' && <div className="auth-links"><button onClick={() => setStep('login')}>Voltar para entrar</button></div>}
      <footer className="auth-footer">🦇 Uma experiência encantadoramente organizada</footer>
    </section>
    <div className="auth-bottom">Feito para noites especiais · Fila Digital</div>
  </main>
}

