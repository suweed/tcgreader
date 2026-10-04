import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../api'
import type { Card, CardFilters, Set } from '../types'
import CardItem from './CardItem'

interface Props {
  initialFilters?: CardFilters
  showOwnedToggle?: boolean
  collectionMode?: boolean
  initialQ?: string
  forceCategory?: string
  onCollectionChange?: () => void
}

export default function CardGrid({ initialFilters = {}, showOwnedToggle = true, collectionMode = false, initialQ, forceCategory, onCollectionChange }: Props) {
  const [cards, setCards] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<CardFilters>({ limit: 48, ...initialFilters, ...(initialQ ? { q: initialQ } : {}) })
  const [sets, setSets] = useState<Set[]>([])
  const [search, setSearch] = useState(initialQ ?? '')
  const [lang, setLang] = useState<'en' | 'jp' | ''>('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    api.getSets(lang || undefined).then(setSets)
  }, [lang])

  const loadCards = useCallback(async (f: CardFilters) => {
    setLoading(true)
    try {
      const finalFilters = forceCategory ? { ...f, category: forceCategory } : f
      const res = await api.getCards(finalFilters)
      setCards(res.data)
      setTotal(res.total)
      setPages(res.pages)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCards({ ...filters, page })
  }, [filters, page, loadCards])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setFilters((f) => ({ ...f, q: search || undefined }))
  }

  // Búsqueda automática con debounce al escribir 2+ caracteres
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (search.length === 0 || search.length >= 2) {
        setPage(1)
        setFilters((f) => ({ ...f, q: search || undefined }))
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  function handleFilter(key: keyof CardFilters, value: string | number | undefined) {
    setPage(1)
    // En modo álbum, sincronizar owned↔lang/owned_lang al cambiar el filtro owned
    if (key === 'owned' && !collectionMode) {
      const newOwned = ((value as string) || undefined) as 'true' | 'false' | undefined
      setFilters((f) => {
        const updated: CardFilters = { ...f, owned: newOwned }
        if (newOwned === 'true' && f.lang) {
          // owned=true con lang activo → convertir a owned_lang
          updated.owned_lang = f.lang as 'en' | 'jp'
          updated.lang = undefined
        } else if (newOwned !== 'true' && f.owned_lang) {
          // owned cleared o false con owned_lang activo → restaurar lang
          updated.lang = f.owned_lang
          updated.owned_lang = undefined
        }
        return updated
      })
      return
    }
    setFilters((f) => ({ ...f, [key]: value || undefined }))
  }

  function handleLangChange(value: 'en' | 'jp' | '') {
    setLang(value)
    setPage(1)
    if (collectionMode) {
      // En Mi Colección: filtra por idioma que posees (col_en / col_jp)
      setFilters((f) => ({ ...f, lang: undefined, owned_lang: value || undefined, set: undefined }))
    } else {
      // En Álbum: si owned=true, filtra por idioma poseído; si no, por locale disponible
      setFilters((f) => {
        if (f.owned === 'true' && value) {
          return { ...f, lang: undefined, owned_lang: value as 'en' | 'jp', set: undefined }
        }
        return { ...f, lang: value || undefined, owned_lang: undefined, set: undefined }
      })
    }
  }

  function applyPriceFilter() {
    setPage(1)
    setFilters((f) => ({
      ...f,
      price_min: priceMin ? parseFloat(priceMin) : undefined,
      price_max: priceMax ? parseFloat(priceMax) : undefined,
    }))
  }

  const selectClass = 'bg-slate-700 text-white rounded px-2 py-1.5 text-sm'
  const inputClass = 'bg-slate-700 text-white rounded px-2 py-1.5 text-sm w-24 outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div>
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre (EN/JP)…"
          className="flex-1 bg-slate-700 text-white rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className={`px-3 py-2 rounded text-sm font-bold transition-colors ${showAdvanced ? 'bg-slate-500 text-white' : 'bg-slate-700 text-slate-300 hover:text-white'}`}
          title="Filtros"
        >
          ···
        </button>
      </form>

      {/* Filters panel (collapsible) */}
      {showAdvanced && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 mb-3 space-y-3">

          {/* Language toggle */}
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-slate-500 mr-1">Idioma:</span>
            {(['', 'en', 'jp'] as const).map((l) => (
              <button
                key={l}
                onClick={() => handleLangChange(l)}
                className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                  lang === l
                    ? l === 'en' ? 'bg-green-600 text-white'
                    : l === 'jp' ? 'bg-blue-600 text-white'
                    : 'bg-slate-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {l === '' ? 'Todos' : (
                  <span className="flex items-center gap-1.5">
                    <img
                      src={l === 'en' ? 'https://flagcdn.com/us.svg' : 'https://flagcdn.com/jp.svg'}
                      alt={l.toUpperCase()}
                      className="w-5 h-3.5 object-cover rounded-sm"
                    />
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Basic filters */}
          <div className="flex flex-wrap gap-2 overflow-x-hidden">
            <select
              onChange={(e) => handleFilter('set', e.target.value)}
              value={filters.set ?? ''}
              className={selectClass + ' max-w-[calc(100vw-2rem)] sm:max-w-xs'}
            >
              <option value="">Todos los sets</option>
              {sets.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} – {s.raw_title.slice(0, 28)}
                </option>
              ))}
            </select>

            <select onChange={(e) => handleFilter('color', e.target.value)} className={selectClass}>
              <option value="">Color</option>
              {['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Black'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>

            <select onChange={(e) => handleFilter('rarity', e.target.value)} className={selectClass}>
              <option value="">Rareza</option>
              {[
                { value: 'Common',       label: 'Common' },
                { value: 'Uncommon',     label: 'Uncommon' },
                { value: 'Rare',         label: 'Rare' },
                { value: 'SuperRare',    label: 'Super Rare' },
                { value: 'SecretRare',   label: 'Secret Rare' },
                { value: 'TreasureRare', label: 'Treasure Rare' },
                { value: 'Special',      label: 'Special' },
                { value: 'Leader',       label: 'Leader' },
                { value: 'Promo',        label: 'Promo' },
              ].map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {showOwnedToggle && (
              <select onChange={(e) => handleFilter('owned', e.target.value)} className={selectClass}>
                <option value="">Todas</option>
                <option value="true">Solo poseídas</option>
                <option value="false">Sin poseer</option>
              </select>
            )}

            <select
              onChange={(e) => handleFilter('sort', e.target.value)}
              value={filters.sort ?? (collectionMode || forceCategory === 'DON!!' ? 'newest' : '')}
              className={selectClass + ' ml-auto'}
            >
              <option value="newest">Agregadas: más recientes</option>
              <option value="oldest">Agregadas: más antiguas</option>
              <option value="">Set A→Z</option>
              <option value="set_desc">Set Z→A</option>
              <option value="name_asc">Nombre A→Z</option>
              <option value="name_desc">Nombre Z→A</option>
            </select>
          </div>

          {/* Advanced filters */}
          <div className="flex flex-wrap gap-4">
            {!forceCategory && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Categoría</label>
                <select onChange={(e) => handleFilter('category', e.target.value)} className={selectClass}>
                  <option value="">Todas</option>
                  {['Character', 'Event', 'Stage', 'Leader'].map((cat) => (
                    <option key={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Coste</label>
              <div className="flex gap-1 items-center">
                <input type="number" min="0" max="10" placeholder="Min" className={inputClass}
                  onChange={(e) => handleFilter('cost_min', e.target.value ? parseInt(e.target.value) : undefined)} />
                <span className="text-slate-400 text-xs">–</span>
                <input type="number" min="0" max="10" placeholder="Max" className={inputClass}
                  onChange={(e) => handleFilter('cost_max', e.target.value ? parseInt(e.target.value) : undefined)} />
              </div>
            </div>

            {collectionMode && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Precio USD</label>
                <div className="flex gap-1 items-center">
                  <input type="number" min="0" step="0.01" placeholder="Min" value={priceMin} className={inputClass}
                    onChange={(e) => setPriceMin(e.target.value)} />
                  <span className="text-slate-400 text-xs">–</span>
                  <input type="number" min="0" step="0.01" placeholder="Max" value={priceMax} className={inputClass}
                    onChange={(e) => setPriceMax(e.target.value)} />
                  <button onClick={applyPriceFilter}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1.5 rounded text-xs font-medium">
                    OK
                  </button>
                </div>
              </div>
            )}

            {collectionMode && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Agregado a colección</label>
                <div className="flex gap-1 items-center flex-wrap">
                  <input type="date" className={inputClass + ' w-36'}
                    onChange={(e) => handleFilter('date_from', e.target.value)} />
                  <span className="text-slate-400 text-xs">–</span>
                  <input type="date" className={inputClass + ' w-36'}
                    onChange={(e) => handleFilter('date_to', e.target.value)} />
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      <p className="text-slate-400 text-sm mb-3">
        {loading ? 'Cargando…' : `${total} carta${total !== 1 ? 's' : ''}`}
      </p>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {cards.map((card) => (
          <CardItem
            key={card.card_code}
            card={card}
            lang={lang}
            onCollectionChange={() => {
              loadCards({ ...filters, page })
              onCollectionChange?.()
            }}
          />
        ))}
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40 text-sm hover:bg-slate-600">
            ‹ Anterior
          </button>
          <span className="px-3 py-1 text-slate-300 text-sm">{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40 text-sm hover:bg-slate-600">
            Siguiente ›
          </button>
        </div>
      )}
    </div>
  )
}
