import { useState, useEffect } from 'react'
import { useSettings } from '../context/SettingsContext'

interface Props {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: Props) {
  const { usdToMxn, setUsdToMxn, theme, setTheme } = useSettings()
  const [rateInput, setRateInput] = useState(String(usdToMxn))

  useEffect(() => {
    setRateInput(String(usdToMxn))
  }, [usdToMxn])

  function handleRateBlur() {
    const val = parseFloat(rateInput)
    if (!isNaN(val) && val > 0) {
      setUsdToMxn(val)
    } else {
      setRateInput(String(usdToMxn))
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[70]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-80 max-w-[90vw] bg-slate-900 border-l border-slate-700 z-[80] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <span className="no-invert">⚙️</span> Ajustes
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl font-bold w-8 h-8 flex items-center justify-center rounded hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Section: General */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
              General
            </h3>

            <div className="space-y-4">
              {/* Exchange rate */}
              <div className="bg-slate-800 rounded-lg p-4">
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Tipo de cambio USD → MXN
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Referencia automática (open.er-api.com) o valor manual.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">$1 USD =</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    onBlur={handleRateBlur}
                    className="w-24 bg-slate-700 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-slate-400 text-sm">MXN</span>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  Valor actual en uso: {usdToMxn.toFixed(2)} MXN
                </p>
              </div>

              {/* Theme */}
              <div className="bg-slate-800 rounded-lg p-4">
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Tema
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Cambia entre modo oscuro y claro.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-sm font-semibold transition-colors ${
                      theme === 'dark'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <span className="no-invert">🌙</span>
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-sm font-semibold transition-colors ${
                      theme === 'light'
                        ? 'bg-yellow-500 text-slate-900'
                        : 'bg-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <span className="no-invert">☀️</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700">
          <p className="text-xs text-slate-600 text-center">
            Los ajustes se guardan automáticamente
          </p>
        </div>
      </div>
    </>
  )
}
