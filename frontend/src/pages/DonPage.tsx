import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CardGrid from '../components/CardGrid'
import CardModal from '../components/CardModal'
import { api } from '../api'
import type { CollectionStats } from '../types'
import { useSettings } from '../context/SettingsContext'

function Stat({ label, value, onClick, hint }: { label: string; value: string | number; onClick?: () => void; hint?: string }) {
  return (
    <div
      onClick={onClick}
      className={`bg-slate-800 rounded-xl p-3 border border-slate-700 ${onClick ? 'cursor-pointer hover:bg-slate-700 transition-colors' : ''}`}
      title={hint}
    >
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  )
}

export default function DonPage() {
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [showUsd, setShowUsd] = useState(false)
  const { usdToMxn } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  // Carta DON!! que viene del escáner (?card=DON_132) → se abre directamente en el modal
  const scannedCard = searchParams.get('card')

  const loadStats = () => api.getCollectionStats(true).then(setStats)

  useEffect(() => {
    loadStats()
  }, [])

  const closeScannedCard = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('card')
    setSearchParams(next, { replace: true })
  }

  const totalMxn = stats?.total_value_usd != null ? (stats.total_value_usd * usdToMxn).toFixed(2) : null

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl no-invert">🃏</span>
        <h1 className="text-2xl font-bold text-white">Santuario DON!!</h1>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat 
            label="Total DON!!" 
            value={`${stats.total_owned} / ${stats.total_cards}`} 
          />
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Por Idioma</p>
            <p className="text-sm text-white mt-1">
              <span className="text-blue-400 font-bold">{stats.cards_with_en}</span> EN
              <span className="mx-2 text-slate-600">|</span>
              <span className="text-red-400 font-bold">{stats.cards_with_jp}</span> JP
            </p>
          </div>
          <Stat
            label={showUsd ? 'Valor (USD)' : 'Valor (MXN)'}
            value={showUsd
              ? (stats.total_value_usd != null ? `$${stats.total_value_usd.toFixed(2)}` : '—')
              : (totalMxn != null ? `$${totalMxn}` : '—')}
            onClick={() => setShowUsd((v) => !v)}
            hint={showUsd ? '↕ toca para MXN' : '↕ toca para USD'}
          />
        </div>
      )}

      {/* Reutilizamos el CardGrid pasándole el forceCategory para ocultar la barra y forzar la búsqueda */}
      <CardGrid forceCategory="DON!!" initialFilters={{ sort: 'newest' }} onCollectionChange={loadStats} />

      {scannedCard && (
        <CardModal cardCode={scannedCard} onClose={closeScannedCard} onCollectionChange={loadStats} initialLang="en" />
      )}
    </div>
  )
}
