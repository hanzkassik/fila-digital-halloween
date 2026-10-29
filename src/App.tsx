import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import type { Profile } from './types'
import ThemeToggle from './components/ThemeToggle'
import AuthPage from './pages/auth/AuthPage'
import ApprovalPage from './pages/approval/ApprovalPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import PublicEventPage from './pages/public/PublicEventPage'

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [theme, setTheme] = useState(() => localStorage.getItem('fila-theme') === 'light' ? 'light' : 'dark')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('fila-theme', theme)
  }, [theme])

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to)
    else if (window.location.pathname !== to) window.history.pushState(null, '', to)
    setPathname(to)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  const loadProfile = useCallback(async (authUser: User | null) => {
    if (!supabase || !authUser) { setProfile(null); return }
    const { data, error: profileError } = await supabase.from('profiles')
      .select('id,nome,email,papel,status,telefone,cpf,data_nascimento').eq('id', authUser.id).maybeSingle()
    if (profileError) setError(profileError.message)
    setProfile(data as Profile | null)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      const currentUser = data.session?.user ?? null
      setUser(currentUser)
      await loadProfile(currentUser)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) window.setTimeout(() => void loadProfile(currentUser), 0)
      else setProfile(null)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [loadProfile])

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const logout = useCallback(async () => { if (supabase) await supabase.auth.signOut() }, [])
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />
  const publicEventMatch = /^\/events\/([^/]+)$/.exec(pathname.replace(/\/+$/, ''))
  const publicEventSlug = publicEventMatch ? decodeURIComponent(publicEventMatch[1]) : null
  const isUuid = publicEventSlug ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicEventSlug) : false
  const isAdminQueueRoute = Boolean(isUuid && profile?.papel === 'admin' && profile.status === 'ativo')

  if (!supabase) return <main className="setup"><header className="brand">🎃 fila<span>do</span>halloween</header><section className="setup-card"><small>QUASE PRONTO</small><h1>Conecte seu Supabase</h1><p>Configure as variáveis para ativar o acesso e o painel.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code>{themeToggle}</section></main>
  if (loading) return <main className="loading"><span>🎃</span><p>Preparando a fila...</p></main>
  if (publicEventSlug && !isAdminQueueRoute) return <PublicEventPage slug={publicEventSlug} user={user} profile={profile} theme={theme} onToggleTheme={toggleTheme} onLogout={() => void logout()} />
  if (!user) return <AuthPage theme={theme} onToggleTheme={toggleTheme} />
  if (!profile || profile.papel !== 'admin' || profile.status !== 'ativo') {
    return <ApprovalPage user={user} profile={profile} error={error} themeToggle={themeToggle} onReload={() => void loadProfile(user)} onLogout={() => void logout()} />
  }
  return <AdminDashboardPage profile={profile} themeToggle={themeToggle} pathname={pathname} navigate={navigate} onLogout={() => void logout()} onProfileUpdated={setProfile} />
}

