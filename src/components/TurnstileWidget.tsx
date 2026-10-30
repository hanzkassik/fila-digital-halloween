import { useEffect, useRef, useState } from 'react'

type TurnstileOptions = {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  action?: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let turnstileScript: Promise<void> | null = null

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (!turnstileScript) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]')
      const script = existing ?? document.createElement('script')
      const loaded = () => resolve()
      const failed = () => { script.remove(); reject(new Error('Não foi possível carregar o captcha.')) }
      script.addEventListener('load', loaded, { once: true })
      script.addEventListener('error', failed, { once: true })
      if (!existing) {
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.dataset.turnstileScript = 'true'
        document.head.append(script)
      }
    }).catch((error: unknown) => {
      turnstileScript = null
      throw error
    })
  }
  return turnstileScript ?? Promise.resolve()
}

type Props = { siteKey: string; onToken: (token: string | null) => void }

export default function TurnstileWidget({ siteKey, onToken }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let widgetId: string | null = null
    if (!siteKey) { setError('O captcha ainda não foi configurado.'); return }
    setError('')
    void loadTurnstileScript().then(() => {
      if (!active || !container.current || !window.turnstile) return
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'auto',
        language: 'pt-BR',
        action: 'public_queue_signup',
        callback: (token) => { if (active) onToken(token) },
        'expired-callback': () => { if (active) onToken(null) },
        'error-callback': () => { if (active) { onToken(null); setError('Não foi possível validar o captcha. Tente novamente.') } },
      })
    }).catch(() => { if (active) setError('Não foi possível carregar o captcha. Verifique sua conexão e tente novamente.') })
    return () => {
      active = false
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, onToken])

  return <div className="turnstile-wrapper">
    <div ref={container} className="turnstile-container" />
    {error && <small className="turnstile-error" role="status">{error}</small>}
  </div>
}
