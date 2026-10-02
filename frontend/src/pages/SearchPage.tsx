import { useSearchParams } from 'react-router-dom'
import CardGrid from '../components/CardGrid'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const initialQ = searchParams.get('q') ?? undefined

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-4">🔍 Buscar Cartas</h1>
      <CardGrid initialQ={initialQ} key={initialQ ?? ''} />
    </div>
  )
}
