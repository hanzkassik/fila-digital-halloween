const baseUrl = import.meta.env.BASE_URL
const basePath = baseUrl === '/' ? '' : baseUrl.replace(/\/$/, '')

export function appPathname(pathname: string) {
  const relativePath = !basePath
    ? pathname || '/'
    : pathname === basePath || pathname === `${basePath}/`
      ? '/'
      : pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  return relativePath === '/' ? '/' : relativePath.replace(/\/+$/, '')
}

export function appUrl(path: string) {
  const normalizedPath = `/${path.replace(/^\/+/, '')}`
  return `${basePath}${normalizedPath}`
}

export function appAsset(path: string) {
  return `${baseUrl}${path.replace(/^\/+/, '')}`
}
