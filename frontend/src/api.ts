import type { CardsResponse, CardFilters, Card, Set, CollectionStats, PriceResult, RefreshPricesResult } from './types'

const BASE = import.meta.env.VITE_API_URL || (import.meta.env.BASE_URL.replace(/\/$/, '') + '/api')

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Error del servidor')
  return data as T
}

export const api = {
  getSets: (lang?: 'en' | 'jp' | '') =>
    apiFetch<Set[]>(`/sets${lang ? '?lang=' + lang : ''}`),

  getCards: (filters: CardFilters = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v))
    })
    const qs = params.toString()
    return apiFetch<CardsResponse>(`/cards${qs ? '?' + qs : ''}`)
  },

  getCard: (code: string) => apiFetch<Card>(`/cards/${code}`),

  getCollectionStats: () => apiFetch<CollectionStats>('/collection/stats'),

  getCollection: (filters: CardFilters = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v))
    })
    const qs = params.toString()
    return apiFetch<CardsResponse>(`/collection${qs ? '?' + qs : ''}`)
  },

  addToCollection: (card_code: string, language: 'en' | 'jp', quantity = 1, condition = 'NM') =>
    apiFetch<{ success: boolean; message: string; collection_id: number }>(
      '/collection',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_code, language, quantity, condition }),
      }
    ),

  updateCollection: (card_code: string, language: 'en' | 'jp', quantity: number, condition?: string) =>
    apiFetch<{ success: boolean; message: string }>(
      `/collection/${card_code}/${language}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, condition }),
      }
    ),

  removeFromCollection: (card_code: string, language: 'en' | 'jp') =>
    apiFetch<{ success: boolean; message: string }>(
      `/collection/${card_code}/${language}`,
      { method: 'DELETE' }
    ),

  getPrice: (card_code: string) => apiFetch<PriceResult>(`/price/${card_code}`),

  refreshPrices: () => apiFetch<RefreshPricesResult>('/collection/refresh-prices', { method: 'POST' }),

  ocr: async (imageBase64: string): Promise<{ text: string; blocks: { text: string; confidence: number | null }[] }> => {
    const res = await fetch(`${BASE}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
    })
    const raw = await res.text()
    let data: { text: string; blocks: { text: string; confidence: number | null }[]; error?: string }
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`Respuesta no-JSON del servidor:\n${raw.slice(0, 800)}`)
    }
    if (!res.ok) throw new Error(data.error || 'Error del servidor')
    return data
  },
}
