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
    x: 3,
    y: 3,
    w: 94,
    h: 94,
  })

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
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
    setCrop({ x: 3, y: 3, w: 94, h: 94 })

    const img = new Image()
    img.src = imageUrl
    img.onload = () => {
      imageRef.current = img
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
  }, [isOpen, imageUrl])

  // Generar recorte en canvas offscreen
  const renderCroppedCanvas = useCallback(() => {
    const img = imageRef.current
    const canvas = offscreenCanvasRef.current
    if (!img || !canvas || !imageSize) return null

    const { width: origW, height: origH } = imageSize

    const cropX = Math.max(0, Math.round((crop.x / 100) * origW))
    const cropY = Math.max(0, Math.round((crop.y / 100) * origH))
    const cropW = Math.max(10, Math.round((crop.w / 100) * origW))
    const cropH = Math.max(10, Math.round((crop.h / 100) * origH))

    // Dimensiones estandarizadas de cartas One Piece (ratio 63:88)
    canvas.width = 300
    canvas.height = 419

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)

    return canvas
  }, [crop, imageSize])

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
    const minW = 10
    const minH = 10

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
    const canvas = renderCroppedCanvas()
    if (!canvas) return
    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    onApplyCrop(croppedDataUrl)
    onClose()
  }

  const handleReset = () => {
    setCrop({ x: 0, y: 0, w: 100, h: 100 })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/90 backdrop-blur-md p-3 sm:p-4">
      <div className="min-h-full flex items-start sm:items-center justify-center py-3 sm:py-6">
        <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Botón flotante para cerrar */}
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors border border-slate-700 shadow"
          >
            ✕
          </button>

          {/* Contenido interactivo: UNA SOLA IMAGEN GRANDE */}
          <div className="p-4 sm:p-5 space-y-3 text-center">
            <p className="text-xs text-slate-300 pr-8 text-left">
              Arrastra directamente las <strong className="text-green-400">líneas verdes</strong> para recortar la carta. Lo que quede fuera se oscurecerá:
            </p>

            {/* Imagen única grande con máscara de recorte y arrastre interactivo */}
            <div className="flex justify-center items-center py-1">
              <div
                ref={containerRef}
                className="relative inline-block border border-slate-700 rounded-lg overflow-hidden bg-black shadow-2xl select-none mx-auto"
                style={{ touchAction: 'none', maxWidth: '100%' }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* Imagen base nítida */}
                <img
                  src={imageUrl}
                  alt="Carta para recortar"
                  className="max-h-[62vh] sm:max-h-[68vh] w-auto object-contain block pointer-events-none"
                  draggable={false}
                />

                {/* 4 Capas oscuras que oscurecen la parte que quedará cortada */}
                {/* Arriba */}
                <div
                  className="absolute bg-black/75 backdrop-blur-[0.5px] pointer-events-none transition-all duration-75"
                  style={{ top: 0, left: 0, right: 0, height: `${crop.y}%` }}
                />
                {/* Abajo */}
                <div
                  className="absolute bg-black/75 backdrop-blur-[0.5px] pointer-events-none transition-all duration-75"
                  style={{ bottom: 0, left: 0, right: 0, height: `${Math.max(0, 100 - crop.y - crop.h)}%` }}
                />
                {/* Izquierda */}
                <div
                  className="absolute bg-black/75 backdrop-blur-[0.5px] pointer-events-none transition-all duration-75"
                  style={{
                    top: `${crop.y}%`,
                    bottom: `${Math.max(0, 100 - crop.y - crop.h)}%`,
                    left: 0,
                    width: `${crop.x}%`,
                  }}
                />
                {/* Derecha */}
                <div
                  className="absolute bg-black/75 backdrop-blur-[0.5px] pointer-events-none transition-all duration-75"
                  style={{
                    top: `${crop.y}%`,
                    bottom: `${Math.max(0, 100 - crop.y - crop.h)}%`,
                    right: 0,
                    width: `${Math.max(0, 100 - crop.x - crop.w)}%`,
                  }}
                />

                {/* Recuadro de recorte arrastrable con líneas verdes */}
                <div
                  className="absolute border-2 border-green-400 shadow-xl"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.w}%`,
                    height: `${crop.h}%`,
                    touchAction: 'none',
                  }}
                >
                  {/* Área central para arrastrar y mover el recuadro completo */}
                  <div
                    onPointerDown={(e) => handlePointerDown('move', e)}
                    className="absolute inset-0 cursor-move bg-green-500/5 flex items-center justify-center"
                  >
                    <span className="text-[10px] text-green-200 bg-slate-950/80 px-2 py-0.5 rounded shadow pointer-events-none select-none font-medium">
                      Arrastrar carta
                    </span>
                  </div>

                  {/* Borde Superior */}
                  <div
                    onPointerDown={(e) => handlePointerDown('top', e)}
                    className="absolute -top-3.5 left-4 right-4 h-7 cursor-ns-resize flex items-center justify-center z-10"
                  >
                    <div className="w-10 h-1.5 bg-green-400 rounded-full shadow-md" />
                  </div>

                  {/* Borde Inferior */}
                  <div
                    onPointerDown={(e) => handlePointerDown('bottom', e)}
                    className="absolute -bottom-3.5 left-4 right-4 h-7 cursor-ns-resize flex items-center justify-center z-10"
                  >
                    <div className="w-10 h-1.5 bg-green-400 rounded-full shadow-md" />
                  </div>

                  {/* Borde Izquierdo */}
                  <div
                    onPointerDown={(e) => handlePointerDown('left', e)}
                    className="absolute -left-3.5 top-4 bottom-4 w-7 cursor-ew-resize flex items-center justify-center z-10"
                  >
                    <div className="w-1.5 h-10 bg-green-400 rounded-full shadow-md" />
                  </div>

                  {/* Borde Derecho */}
                  <div
                    onPointerDown={(e) => handlePointerDown('right', e)}
                    className="absolute -right-3.5 top-4 bottom-4 w-7 cursor-ew-resize flex items-center justify-center z-10"
                  >
                    <div className="w-1.5 h-10 bg-green-400 rounded-full shadow-md" />
                  </div>

                  {/* 4 Esquinas táctiles ampliadas para dedos móviles */}
                  <div
                    onPointerDown={(e) => handlePointerDown('top-left', e)}
                    className="absolute -top-3.5 -left-3.5 w-7 h-7 bg-white border-2 border-green-500 rounded-full cursor-nwse-resize shadow-xl z-20"
                  />
                  <div
                    onPointerDown={(e) => handlePointerDown('top-right', e)}
                    className="absolute -top-3.5 -right-3.5 w-7 h-7 bg-white border-2 border-green-500 rounded-full cursor-nesw-resize shadow-xl z-20"
                  />
                  <div
                    onPointerDown={(e) => handlePointerDown('bottom-left', e)}
                    className="absolute -bottom-3.5 -left-3.5 w-7 h-7 bg-white border-2 border-green-500 rounded-full cursor-nesw-resize shadow-xl z-20"
                  />
                  <div
                    onPointerDown={(e) => handlePointerDown('bottom-right', e)}
                    className="absolute -bottom-3.5 -right-3.5 w-7 h-7 bg-white border-2 border-green-500 rounded-full cursor-nwse-resize shadow-xl z-20"
                  />
                </div>
              </div>
            </div>

            {/* Canvas oculto para renderizar el resultado recortado */}
            <canvas ref={offscreenCanvasRef} className="hidden" aria-hidden="true" />

            {/* Botones de acción del cropper */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1"
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
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-green-900/30 transition-all flex items-center gap-1.5"
                >
                  <span>✓</span>
                  <span>Guardar recorte</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
