import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  isOpen: boolean
  imageUrl: string | null
  onClose: () => void
  onApplyCrop: (croppedDataUrl: string) => void
}

export default function ImageCropperModal({ isOpen, imageUrl, onClose, onApplyCrop }: Props) {
  const [insets, setInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Cargar dimensiones naturales de la imagen al abrir
  useEffect(() => {
    if (!isOpen || !imageUrl) return
    setInsets({ top: 0, bottom: 0, left: 0, right: 0 })

    const img = new Image()
    img.src = imageUrl
    img.onload = () => {
      imageRef.current = img
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
  }, [isOpen, imageUrl])

  // Actualizar canvas de previsualización en tiempo real
  const updatePreview = useCallback(() => {
    const img = imageRef.current
    const canvas = previewCanvasRef.current
    if (!img || !canvas || !imageSize) return

    const { width: origW, height: origH } = imageSize

    const cropX = Math.round((insets.left / 100) * origW)
    const cropY = Math.round((insets.top / 100) * origH)
    const cropW = Math.max(10, Math.round(origW - ((insets.left + insets.right) / 100) * origW))
    const cropH = Math.max(10, Math.round(origH - ((insets.top + insets.bottom) / 100) * origH))

    // Dimensiones estandarizadas de cartas One Piece (ratio ~63:88)
    canvas.width = 300
    canvas.height = 419

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
  }, [insets, imageSize])

  useEffect(() => {
    updatePreview()
  }, [updatePreview])

  if (!isOpen || !imageUrl) return null

  const handleAdjust = (side: 'top' | 'bottom' | 'left' | 'right', delta: number) => {
    setInsets((prev) => {
      const maxVal = 40
      const current = prev[side]
      const next = Math.max(0, Math.min(maxVal, current + delta))
      return { ...prev, [side]: next }
    })
  }

  const handleApply = () => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    onApplyCrop(croppedDataUrl)
    onClose()
  }

  const handleReset = () => {
    setInsets({ top: 0, bottom: 0, left: 0, right: 0 })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden my-4">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/90 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">✂️</span>
            <h3 className="text-base font-bold text-white">Recortar y Centrar Carta</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Contenido interactivo */}
        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-xs text-slate-300">
            Ajusta los bordes con los controles o deslizadores para eliminar esquinas, sombras o fondos de la mesa que se hayan colado en la foto:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            {/* Vista con máscara de recorte interactiva */}
            <div className="text-center">
              <p className="text-[11px] font-semibold text-slate-400 mb-2">Previsualización con guía</p>
              <div
                ref={containerRef}
                className="relative inline-block border border-slate-700 rounded-lg overflow-hidden bg-black shadow-lg"
                style={{ maxWidth: '100%' }}
              >
                {/* Imagen base */}
                <img
                  src={imageUrl}
                  alt="Original para recortar"
                  className="max-h-64 sm:max-h-80 w-auto object-contain block opacity-50"
                />

                {/* Área visible recortada */}
                <div
                  className="absolute border-2 border-green-400 shadow-sm pointer-events-none transition-all duration-75"
                  style={{
                    top: `${insets.top}%`,
                    bottom: `${insets.bottom}%`,
                    left: `${insets.left}%`,
                    right: `${insets.right}%`,
                    backgroundColor: 'rgba(34, 197, 94, 0.08)',
                  }}
                >
                  <span className="absolute top-1 left-1 text-[9px] bg-green-500 text-slate-950 font-bold px-1 rounded">
                    Área Final
                  </span>
                </div>
              </div>
            </div>

            {/* Resultado Final (Canvas) */}
            <div className="text-center">
              <p className="text-[11px] font-semibold text-slate-400 mb-2">Resultado limpio (300 × 419)</p>
              <div className="inline-block border border-slate-700 rounded-lg overflow-hidden bg-black shadow-lg">
                <canvas
                  ref={previewCanvasRef}
                  className="w-36 sm:w-44 h-auto block mx-auto object-contain"
                />
              </div>
            </div>
          </div>

          {/* Controles de ajuste fino por lado */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
            <p className="text-[11px] font-bold text-slate-300">Ajuste fino de bordes a recortar:</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Arriba */}
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400 block mb-1">Arriba: {insets.top}%</span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAdjust('top', -1)}
                    className="w-7 h-7 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white rounded font-bold text-xs"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjust('top', 1)}
                    className="w-7 h-7 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Abajo */}
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400 block mb-1">Abajo: {insets.bottom}%</span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAdjust('bottom', -1)}
                    className="w-7 h-7 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white rounded font-bold text-xs"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjust('bottom', 1)}
                    className="w-7 h-7 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Izquierda */}
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400 block mb-1">Izquierda: {insets.left}%</span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAdjust('left', -1)}
                    className="w-7 h-7 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white rounded font-bold text-xs"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjust('left', 1)}
                    className="w-7 h-7 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Derecha */}
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400 block mb-1">Derecha: {insets.right}%</span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleAdjust('right', -1)}
                    className="w-7 h-7 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white rounded font-bold text-xs"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjust('right', 1)}
                    className="w-7 h-7 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Botones de acción del cropper */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <span>↺</span>
              <span>Restablecer</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <span>✓</span>
                <span>Aplicar recorte</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
