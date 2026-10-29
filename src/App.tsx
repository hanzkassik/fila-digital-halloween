import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import type { Profile } from './types'
import ThemeToggle from './components/ThemeToggle'
import AuthPage from './pages/auth/AuthPage'
import ApprovalPage from './pages/approval/ApprovalPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import PublicEventPage from './pages/public/PublicEventPage'
import { appPathname, appUrl } from './lib/paths'

export default function App() {
  const [pathname, setPathname] = useState(() => appPathname(window.location.pathname))
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
    const handlePopState = () => setPathname(appPathname(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((to: string, replace = false) => {
    const url = appUrl(to)
    if (replace) window.history.replaceState(null, '', url)
    else if (window.location.pathname !== url) window.history.pushState(null, '', url)
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
    const { data: listener } = supabase.auth.onAuthStateChange((authEvent, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        if (authEvent === 'SIGNED_IN' || authEvent === 'USER_UPDATED') setProfile(null)
        window.setTimeout(() => void loadProfile(currentUser), 0)
      } else setProfile(null)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [loadProfile])

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const logout = useCallback(async () => { if (supabase) await supabase.auth.signOut() }, [])
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />
  const publicEventMatch = /^\/events\/([^/]+)$/.exec(pathname.replace(/\/+$/, ''))
  const publicEventSlug = publicEventMatch ? decodeURIComponent(publicEventMatch[1]) : null
  const isUuid = publicEventSlug ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicEventSlug) : false
  const isPublicEventRoute = Boolean(publicEventSlug && !isUuid)
  const isActiveAdmin = Boolean(user && profile?.id === user.id && profile.papel === 'admin' && profile.status === 'ativo')

  useEffect(() => {
    if (loading || isPublicEventRoute) return

    if (!user && pathname !== '/auth') {
      const nextPath = pathname === '/' ? '/events' : pathname
      const authUrl = `${appUrl('/auth')}?next=${encodeURIComponent(nextPath)}`
      window.history.replaceState(null, '', authUrl)
      setPathname('/auth')
      return
    }

    if (isActiveAdmin && pathname === '/auth') {
      const requestedPath = new URLSearchParams(window.location.search).get('next')
      const safePath = requestedPath && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
        && (/^\/events$/.test(requestedPath) || /^\/events\/[0-9a-f-]{36}$/i.test(requestedPath) || /^\/users$/.test(requestedPath) || /^\/users\/[0-9a-f-]{36}$/i.test(requestedPath) || requestedPath === '/profile')
        ? requestedPath
        : '/events'
      navigate(safePath, true)
    }
  }, [loading, isPublicEventRoute, user, profile, isActiveAdmin, pathname, navigate])

  if (!supabase) return <main className="setup"><header className="brand">🎃 fila<span>do</span>halloween</header><section className="setup-card"><small>QUASE PRONTO</small><h1>Conecte seu Supabase</h1><p>Configure as variáveis para ativar o acesso e o painel.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code>{themeToggle}</section></main>
  if (loading) return <main className="loading"><span>🎃</span><p>Preparando a fila...</p></main>
  if (publicEventSlug && !isUuid) return <PublicEventPage slug={publicEventSlug} user={user} profile={profile} theme={theme} onToggleTheme={toggleTheme} onLogout={() => void logout()} />
  if (!user) return <AuthPage theme={theme} onToggleTheme={toggleTheme} />
  if (!isActiveAdmin) {
    return <ApprovalPage user={user} profile={profile?.id === user.id ? profile : null} error={error} themeToggle={themeToggle} onReload={() => void loadProfile(user)} onLogout={() => void logout()} />
  }
  if (pathname === '/auth') return <main className="loading"><span>🎃</span><p>Voltando para a página solicitada...</p></main>
  return <AdminDashboardPage profile={profile!} themeToggle={themeToggle} pathname={pathname} navigate={navigate} onLogout={() => void logout()} onProfileUpdated={setProfile} />
}

