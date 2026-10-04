import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Card, PriceResult } from '../types'
import { proxyImg } from '../utils/proxyImg'
import { useSettings } from '../context/SettingsContext'
import RegisterCardModal from './RegisterCardModal'

interface Props {
  cardCode: string
  onClose: () => void
  onCollectionChange?: () => void
  initialLang?: 'en' | 'jp'
}

export default function CardModal({ cardCode, onClose, onCollectionChange, initialLang }: Props) {
  const [card, setCard] = useState<Card | null>(null)
  const [price, setPrice] = useState<PriceResult | null>(null)
  const [lang, setLang] = useState<'en' | 'jp'>(initialLang || 'en')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<'en' | 'jp' | null>(null)
  const { usdToMxn } = useSettings()
  const [zoomOpen, setZoomOpen]= useState(false)
  const [lensPos, setLensPos] = useState<{ x: number; y: number; iw: number; ih: number } | null>(null)
  const zoomImgRef = useRef<HTMLImageElement>(null)

  const [editPriceMode, setEditPriceMode] = useState(false)
  const [editPriceVal, setEditPriceVal] = useState('')
  const [editPriceCur, setEditPriceCur] = useState<'USD'|'MXN'>('USD')
  const [savingPrice, setSavingPrice] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)

  useEffect(() => {
    api.getCard(cardCode).then((c) => {
      setCard(c)
      setLang(prev => c.locales[prev] ? prev : (c.locales.en ? 'en' : 'jp'))
      setLoading(false)
    })
    api.getPrice(cardCode).then(setPrice).catch(() => {})
  }, [cardCode])

  async function handleSavePrice() {
    const val = parseFloat(editPriceVal)
    if (isNaN(val) || val < 0) return
    setSavingPrice(true)
    const usdVal = editPriceCur === 'MXN' ? val / usdToMxn : val
    try {
      const newPrice = await api.setPrice(cardCode, usdVal)
      setPrice(newPrice)
      setEditPriceMode(false)
      onCollectionChange?.()
    } finally {
      setSavingPrice(false)
    }
  }

  async function handleAdd(language: 'en' | 'jp') {
    if (!card) return
    setAdding(language)
    try {
      await api.addToCollection(card.card_code, language)
      onCollectionChange?.()
      onClose()
    } finally {
      setAdding(null)
    }
  }

  async function handleRemove(language: 'en' | 'jp') {
    if (!card) return
    setAdding(language)
    try {
      await api.removeFromCollection(card.card_code, language)
      onCollectionChange?.()
      onClose()
    } finally {
      setAdding(null)
    }
  }

  const isCustomCard = Boolean(
    card && (
      card.card_code.startsWith('CIM-') ||
      card.set_code === 'PROMO-ALT' ||
      card.rarity === 'Custom' ||
      card.locales.en?.img_url?.startsWith('data:') ||
      card.locales.jp?.img_url?.startsWith('data:')
    )
  )

  const locale = card?.locales[lang] ?? card?.locales.en ?? card?.locales.jp

  function handleLensMove(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setLensPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      iw: rect.width,
      ih: rect.height,
    })
  }

  const rarityColor: Record<string, string> = {
    Common:       'bg-slate-600 text-slate-200',
    Uncommon:     'bg-green-800 text-green-200',
    Rare:         'bg-blue-800 text-blue-200',
    SuperRare:    'bg-purple-800 text-purple-200',
    SecretRare:   'bg-amber-700 text-amber-100',
    TreasureRare: 'bg-orange-700 text-orange-100',
    Special:      'bg-pink-800 text-pink-200',
    Leader:       'bg-cyan-800 text-cyan-200',
    Promo:        'bg-rose-800 text-rose-200',
  }

  const ZOOM_FACTOR = 2.5
  const LENS_SIZE = 130

  return (
    <>
    {/* Zoom overlay */}
    {zoomOpen && locale?.img_url && (
      <div
        className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center"
        onClick={() => { setZoomOpen(false); setLensPos(null) }}
      >
        <button
          onClick={() => { setZoomOpen(false); setLensPos(null) }}
          className="absolute top-4 right-4 text-white text-2xl font-bold bg-slate-800/70 w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-700 z-10"
        >✕</button>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <img
            ref={zoomImgRef}
            src={proxyImg(locale.img_url)!}
            alt={locale.name}
            className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl cursor-crosshair select-none"
            onMouseMove={handleLensMove}
            onMouseLeave={() => setLensPos(null)}
            draggable={false}
          />
          {lensPos && (
            <div
              style={{
                position: 'absolute',
                left: lensPos.x - LENS_SIZE / 2,
                top: lensPos.y - LENS_SIZE / 2,
                width: LENS_SIZE,
                height: LENS_SIZE,
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.85)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 4px 20px rgba(0,0,0,0.7)',
                overflow: 'hidden',
                pointerEvents: 'none',
                backgroundImage: `url(${proxyImg(locale.img_url)})`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${lensPos.iw * ZOOM_FACTOR}px ${lensPos.ih * ZOOM_FACTOR}px`,
                backgroundPosition: `${-(lensPos.x * ZOOM_FACTOR - LENS_SIZE / 2)}px ${-(lensPos.y * ZOOM_FACTOR - LENS_SIZE / 2)}px`,
              }}
            />
          )}
        </div>
        <p className="absolute bottom-5 left-0 right-0 text-center text-slate-500 text-xs">Mueve el ratón para explorar · Clic fuera para cerrar</p>
      </div>
    )}
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Cargando…</div>
        ) : !card ? (
          <div className="p-8 text-center text-red-400">Error al cargar</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b border-slate-700">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono text-slate-400">{card.card_code}</span>
                  <span className="text-xs text-slate-500">{card.set_name}</span>
                </div>
                <h2 className="font-bold text-white mt-0.5">
                  {(card.locales[lang]?.name ?? card.locales.en?.name ?? card.locales.jp?.name)?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}
                </h2>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${rarityColor[card.rarity] ?? 'bg-slate-600 text-slate-200'}`}>
                    {card.rarity}
                  </span>
                  {(Array.isArray(card.types) ? card.types : []).map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{t}</span>
                  ))}
                  {(Array.isArray(card.colors) ? card.colors : []).map((c) => (
                    <span key={c} className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{c}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {isCustomCard && (
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(true)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-yellow-300 font-semibold px-2.5 py-1.5 rounded-lg border border-slate-600 flex items-center gap-1 transition-colors shadow-sm"
                    title="Editar información y foto de esta tarjeta custom"
                  >
                    <span>✏️</span>
                    <span>Editar</span>
                  </button>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-white text-xl font-bold p-1">✕</button>
              </div>
            </div>

            {/* Lang tabs */}
            <div className="flex gap-2 p-3 border-b border-slate-700">
              {card.locales.en ? (
                <button
                  onClick={() => setLang('en')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-semibold ${lang === 'en' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  <img src="https://flagcdn.com/us.svg" alt="US" className="w-5 h-3.5 object-cover rounded-sm" />
                </button>
              ) : (
                <span className="px-3 py-1 rounded text-sm bg-slate-800 text-slate-600 line-through">EN</span>
              )}
              {card.locales.jp ? (
                <button
                  onClick={() => setLang('jp')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm font-semibold ${lang === 'jp' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  <img src="https://flagcdn.com/jp.svg" alt="JP" className="w-5 h-3.5 object-cover rounded-sm" />
                </button>
              ) : (
                <span className="px-3 py-1 rounded text-sm bg-slate-800 text-slate-600 line-through">JP</span>
              )}
            </div>

            {/* Image */}
            {locale?.img_url && (
              <div className="flex justify-center px-4">
                <div
                  className="relative cursor-zoom-in group"
                  onClick={() => setZoomOpen(true)}
                >
                  <img src={proxyImg(locale.img_url)!} alt={locale.name} className="max-h-72 rounded-lg shadow" />
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors">
                    <span className="text-white text-4xl opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg">🔍</span>
                  </div>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 p-4 text-center text-sm">
              {card.cost !== null && (
                <div className="bg-slate-700 rounded p-2">
                  <p className="text-slate-400 text-xs">Coste</p>
                  <p className="font-bold text-white">{card.cost}</p>
                </div>
              )}
              {card.power !== null && (
                <div className="bg-slate-700 rounded p-2">
                  <p className="text-slate-400 text-xs">Poder</p>
                  <p className="font-bold text-white">{card.power}</p>
                </div>
              )}
              {card.counter !== null && (
                <div className="bg-slate-700 rounded p-2">
                  <p className="text-slate-400 text-xs">Counter</p>
                  <p className="font-bold text-white">{card.counter}</p>
                </div>
              )}
            </div>

            {/* Effect */}
            {locale?.effect && (
              <div className="px-4 pb-2">
                <p className="text-xs text-slate-400 mb-1">Efecto</p>
                <p className="text-sm text-slate-200 bg-slate-700/50 rounded p-2">{locale.effect}</p>
              </div>
            )}
            {locale?.trigger && (
              <div className="px-4 pb-2">
                <p className="text-xs text-slate-400 mb-1">Trigger</p>
                <p className="text-sm text-slate-200 bg-slate-700/50 rounded p-2">{locale.trigger}</p>
              </div>
            )}

            {/* Prices */}
            <div className="px-4 pb-2 mt-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-400">
                  {price && price.prices?.raw ? `Precio TCGPlayer ${price._cached ? '(caché)' : '(actualizado)'}` : 'Precio de mercado'}
                </p>
                {!editPriceMode && (
                  <button onClick={() => setEditPriceMode(true)} className="text-xs text-blue-400 hover:text-blue-300">
                    ✎ Editar
                  </button>
                )}
              </div>

              {editPriceMode ? (
                <div className="bg-slate-700/50 rounded p-2 mb-1 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Precio"
                    value={editPriceVal}
                    onChange={(e) => setEditPriceVal(e.target.value)}
                    className="flex-1 min-w-0 bg-slate-800 text-white rounded px-2 py-1 text-sm outline-none border border-slate-600 focus:border-blue-500"
                  />
                  <select
                    value={editPriceCur}
                    onChange={(e) => setEditPriceCur(e.target.value as any)}
                    className="bg-slate-800 text-white rounded px-1 py-1 text-sm outline-none border border-slate-600"
                  >
                    <option value="USD">USD</option>
                    <option value="MXN">MXN</option>
                  </select>
                  <button
                    onClick={handleSavePrice}
                    disabled={savingPrice || !editPriceVal}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                  >
                    {savingPrice ? '…' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => setEditPriceMode(false)}
                    className="text-slate-400 hover:text-white px-2 py-1"
                  >✕</button>
                </div>
              ) : (
                price && price.prices?.raw ? (
                  (() => {
                    const nm = price.prices.raw.near_mint?.tcgplayer
                    const lp = price.prices.raw.lightly_played?.tcgplayer
                    const rows = [
                      nm && { label: 'Near Mint', market: nm.market, low: nm.low },
                      lp && { label: 'Lightly Played', market: lp.market, low: lp.low },
                    ].filter(Boolean) as { label: string; market?: number; low?: number }[]
                    return rows.map((r, i) => {
                      const usd = r.market != null && r.market > 0 ? r.market : r.low != null && r.low > 0 ? r.low : null
                      return (
                        <div key={i} className="text-xs bg-slate-700/50 rounded p-2 mb-1 flex justify-between items-center">
                          <span className="text-slate-300">{r.label}</span>
                          <div className="text-right">
                            {usd != null ? (
                              <>
                                <span className="text-green-400 font-bold">${usd.toFixed(2)} USD</span>
                                <span className="block text-yellow-400 font-bold">${(usd * usdToMxn).toFixed(0)} MXN</span>
                              </>
                            ) : '—'}
                          </div>
                        </div>
                      )
                    })
                  })()
                ) : (
                  <p className="text-xs text-slate-500 italic bg-slate-700/50 rounded p-2">Sin precio definido</p>
                )
              )}
              {price && price.name && !editPriceMode && (
                <p className="text-xs text-slate-500 mt-1">{price.name} · {price.rarity} · {price.set?.name}</p>
              )}
            </div>

            {/* Collection buttons */}
            <div className="p-4 grid grid-cols-2 gap-3 border-t border-slate-700">
              {/* EN */}
              {card.locales.en && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleAdd('en')}
                    disabled={adding === 'en'}
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold py-2 rounded transition-colors"
                  >
                    {adding === 'en' ? '…' : (
                      <>
                        <img src="https://flagcdn.com/us.svg" alt="EN" className="w-5 h-3.5 object-cover rounded-sm shrink-0" />
                        {card.owned.en ? `+1 ×${card.owned.en.quantity}` : 'Agregar'}
                      </>
                    )}
                  </button>
                  {card.owned.en && (
                    <button
                      onClick={() => handleRemove('en')}
                      className="flex items-center justify-center py-1 rounded border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 transition-colors"
                      title="Quitar EN"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              )}

              {/* JP */}
              {card.locales.jp && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleAdd('jp')}
                    disabled={adding === 'jp'}
                    className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-2 rounded transition-colors"
                  >
                    {adding === 'jp' ? '…' : (
                      <>
                        <img src="https://flagcdn.com/jp.svg" alt="JP" className="w-5 h-3.5 object-cover rounded-sm shrink-0" />
                        {card.owned.jp ? `+1 ×${card.owned.jp.quantity}` : 'Agregar'}
                      </>
                    )}
                  </button>
                  {card.owned.jp && (
                    <button
                      onClick={() => handleRemove('jp')}
                      className="flex items-center justify-center py-1 rounded border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 transition-colors"
                      title="Quitar JP"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>

    {/* Modal para editar datos y foto de carta personalizada */}
    {editModalOpen && card && (
      <RegisterCardModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialCard={card}
        initialLang={lang}
        onCardUpdated={(newLang) => {
          if (newLang) setLang(newLang)
          api.getCard(cardCode).then((c) => setCard(c))
          onCollectionChange?.()
        }}
      />
    )}
    </>
  )
}
