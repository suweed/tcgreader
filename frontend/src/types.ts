export interface CardLocale {
  name: string
  effect: string | null
  trigger: string | null
  img_url: string | null
}

export interface CardOwned {
  quantity: number
  condition: string
  price_usd?: number | null
}

export interface Card {
  card_code: string
  set_code: string
  set_name: string
  category: string
  rarity: string
  cost: number | null
  power: number | null
  counter: number | null
  colors: string[]
  attributes: string[]
  types: string[]
  locales: {
    en: CardLocale | null
    jp: CardLocale | null
  }
  owned: {
    en: CardOwned | null
    jp: CardOwned | null
  }
}

export interface Set {
  id: number
  code: string
  raw_title: string
  total_cards: number
  imported_cards: number
}

export interface CollectionStats {
  total_owned: number
  total_cards: number
  total_sets: number
  cards_with_en: number
  cards_with_jp: number
  total_value_usd: number | null
  priced_cards: number
  total_en: number
  total_jp: number
}

export interface RefreshPricesResult {
  updated: number
  skipped: number
  errors: number
  total_usd: number | null
}

export interface PriceResult {
  id: string
  name: string
  number: string
  rarity: string
  variant: string
  image_url: string | null
  set: { name: string; slug: string }
  prices: {
    raw: {
      near_mint?: { tcgplayer?: { market?: number; low?: number; mid?: number; high?: number } }
      lightly_played?: { tcgplayer?: { market?: number; low?: number; mid?: number; high?: number } }
    }
  }
  _cached: boolean
  _cached_at: number
}

export interface CardsResponse {
  data: Card[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface CardFilters {
  q?: string
  set?: string
  color?: string
  category?: string
  rarity?: string
  type?: string
  lang?: 'en' | 'jp' | ''
  owned_lang?: 'en' | 'jp'
  cost_min?: number
  cost_max?: number
  price_min?: number
  price_max?: number
  date_from?: string
  date_to?: string
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'set_desc'
  owned?: 'true' | 'false'
  page?: number
  limit?: number
}

export interface CreateCustomCardPayload {
  card_code?: string
  name: string
  set_id?: number
  category?: string
  rarity?: string
  language?: 'en' | 'jp'
  img_base64?: string
  effect?: string
  cost?: number | null
  power?: number | null
  descriptors?: string
  rows_count?: number
}

export interface CreateCustomCardResponse {
  success: boolean
  card_code: string
  category: string
  is_don: boolean
  error?: string
}

