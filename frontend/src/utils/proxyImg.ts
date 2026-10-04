const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.BASE_URL.replace(/\/$/, '') + '/api')

/** Proxies card images through our backend to avoid Cross-Origin-Resource-Policy blocks.
 *  `forCanvas`: fuerza el proxy (necesario para leer píxeles en OpenCV sin "tainted canvas"). */
export function proxyImg(url: string | null | undefined, forCanvas = false): string | null {
  if (!url) return null
  if (url.startsWith('data:')) return url
  if (!forCanvas && url.includes('optcgapi.com')) return url
  return `${API_BASE}/img?u=${encodeURIComponent(url)}`
}
