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
    {profile.status === 'ativo' && <section className="account-deactivation">
      <h3>Excluir conta</h3><p>Esta ação não apaga seus dados: apenas inativa seu perfil e encerra sua sessão. Para voltar, peça a reativação a um administrador.</p>
      <button type="button" className="danger-outline" disabled={deactivating} onClick={() => void deactivateAccount()}>{deactivating ? 'Inativando...' : 'Excluir conta'}</button>
    </section>}
  </section>
}

