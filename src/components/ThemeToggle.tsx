type ThemeToggleProps = { theme: string; onToggle: () => void }

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return <button className="theme-toggle" onClick={onToggle}>{theme === 'dark' ? '☀️ Tema claro' : '🌙 Tema escuro'}</button>
}

