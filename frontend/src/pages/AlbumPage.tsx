import { useEffect, useState } from 'react'
import { api } from '../api'
import type { CollectionStats } from '../types'
import CardGrid from '../components/CardGrid'

export default function AlbumPage() {
  const [stats, setStats] = useState<CollectionStats | null>(null)

  useEffect(() => {
    api.getCollectionStats().then(setStats)
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">📖 Álbum</h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Total cartas" value={stats.total_cards} />
          <Stat label="En inglés" value={stats.total_en} />
          <Stat label="En japonés" value={stats.total_jp} />
          <Stat label="Completado" value={stats.total_cards > 0 ? `${((stats.total_owned / stats.total_cards) * 100).toFixed(1)}%` : '0.0%'} />
        </div>
      )}

      <CardGrid />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 text-center">
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-white font-bold text-xl">{value}</p>
    </div>
  )
}
