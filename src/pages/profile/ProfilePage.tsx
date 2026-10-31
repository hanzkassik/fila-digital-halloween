import { useState, type FormEvent } from 'react'
import { isValidPhoneNumber } from 'react-phone-number-input'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types'
import { formatCpf } from '../../lib/formatters'
import PhoneNumberField from '../../components/PhoneNumberField'

type Props = { profile: Profile; onProfileUpdated: (profile: Profile) => void; onLogout: () => void }

export default function ProfilePage({ profile, onProfileUpdated, onLogout }: Props) {
  const [name, setName] = useState(profile.nome)
  const [email, setEmail] = useState(profile.email)
  const [cpf, setCpf] = useState(formatCpf(profile.cpf ?? ''))
  const [phone, setPhone] = useState<string | undefined>(profile.telefone ?? undefined)
  const [birthDate, setBirthDate] = useState(profile.data_nascimento ?? '')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  const passwordRules = [
    { label: 'Pelo menos 8 caracteres', test: (value: string) => value.length >= 8 },
    { label: 'Uma letra maiúscula', test: (value: string) => /[A-Z]/.test(value) },
    { label: 'Uma letra minúscula', test: (value: string) => /[a-z]/.test(value) },
    { label: 'Um número', test: (value: string) => /\d/.test(value) },
    { label: 'Um caractere especial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
  ]

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setError(''); setMessage('')
    const cpfDigits = cpf.replace(/\D/g, '')
    if (cpfDigits && cpfDigits.length !== 11) { setError('Se informar o CPF, use 11 dígitos.'); return }
    if (!phone || !isValidPhoneNumber(phone)) { setError('Informe um telefone válido para o país escolhido.'); return }

    setBusy(true)
    try {
      const { data, error: updateError } = await supabase.from('profiles')
        .update({ nome: name.trim(), cpf: cpfDigits || null, telefone: phone, data_nascimento: birthDate || null })
        .eq('id', profile.id)
        .select('id,nome,email,papel,status,telefone,cpf,data_nascimento')
        .single()
      if (updateError) throw updateError
      onProfileUpdated(data as Profile)

      const newEmail = email.trim().toLowerCase()
      if (newEmail && newEmail !== profile.email.toLowerCase()) {
        const { error: emailError } = await supabase.auth.updateUser({ email: newEmail })
        if (emailError) throw emailError
        setMessage('Dados salvos. Enviamos uma confirmação para o novo e-mail. O endereço do perfil será atualizado após a confirmação.')
      } else {
        setEmail(profile.email)
        setMessage('Seu perfil foi atualizado.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o perfil.')
    } finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setPasswordError('')
    setPasswordMessage('')
    if (passwordRules.some((rule) => !rule.test(newPassword))) {
      setPasswordError('A senha ainda não atende a todos os requisitos.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('A senha e a confirmação precisam ser iguais.')
      return
    }

    setPasswordBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Sua senha foi alterada com sucesso.')
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Não foi possível alterar sua senha.')
    } finally { setPasswordBusy(false) }
  }

  async function deactivateAccount() {
    if (!supabase || !window.confirm('Excluir conta? Seus dados não serão apagados: seu perfil será apenas inativado e você será desconectado.')) return
    setDeactivating(true)
    setError(''); setMessage('')
    const { data: deactivated, error: deactivateError } = await supabase.from('profiles')
      .update({ status: 'inativo' })
      .eq('id', profile.id)
      .select('id')
      .maybeSingle()
    setDeactivating(false)
    if (deactivateError || !deactivated) {
      setError('Não foi possível inativar sua conta. Tente novamente ou fale com um administrador.')
      return
    }
    onLogout()
  }

  return <section className="profile-page">
    <div className="profile-intro"><span className="profile-avatar">{profile.nome[0]?.toUpperCase()}</span><div><h2>Meu perfil</h2><p>Atualize seus dados pessoais e de acesso.</p></div></div>
    <form className="profile-form" onSubmit={save}>
      <label>Nome<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>CPF (opcional)<input inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" /></label>
      <label>Data de nascimento<input type="date" max={new Date().toISOString().slice(0, 10)} autoComplete="bday" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /><small>Opcional.</small></label>
      <label>Telefone<PhoneNumberField value={phone} onChange={setPhone} /><small>Escolha o país; será salvo no padrão internacional.</small></label>
      <label>E-mail de acesso<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><small>Se alterar o e-mail, será necessário confirmá-lo antes de atualizar o acesso.</small></label>
      <div className="profile-note"><span>🛡️</span><p>Seu papel é protegido. Para encerrar o acesso, use “Excluir conta”; isso apenas inativa o perfil e não apaga seus dados.</p></div>
      {error && <div className="error">{error}</div>}{message && <div className="notice">{message}</div>}
      <button className="primary profile-save" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button>
    </form>
    <section className="account-password">
      <h3>Alterar senha</h3>
      <p>Escolha uma senha nova para acessar sua conta.</p>
      <form className="profile-form password-form" onSubmit={changePassword}>
        <label>Nova senha<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required aria-describedby="profile-password-rules" /></label>
        <ul className="password-rules" id="profile-password-rules" aria-live="polite">
          {passwordRules.map((rule) => <li key={rule.label} className={rule.test(newPassword) ? 'valid' : ''}><span>{rule.test(newPassword) ? '✓' : '○'}</span>{rule.label}</li>)}
        </ul>
        <label>Confirme a nova senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required aria-invalid={Boolean(confirmPassword) && newPassword !== confirmPassword} /></label>
        {confirmPassword && <div className={newPassword === confirmPassword ? 'password-match valid' : 'password-match'}>{newPassword === confirmPassword ? '✓ As senhas coincidem.' : 'As senhas ainda não coincidem.'}</div>}
        {passwordError && <div className="error">{passwordError}</div>}{passwordMessage && <div className="notice">{passwordMessage}</div>}
        <button className="primary profile-save" disabled={passwordBusy}>{passwordBusy ? 'Alterando...' : 'Alterar senha'}</button>
      </form>
    </section>
    {profile.status === 'ativo' && <section className="account-deactivation">
      <h3>Excluir conta</h3><p>Esta ação não apaga seus dados: apenas inativa seu perfil e encerra sua sessão. Para voltar, peça a reativação a um administrador.</p>
      <button type="button" className="danger-outline" disabled={deactivating} onClick={() => void deactivateAccount()}>{deactivating ? 'Inativando...' : 'Excluir conta'}</button>
    </section>}
  </section>
}

