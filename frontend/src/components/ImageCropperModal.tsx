import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  isOpen: boolean
  imageUrl: string | null
  onClose: () => void
  onApplyCrop: (croppedDataUrl: string) => void
}

type DragHandle =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'move'
  | null

export default function ImageCropperModal({ isOpen, imageUrl, onClose, onApplyCrop }: Props) {
  // Rectángulo de recorte en porcentajes (0 a 100%)
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 2,
    y: 2,
    w: 96,
    h: 96,
  })

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const dragRef = useRef<{
    handle: DragHandle
    startX: number
    startY: number
    initialCrop: { x: number; y: number; w: number; h: number }
  } | null>(null)

  // Cargar dimensiones naturales de la imagen al abrir
  useEffect(() => {
    if (!isOpen || !imageUrl) return
    setCrop({ x: 2, y: 2, w: 96, h: 96 })

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

    const cropX = Math.max(0, Math.round((crop.x / 100) * origW))
    const cropY = Math.max(0, Math.round((crop.y / 100) * origH))
    const cropW = Math.max(10, Math.round((crop.w / 100) * origW))
    const cropH = Math.max(10, Math.round((crop.h / 100) * origH))

    // Dimensiones estandarizadas de cartas One Piece (ratio ~63:88)
    canvas.width = 300
    canvas.height = 419

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
  }, [crop, imageSize])

  useEffect(() => {
    updatePreview()
  }, [updatePreview])

  if (!isOpen || !imageUrl) return null

  // Manejadores de arrastre con PointerEvents (funciona en móvil touch y mouse)
  const handlePointerDown = (handle: DragHandle, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialCrop: { ...crop },
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !containerRef.current) return
    const { handle, startX, startY, initialCrop } = dragRef.current
    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const dx = ((e.clientX - startX) / rect.width) * 100
    const dy = ((e.clientY - startY) / rect.height) * 100
    const minW = 12
    const minH = 12

    setCrop(() => {
      let { x, y, w, h } = initialCrop

      if (handle === 'move') {
        x = Math.max(0, Math.min(100 - w, initialCrop.x + dx))
        y = Math.max(0, Math.min(100 - h, initialCrop.y + dy))
        return { x, y, w, h }
      }

      // Horizontal
      if (handle === 'left' || handle === 'top-left' || handle === 'bottom-left') {
        const maxX = initialCrop.x + initialCrop.w - minW
        const newX = Math.max(0, Math.min(maxX, initialCrop.x + dx))
        w = initialCrop.w - (newX - initialCrop.x)
        x = newX
      } else if (handle === 'right' || handle === 'top-right' || handle === 'bottom-right') {
        w = Math.max(minW, Math.min(100 - initialCrop.x, initialCrop.w + dx))
      }

      // Vertical
      if (handle === 'top' || handle === 'top-left' || handle === 'top-right') {
        const maxY = initialCrop.y + initialCrop.h - minH
        const newY = Math.max(0, Math.min(maxY, initialCrop.y + dy))
        h = initialCrop.h - (newY - initialCrop.y)
        y = newY
      } else if (handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right') {
        h = Math.max(minH, Math.min(100 - initialCrop.y, initialCrop.h + dy))
      }

      return { x, y, w, h }
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
      dragRef.current = null
    }
  }

  const handleApply = () => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    onApplyCrop(croppedDataUrl)
    onClose()
  }

  const handleReset = () => {
    setCrop({ x: 0, y: 0, w: 100, h: 100 })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md p-3 sm:p-4">
      <div className="min-h-full flex items-start sm:items-center justify-center py-4 sm:py-8">
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
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
              Arrastra directamente los <strong className="text-green-400">bordes verdes</strong> o las <strong className="text-white">esquinas</strong> con tu dedo para recortar bordes de la mesa o desalineaciones:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              {/* Área interactiva con arrastre táctil / mouse */}
              <div className="text-center">
                <p className="text-[11px] font-semibold text-slate-400 mb-2">Arrastra los bordes de la carta</p>
                <div
                  ref={containerRef}
                  className="relative inline-block border border-slate-700 rounded-lg overflow-hidden bg-black shadow-lg select-none"
                  style={{ touchAction: 'none', maxWidth: '100%' }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  {/* Imagen base */}
                  <img
                    src={imageUrl}
                    alt="Original para recortar"
                    className="max-h-64 sm:max-h-80 w-auto object-contain block opacity-40 pointer-events-none"
                    draggable={false}
                  />

                  {/* Sombras oscuras alrededor del área de recorte */}
                  <div
                    className="absolute bg-black/60 pointer-events-none"
                    style={{ top: 0, left: 0, right: 0, height: `${crop.y}%` }}
                  />
                  <div
                    className="absolute bg-black/60 pointer-events-none"
                    style={{ bottom: 0, left: 0, right: 0, height: `${Math.max(0, 100 - crop.y - crop.h)}%` }}
                  />
                  <div
                    className="absolute bg-black/60 pointer-events-none"
                    style={{ top: `${crop.y}%`, bottom: `${Math.max(0, 100 - crop.y - crop.h)}%`, left: 0, width: `${crop.x}%` }}
                  />
                  <div
                    className="absolute bg-black/60 pointer-events-none"
                    style={{ top: `${crop.y}%`, bottom: `${Math.max(0, 100 - crop.y - crop.h)}%`, right: 0, width: `${Math.max(0, 100 - crop.x - crop.w)}%` }}
                  />

                  {/* Recuadro de recorte arrastrable */}
                  <div
                    className="absolute border-2 border-green-400 shadow-md"
                    style={{
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      width: `${crop.w}%`,
                      height: `${crop.h}%`,
                      touchAction: 'none',
                    }}
                  >
                    {/* Área central para mover el recuadro completo */}
                    <div
                      onPointerDown={(e) => handlePointerDown('move', e)}
                      className="absolute inset-0 cursor-move bg-green-500/10 flex items-center justify-center"
                    >
                      <span className="text-[10px] text-green-200 bg-slate-950/70 px-1.5 py-0.5 rounded pointer-events-none select-none">
                        Arrastra para mover
                      </span>
                    </div>

                    {/* Borde Superior */}
                    <div
                      onPointerDown={(e) => handlePointerDown('top', e)}
                      className="absolute -top-3 left-4 right-4 h-6 cursor-ns-resize flex items-center justify-center z-10"
                    >
                      <div className="w-8 h-1 bg-green-400 rounded-full shadow" />
                    </div>

                    {/* Borde Inferior */}
                    <div
                      onPointerDown={(e) => handlePointerDown('bottom', e)}
                      className="absolute -bottom-3 left-4 right-4 h-6 cursor-ns-resize flex items-center justify-center z-10"
                    >
                      <div className="w-8 h-1 bg-green-400 rounded-full shadow" />
                    </div>

                    {/* Borde Izquierdo */}
                    <div
                      onPointerDown={(e) => handlePointerDown('left', e)}
                      className="absolute -left-3 top-4 bottom-4 w-6 cursor-ew-resize flex items-center justify-center z-10"
                    >
                      <div className="w-1 h-8 bg-green-400 rounded-full shadow" />
                    </div>

                    {/* Borde Derecho */}
                    <div
                      onPointerDown={(e) => handlePointerDown('right', e)}
                      className="absolute -right-3 top-4 bottom-4 w-6 cursor-ew-resize flex items-center justify-center z-10"
                    >
                      <div className="w-1 h-8 bg-green-400 rounded-full shadow" />
                    </div>

                    {/* 4 Esquinas táctiles ampliadas para dedos móviles */}
                    <div
                      onPointerDown={(e) => handlePointerDown('top-left', e)}
                      className="absolute -top-3 -left-3 w-6 h-6 bg-white border-2 border-green-500 rounded-full cursor-nwse-resize shadow-lg z-20"
                    />
                    <div
                      onPointerDown={(e) => handlePointerDown('top-right', e)}
                      className="absolute -top-3 -right-3 w-6 h-6 bg-white border-2 border-green-500 rounded-full cursor-nesw-resize shadow-lg z-20"
                    />
                    <div
                      onPointerDown={(e) => handlePointerDown('bottom-left', e)}
                      className="absolute -bottom-3 -left-3 w-6 h-6 bg-white border-2 border-green-500 rounded-full cursor-nesw-resize shadow-lg z-20"
                    />
                    <div
                      onPointerDown={(e) => handlePointerDown('bottom-right', e)}
                      className="absolute -bottom-3 -right-3 w-6 h-6 bg-white border-2 border-green-500 rounded-full cursor-nwse-resize shadow-lg z-20"
                    />
                  </div>
                </div>
              </div>

              {/* Resultado Final en vivo (Canvas 300 × 419) */}
              <div className="text-center">
                <p className="text-[11px] font-semibold text-slate-400 mb-2">Vista final de la carta</p>
                <div className="inline-block border border-slate-700 rounded-lg overflow-hidden bg-black shadow-lg">
                  <canvas
                    ref={previewCanvasRef}
                    className="w-36 sm:w-44 h-auto block mx-auto object-contain"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Se ajusta automáticamente al formato físico oficial (63 × 88 mm)
                </p>
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
                  className="px-5 py-2 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5"
                >
                  <span>✓</span>
                  <span>Aplicar recorte</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
