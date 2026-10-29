import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '../../types'

type Props = { user: User; profile: Profile | null; error: string; themeToggle: ReactNode; onReload: () => void; onLogout: () => void }

export default function ApprovalPage({ user, profile, error, themeToggle, onReload, onLogout }: Props) {
  return <main className="wait-shell">
    <header className="wait-top"><a className="brand" href="#">🎃 fila<span>do</span>halloween</a>{themeToggle}</header>
    <section className="wait-card">
      <div>🔮</div><small className="eyebrow">ACESSO EM ANÁLISE</small><h1>Aguarde a aprovação</h1>
      <p>Seu cadastro foi recebido. Um administrador precisa aprovar seu perfil para liberar o painel.</p>
      <article><b>{(profile?.nome ?? user.email ?? 'U')[0].toUpperCase()}</b><span>{profile?.nome ?? user.email}</span><small>Em análise</small></article>
      {error && <div className="error">{error}</div>}
      <button className="secondary" onClick={onReload}>Verificar novamente</button>
      <button className="text-button" onClick={onLogout}>Sair da conta</button>
    </section>
  </main>
}

