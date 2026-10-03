import { useState } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import AlbumPage from './pages/AlbumPage'
import CollectionPage from './pages/CollectionPage'
import SearchPage from './pages/SearchPage'
import ScannerPage from './pages/ScannerPage'
import SettingsPanel from './components/SettingsPanel'
import { SettingsProvider } from './context/SettingsContext'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
    isActive ? 'text-white bg-blue-600' : 'text-slate-400 hover:text-white'
  }`

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <SettingsProvider>
      <div className="min-h-screen flex flex-col">
        <header className="bg-slate-900 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
          <img src={`${import.meta.env.BASE_URL}oplogo.png`} alt="Logo" className="h-8 w-auto" />
          <h1 className="text-white font-bold text-lg">OP TCG Collection</h1>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700"
            title="Ajustes"
          >
            <span className="no-invert">⚙️</span>
          </button>
        </header>

        <main className="flex-1 p-4 max-w-5xl mx-auto w-full pb-20">
          <Routes>
            <Route path="/" element={<AlbumPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
          </Routes>
        </main>

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 flex justify-around py-2 px-2 z-40">
          <NavLink to="/" end className={navClass}>
            <span className="no-invert">📖</span>
            <span>Álbum</span>
          </NavLink>
          <NavLink to="/collection" className={navClass}>
            <span className="no-invert">🗂</span>
            <span>Colección</span>
          </NavLink>
          <NavLink to="/search" className={navClass}>
            <span className="no-invert">🔍</span>
            <span>Buscar</span>
          </NavLink>
          <NavLink to="/scanner" className={navClass}>
            <span className="no-invert">📷</span>
            <span>Escáner</span>
          </NavLink>
        </nav>

        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      </div>
    </SettingsProvider>
  )
}
