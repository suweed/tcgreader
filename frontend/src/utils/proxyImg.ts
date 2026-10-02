const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.BASE_URL.replace(/\/$/, '') + '/api')

/** Proxies card images through our backend to avoid Cross-Origin-Resource-Policy blocks */
export function proxyImg(url: string | null | undefined): string | null {
  if (!url) return null
  return `${API_BASE}/img?u=${encodeURIComponent(url)}`
}
