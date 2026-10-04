import { useState } from 'react'
import type { Card } from '../types'
import CardModal from './CardModal'
import { proxyImg } from '../utils/proxyImg'

function decodeHtml(s?: string) {
  if (!s) return s
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
}

const COLOR_MAP: Record<string, string> = {
  Red: 'bg-red-600',
  Blue: 'bg-blue-600',
  Green: 'bg-green-600',
  Yellow: 'bg-yellow-500',
  Purple: 'bg-purple-600',
  Black: 'bg-gray-800',
}

interface Props {
  card: Card
  lang?: 'en' | 'jp' | ''
  onCollectionChange?: () => void
}

export default function CardItem({ card, lang, onCollectionChange }: Props) {
  const [showModal, setShowModal] = useState(false)
  const locale = (lang === 'en' ? card.locales.en : lang === 'jp' ? card.locales.jp : null)
    ?? card.locales.en
    ?? card.locales.jp
  const img = proxyImg(locale?.img_url)

  const hasEn = card.owned.en !== null
  const hasJp = card.owned.jp !== null

  return (
    <>
      <div
        className="relative cursor-pointer rounded-lg overflow-hidden bg-slate-800 hover:scale-105 transition-transform shadow-lg"
        onClick={() => setShowModal(true)}
      >
        {img ? (
          <img
            src={img}
            alt={locale?.name ?? card.card_code}
            className="w-full aspect-[2/3] object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full aspect-[2/3] flex items-center justify-center bg-slate-700 text-slate-400 text-xs p-2 text-center">
            {locale?.name ?? card.card_code}
          </div>
        )}

        {/* Color dots */}
        <div className="absolute top-1 left-1 flex gap-1">
          {(Array.isArray(card.colors) ? card.colors : []).map((c) => (
            <span key={c} className={`w-3 h-3 rounded-full ${COLOR_MAP[c] ?? 'bg-gray-500'}`} title={c} />
          ))}
        </div>

        {/* Owned badges */}
        <div className="absolute top-1 right-1 flex gap-1 flex-col items-end">
          {hasEn && (
            <span className="flex items-center gap-1 bg-green-600 text-white text-xs px-1 py-0.5 rounded font-bold leading-none whitespace-nowrap">
              <img src="https://flagcdn.com/us.svg" alt="EN" className="w-4 h-3 object-cover rounded-sm shrink-0" />
              {card.owned.en!.quantity}
            </span>
          )}
          {hasJp && (
            <span className="flex items-center gap-1 bg-blue-600 text-white text-xs px-1 py-0.5 rounded font-bold leading-none whitespace-nowrap">
              <img src="https://flagcdn.com/jp.svg" alt="JP" className="w-4 h-3 object-cover rounded-sm shrink-0" />
              {card.owned.jp!.quantity}
            </span>
          )}
        </div>

        {/* Rarity / code */}
        <div className="p-1.5">
          <p className="text-xs text-white truncate">{decodeHtml(locale?.name)}</p>
          <p className="text-[10px] text-slate-400 font-mono">{card.card_code}</p>
        </div>
      </div>

      {showModal && (
        <CardModal
          cardCode={card.card_code}
          onClose={() => setShowModal(false)}
          onCollectionChange={onCollectionChange}
          initialLang={(lang === 'jp' ? 'jp' : lang === 'en' ? 'en' : (card.locales.en ? 'en' : 'jp'))}
        />
      )}
    </>
  )
}
