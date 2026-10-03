import { useEffect, useState } from 'react'
import { api } from '../api'
import type { CollectionStats } from '../types'
import CardGrid from '../components/CardGrid'
import { useSettings } from '../context/SettingsContext'

export default function CollectionPage() {
  const { usdToMxn } = useSettings()
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [showUsd, setShowUsd] = useState(true)

  useEffect(() => {
    api.getCollectionStats().then(setStats)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const result = await api.refreshPrices()
      setRefreshMsg(`Actualizadas ${result.updated} cartas${result.errors > 0 ? `, ${result.errors} errores` : ''}`)
      const newStats = await api.getCollectionStats()
      setStats(newStats)
    } catch {
      setRefreshMsg('Error al actualizar precios')
    } finally {
      setRefreshing(false)
    }
  }

  const totalMxn = stats?.total_value_usd != null ? (stats.total_value_usd * usdToMxn).toFixed(2) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">🗂 Mi Colección</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {refreshing ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Actualizando...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Actualizar precios
            </>
          )}
        </button>
      </div>

      {refreshMsg && (
        <p className="text-slate-400 text-sm mb-3">{refreshMsg}</p>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Cartas únicas" value={stats.total_owned} />
          <Stat label="EN poseídas" value={stats.cards_with_en} />
          <Stat label="JP poseídas" value={stats.cards_with_jp} />
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

      <CardGrid initialFilters={{ owned: 'true', sort: 'newest' }} showOwnedToggle={false} collectionMode={true} />
    </div>
  )
}

function Stat({ label, value, onClick, hint }: { label: string; value: string | number; onClick?: () => void; hint?: string }) {
  return (
    <div
      className={`bg-slate-800 rounded-lg p-3 text-center ${onClick ? 'cursor-pointer hover:bg-slate-700 transition-colors select-none' : ''}`}
      onClick={onClick}
    >
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-white font-bold text-xl">{value}</p>
      {hint && <p className="text-slate-500 text-xs mt-0.5">{hint}</p>}
    </div>
  )
}
