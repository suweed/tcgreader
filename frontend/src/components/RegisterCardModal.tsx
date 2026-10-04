import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Set, Card } from '../types'
import { extractImageDescriptors } from '../utils/cardVision'
import ImageCropperModal from './ImageCropperModal'

interface Props {
  isOpen: boolean
  onClose: () => void
  capturedArtData?: string | null
  detectedCandidates?: Array<{ query: string; isCode: boolean }>
  initialLang?: 'en' | 'jp'
  isDonDetected?: boolean
  initialCard?: Card | null
  onCardUpdated?: () => void
}

export default function RegisterCardModal({
  isOpen,
  onClose,
  capturedArtData = null,
  detectedCandidates = [],
  initialLang = 'en',
  isDonDetected = false,
  initialCard = null,
  onCardUpdated,
}: Props) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEditMode = Boolean(initialCard)
  const [currentImage, setCurrentImage] = useState<string | null>(capturedArtData)
  const [showCropper, setShowCropper] = useState(false)

  const [cardCode, setCardCode] = useState('')
  const [autoCode, setAutoCode] = useState('')
  const [name, setName] = useState('')
  const [setId, setSetId] = useState<number>(0)
  const [category, setCategory] = useState(isDonDetected ? 'DON!!' : 'Character')
  const [rarity, setRarity] = useState(isDonDetected ? 'DON!!' : 'P')
  const [language, setLanguage] = useState<'en' | 'jp'>(initialLang)
  const [effect, setEffect] = useState('')
  const [sets, setSets] = useState<Set[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Cargar datos al abrir (modo edición o modo creación)
  useEffect(() => {
    if (!isOpen) return

    setError('')

    // Cargar sets disponibles
    api.getSets().then((loadedSets) => {
      setSets(loadedSets)
      if (initialCard) {
        const found = loadedSets.find((s) => s.code === initialCard.set_code || s.raw_title === initialCard.set_name)
        if (found) setSetId(found.id)
      } else {
        const promoAlt = loadedSets.find((s) => s.code === 'PROMO-ALT' || s.raw_title.toLowerCase().includes('promociones alternas'))
        if (promoAlt) {
          setSetId(promoAlt.id)
        } else if (loadedSets.length > 0) {
          setSetId(loadedSets[0].id)
        }
      }
    }).catch(() => {})

    if (initialCard) {
      // Modo Edición
      const currentLoc = initialCard.locales[initialLang || 'en'] ?? initialCard.locales.en ?? initialCard.locales.jp
      setCardCode(initialCard.card_code)
      setName(currentLoc?.name || '')
      setCategory(initialCard.category || 'Character')
      setRarity(initialCard.rarity || 'P')
      setLanguage(initialLang || 'en')
      setEffect(currentLoc?.effect || '')
      setCurrentImage(currentLoc?.img_url || capturedArtData || null)
    } else {
      // Modo Creación nueva
      setCurrentImage(capturedArtData)
      setCategory(isDonDetected ? 'DON!!' : 'Character')
      setRarity(isDonDetected ? 'DON!!' : 'P')
      setLanguage(initialLang)

      api.getNextCimCode().then((res) => {
        setAutoCode(res.next_code)
        const codeCandidate = detectedCandidates.find((c) => c.isCode)
        if (codeCandidate) {
          setCardCode(codeCandidate.query)
        } else {
          setCardCode(res.next_code)
        }
      }).catch(() => {
        setAutoCode('CIM-001')
        setCardCode('CIM-001')
      })

      const nameCandidate = detectedCandidates.find((c) => !c.isCode && !/^(DON|YOUR TURN)/i.test(c.query))
      if (nameCandidate) {
        setName(nameCandidate.query)
      } else if (isDonDetected) {
        setName('DON!! Card')
      } else {
        setName('')
      }
    }
  }, [isOpen, initialCard, capturedArtData, detectedCandidates, initialLang, isDonDetected])

  if (!isOpen) return null

  const handleCategoryChange = (newCat: string) => {
    setCategory(newCat)
    if (newCat === 'DON!!') {
      setRarity('DON!!')
    } else if (rarity === 'DON!!') {
      setRarity('P')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      if (result) {
        setCurrentImage(result)
        // Abrir automáticamente el recortador interactivo para centrar la nueva foto
        setShowCropper(true)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Por favor ingresa un nombre para la tarjeta.')
      return
    }

    setLoading(true)
    setError('')

    const finalImage = currentImage || capturedArtData

    try {
      let descriptors: string | undefined
      let rowsCount: number | undefined

      // Extraer descriptores ORB si tenemos imagen y OpenCV disponible
      if (typeof (window as any).cv !== 'undefined' && finalImage) {
        try {
          const imgEl = new Image()
          imgEl.src = finalImage
          await new Promise((resolve) => {
            imgEl.onload = resolve
            imgEl.onerror = resolve
          })
          const extracted = extractImageDescriptors((window as any).cv, imgEl)
          if (extracted) {
            descriptors = extracted.base64
            rowsCount = extracted.rows
          }
        } catch (cvErr) {
          console.warn('[RegisterCard] No se pudieron extraer descriptores ORB:', cvErr)
        }
      }

      const res = await api.createCustomCard({
        card_code: cardCode.trim() || autoCode,
        name: name.trim(),
        set_id: setId > 0 ? setId : undefined,
        category,
        rarity,
        language,
        effect: effect.trim() || undefined,
        img_base64: finalImage || undefined,
        descriptors,
        rows_count: rowsCount,
        is_edit: isEditMode,
      })

      if (res.success) {
        onClose()
        if (isEditMode) {
          onCardUpdated?.()
        } else if (res.is_don) {
          navigate(`/don?card=${encodeURIComponent(res.card_code)}`)
        } else {
          navigate('/collection')
        }
      } else {
        setError(res.error || 'Error al guardar la tarjeta')
      }
    } catch (err: any) {
      setError(err?.message || 'Error al registrar la tarjeta')
    } finally {
      setLoading(false)
    }
  }

  const displayImage = currentImage || capturedArtData

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="min-h-full flex items-start sm:items-center justify-center py-4 sm:py-8">
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Botón flotante para cerrar */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors border border-slate-700 shadow"
          >
            ✕
          </button>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-5 items-start pt-2">
              {/* Foto de la carta con botones de acción flotantes (Cámara y Recorte) */}
              <div className="w-full sm:w-64 shrink-0 text-center">
                {displayImage ? (
                  <div className="relative inline-block mx-auto">
                    <img
                      src={displayImage}
                      alt="Foto capturada"
                      className="w-56 sm:w-64 h-76 sm:h-88 object-contain rounded-lg border border-slate-700 bg-black shadow-md block mx-auto"
                    />

                    {/* Botones flotantes sobre la imagen */}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      {/* Botón para tomar foto con la cámara del celular o seleccionar archivo */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Tomar otra foto o subir imagen"
                        className="w-9 h-9 bg-slate-900/90 hover:bg-purple-600 active:bg-purple-700 text-white rounded-full shadow-lg border border-slate-600 backdrop-blur-sm transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
                      >
                        <span className="text-base leading-none">📷</span>
                      </button>

                      {/* Botón para recortar */}
                      <button
                        type="button"
                        onClick={() => setShowCropper(true)}
                        title="Recortar y centrar imagen"
                        className="w-9 h-9 bg-slate-900/90 hover:bg-blue-600 active:bg-blue-700 text-white rounded-full shadow-lg border border-slate-600 backdrop-blur-sm transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
                      >
                        <span className="text-base leading-none">✂️</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative w-56 sm:w-64 h-76 sm:h-88 bg-slate-800 rounded-lg mx-auto flex flex-col items-center justify-center border border-slate-700">
                    <span className="text-4xl mb-2">🃏</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-semibold transition-colors"
                    >
                      <span>📷</span>
                      <span>Tomar foto</span>
                    </button>
                  </div>
                )}

                {/* Input oculto para abrir la cámara nativa del celular o selector */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Campos principales */}
              <div className="flex-1 w-full space-y-3">
                {/* Código */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300">Código de Tarjeta</label>
                    {!isEditMode && autoCode && (
                      <button
                        type="button"
                        onClick={() => setCardCode(autoCode)}
                        className="text-[11px] text-blue-400 hover:underline"
                      >
                        Usar sugerido ({autoCode})
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={cardCode}
                    onChange={(e) => setCardCode(e.target.value)}
                    placeholder={autoCode || 'CIM-001'}
                    disabled={isEditMode}
                    className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none ${
                      isEditMode ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                  />
                  {!isEditMode && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Si no tiene código impreso, se usará {autoCode || 'CIM-001'}.
                    </p>
                  )}
                </div>

                {/* Nombre */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nombre de la Tarjeta *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ej. Monkey.D.Luffy (Promo Especial)"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                  />

                  {/* Sugerencias de texto leídas por OCR (en creación) */}
                  {!isEditMode && detectedCandidates.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">Leído en escáner:</span>
                      {detectedCandidates.slice(0, 4).map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setName(c.query)}
                          className="text-[10px] px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 font-mono transition-colors"
                        >
                          {c.query}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Set / Expansión */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Set / Expansión
                  </label>
                  <select
                    value={setId}
                    onChange={(e) => setSetId(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value={0}>Promociones Alternas (Predeterminado)</option>
                    {sets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.raw_title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Segunda fila de opciones */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {/* Categoría */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Categoría
                </label>
                <select
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="Character">Character (Personaje)</option>
                  <option value="Leader">Leader (Líder)</option>
                  <option value="Event">Event (Evento)</option>
                  <option value="Stage">Stage (Escenario)</option>
                  <option value="DON!!">DON!!</option>
                </select>
              </div>

              {/* Rareza */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Rareza
                </label>
                <select
                  value={rarity}
                  onChange={(e) => setRarity(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="P">P (Promocional)</option>
                  <option value="DON!!">DON!!</option>
                  <option value="C">C (Común)</option>
                  <option value="UC">UC (Infrecuente)</option>
                  <option value="R">R (Rara)</option>
                  <option value="SR">SR (Súper Rara)</option>
                  <option value="SEC">SEC (Secreta)</option>
                  <option value="L">L (Líder)</option>
                  <option value="SP">SP (Especial)</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>

              {/* Idioma */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Idioma
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as 'en' | 'jp')}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="en">Inglés (EN)</option>
                  <option value="jp">Japonés (JP)</option>
                </select>
              </div>
            </div>

            {/* Efecto o descripción opcional */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Efecto o Notas (Opcional)
              </label>
              <textarea
                value={effect}
                onChange={(e) => setEffect(e.target.value)}
                rows={2}
                placeholder="Efecto de la carta, notas del evento donde se obtuvo, etc."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/30 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="animate-spin text-sm">⏳</span>
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <span>💾</span>
                    <span>Guardar</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Modal de recorte de imagen */}
          <ImageCropperModal
            isOpen={showCropper}
            imageUrl={displayImage}
            onClose={() => setShowCropper(false)}
            onApplyCrop={(cropped) => setCurrentImage(cropped)}
          />
        </div>
      </div>
    </div>
  )
}
