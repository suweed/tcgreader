import { useRef, useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Webcam from 'react-webcam'
import { api } from '../api'
import type { Card } from '../types'
import CardModal from '../components/CardModal'
import { proxyImg } from '../utils/proxyImg'
import { loadOpenCV, compareWithORB, preloadImage } from '../utils/cardVision'

interface ScoredCard extends Card {
  visualScore?: number
  visualMatches?: number
}

// Proporciones exactas de las cartas One Piece: 63 mm × 88 mm
export const CARD_RATIO = 63 / 88 // 0.715909...

export function getGuideRect(W: number, H: number) {
  // Ocupa el ~80% de la altura o el ~86% del ancho, lo que sea menor, manteniendo 63:88
  let h = H * 0.80
  let w = h * CARD_RATIO
  if (w > W * 0.86) {
    w = W * 0.86
    h = w / CARD_RATIO
  }
  const x = Math.round((W - w) / 2)
  const y = Math.round((H - h) / 2)
  return {
    x,
    y,
    w: Math.round(w),
    h: Math.round(h),
  }
}

const STABLE_NEEDED = 8
const VARIANCE_MIN = 350
const MAD_MAX = 7

// Códigos One Piece: OP01-001, OP17-001, EB04-061, ST01-001, P-001, PRB01-001
const CODE_RE = /\b((?:OP|ST|EB|PRB?|P)\s*[-–—._/]?\s*\d{1,3}\s*[-–—._/]?\s*\d{2,3}(?:_p\d+|_r\d+)?)\b/gi
const PROMO_RE = /\b(P\s*[-–—._/]?\s*\d{2,3}(?:_p\d+)?)\b/gi

// Tipos y palabras reservadas a ignorar en OCR
const CARD_TYPES = new Set([
  'CHARACTER', 'LEADER', 'EVENT', 'STAGE', 'DON', 'DON!!', 'DONII',
  'キャラクター', 'リーダー', 'イベント', 'ステージ', 'ドン!!', 'ドン！！',
])
const CARD_TYPE_PREFIXES = ['CHARAC', 'LEADER', 'NATION', 'ATTRIB', 'TRIGGE', 'COUNTE', 'mination', 'ano', 'SPECIAL', 'SLASH', 'STRIKE']

function cleanOcrString(raw: string): string {
  return raw
    .replace(/\b0P(?=\d)/gi, 'OP')
    .replace(/\bS[7T](?=\d)/gi, 'ST')
    .replace(/\bEB(?=\d)/gi, 'EB')
    .replace(/\bPRB(?=\d)/gi, 'PRB')
    .replace(/([A-Z0-9]{1,4})\s*[-–—._/]\s*(\d{2,3})/gi, '$1-$2')
}

function normalizeFoundCode(raw: string): string {
  let c = raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[–—._/]/g, '-')
    .replace(/^0P/i, 'OP')
    .replace(/^S[7T]/i, 'ST')

  // Casos donde el OCR no leyó el guión (ej. OP17001 -> OP17-001)
  const m = c.match(/^(OP|ST|EB|PRB)(\d{2})(\d{3})$/i)
  if (m) {
    c = `${m[1]}${m[2]}-${m[3]}`
  }
  return c
}

function parseOcrText(raw: string): { candidates: { query: string; isCode: boolean }[] } {
  const result: { query: string; isCode: boolean }[] = []
  const seen = new Set<string>()

  const add = (q: string, isCode: boolean) => {
    const k = q.toLowerCase()
    if (q.length >= 2 && !seen.has(k)) {
      seen.add(k)
      result.push({ query: q, isCode })
    }
  }

  const cleanedRaw = cleanOcrString(raw)

  // 1. Códigos de carta en esquina inferior derecha (máxima prioridad)
  const codes = cleanedRaw.match(CODE_RE) || cleanedRaw.match(PROMO_RE)
  if (codes) {
    codes.forEach((c) => {
      const normalized = normalizeFoundCode(c)
      add(normalized, true)
    })
  }

  // 2. Líneas de texto para nombre del personaje
  const lines = raw
    .split('\n')
    .map((l) =>
      l
        .replace(/[^a-zA-Z0-9\u00C0-\u024F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF65-\uFF9F &.'\-_()']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((l) => l.length >= 2)
    .filter((l) => {
      const up = l.toUpperCase().replace(/\s+/g, '')
      return (
        !CARD_TYPES.has(l.toUpperCase().trim()) &&
        !CARD_TYPE_PREFIXES.some((p) => up.startsWith(p)) &&
        !/©|Toei|Animation|Bandai|Japan|^\d+$/.test(l) &&
        !/^\d{4,5}$/.test(l.trim())
      )
    })

  lines.forEach((l, i) => {
    if (i >= 3) return
    add(l, false)
    const stripped = l.replace(/[.'\-_()']/g, ' ').replace(/\s+/g, ' ').trim()
    if (stripped !== l) add(stripped, false)
  })

  return { candidates: result.slice(0, 5) }
}

function enhanceContrast(ctx: CanvasRenderingContext2D, width: number, height: number) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height)
    const d = imgData.data
    const factor = 1.45
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const contrasted = Math.min(255, Math.max(0, (gray - 128) * factor + 128))
      d[i] = contrasted
      d[i + 1] = contrasted
      d[i + 2] = contrasted
    }
    ctx.putImageData(imgData, 0, 0)
  } catch {}
}

function captureZones(video: HTMLVideoElement): { textImg: string; artCanvas: HTMLCanvasElement } {
  const W = video.videoWidth || 1280
  const H = video.videoHeight || 720
  const guide = getGuideRect(W, H)

  // 1. Carta completa normalizada para comparación OpenCV (300 x 419, ratio 63:88)
  const artCanvas = document.createElement('canvas')
  artCanvas.width = 300
  artCanvas.height = 419
  const aCtx = artCanvas.getContext('2d')!
  aCtx.imageSmoothingEnabled = true
  aCtx.imageSmoothingQuality = 'high'
  aCtx.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, 300, 419)

  // 2. Franja inferior (Nombre + Código en esquina derecha, 28% inferior de la carta)
  const ty = Math.floor(guide.y + guide.h * 0.72)
  const th = Math.floor(guide.h * 0.28)
  const tx = Math.floor(guide.x + guide.w * 0.02)
  const tw = Math.floor(guide.w * 0.96)
  const SCALE = 2.5

  const textCanvas = document.createElement('canvas')
  textCanvas.width = Math.floor(tw * SCALE)
  textCanvas.height = Math.floor(th * SCALE)
  const tCtx = textCanvas.getContext('2d')!
  tCtx.imageSmoothingEnabled = true
  tCtx.imageSmoothingQuality = 'high'
  tCtx.fillStyle = '#ffffff'
  tCtx.fillRect(0, 0, textCanvas.width, textCanvas.height)
  tCtx.drawImage(video, tx, ty, tw, th, 0, 0, textCanvas.width, textCanvas.height)
  enhanceContrast(tCtx, textCanvas.width, textCanvas.height)

  return {
    textImg: textCanvas.toDataURL('image/jpeg', 0.95),
    artCanvas,
  }
}

type ScanState = 'ready' | 'detecting' | 'scanning' | 'matching' | 'choosing' | 'done' | 'error'

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

export default function ScannerPage() {
  const webcamRef = useRef<Webcam>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const analysisRef = useRef<HTMLCanvasElement>(null)
  const capturedArtRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const stableRef = useRef(0)
  const prevLumsRef = useRef<number[] | null>(null)
  const loopActiveRef = useRef(false)
  const isScanningRef = useRef(false)

  const [cameraOn, setCameraOn] = useState(false)
  const [cvReady, setCvReady] = useState(false)
  const [scanState, setScanState] = useState<ScanState>('ready')
  const [detectedText, setDetectedText] = useState('')
  const [detectedQuery, setDetectedQuery] = useState('')
  const [candidates, setCandidates] = useState<{ query: string; isCode: boolean }[]>([])
  const [cards, setCards] = useState<ScoredCard[]>([])
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [debugImg, setDebugImg] = useState<string | null>(null)
  const [debugRaw, setDebugRaw] = useState<string>('')
  const [debugError, setDebugError] = useState<string>('')

  // Precargar OpenCV en segundo plano al iniciar la cámara
  useEffect(() => {
    if (!cameraOn) return
    loadOpenCV()
      .then(() => setCvReady(true))
      .catch((e) => console.warn('OpenCV lazy load:', e))
  }, [cameraOn])

  const drawOverlay = useCallback((color: string) => {
    const canvas = overlayRef.current
    if (!canvas || canvas.width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height

    // Marco proporcional exacto 63 mm × 88 mm
    const guide = getGuideRect(W, H)
    const { x, y, w, h } = guide
    const r = 16
    const cs = 22

    ctx.clearRect(0, 0, W, H)

    // Fondo atenuado exterior
    ctx.fillStyle = 'rgba(0,0,0,0.58)'
    ctx.fillRect(0, 0, W, H)

    // Recorte del marco de la carta
    ctx.globalCompositeOperation = 'destination-out'
    drawRoundRect(ctx, x, y, w, h, r)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'

    // Borde principal de la carta (63 × 88 mm)
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    drawRoundRect(ctx, x, y, w, h, r)
    ctx.stroke()

    // Esquinas reforzadas
    ctx.lineWidth = 4.5
    ctx.strokeStyle = color
    const corners: [number, number, number, number][] = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ]
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath()
      ctx.moveTo(cx + dx * cs, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy * cs)
      ctx.stroke()
    }

    // 1. Zona de ilustración (Arte superior ~68%)
    const artX = Math.round(x + w * 0.04)
    const artY = Math.round(y + h * 0.04)
    const artW = Math.round(w * 0.92)
    const artH = Math.round(h * 0.66)
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    drawRoundRect(ctx, artX, artY, artW, artH, 8)
    ctx.stroke()
    ctx.fillStyle = 'rgba(168, 85, 247, 0.65)'
    ctx.font = `600 ${Math.max(9, Math.round(w * 0.03))}px sans-serif`
    ctx.fillText('Ilustración / Arte', artX + 6, artY + 14)

    // 2. Zona de Código (Esquina inferior derecha de la carta)
    const codeX = Math.round(x + w * 0.52)
    const codeY = Math.round(y + h * 0.87)
    const codeW = Math.round(w * 0.46)
    const codeH = Math.round(h * 0.12)
    ctx.fillStyle = 'rgba(234, 179, 8, 0.15)'
    ctx.fillRect(codeX, codeY, codeW, codeH)
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.9)'
    ctx.lineWidth = 1.8
    ctx.setLineDash([4, 3])
    ctx.strokeRect(codeX, codeY, codeW, codeH)
    ctx.setLineDash([])

    // Etiqueta destacada de código
    ctx.fillStyle = 'rgba(250, 204, 21, 0.95)'
    ctx.font = `bold ${Math.max(9, Math.round(w * 0.032))}px sans-serif`
    ctx.fillText('CÓDIGO (ej. OP01-001) ➔', codeX - 2, codeY - 4)
  }, [])

  const analyzeFrame = useCallback((): { variance: number; mad: number } | null => {
    const video = webcamRef.current?.video
    const canvas = analysisRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const W = video.videoWidth || 320
    const H = video.videoHeight || 240
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, W, H)

    const guide = getGuideRect(W, H)
    const { data } = ctx.getImageData(guide.x, guide.y, guide.w, guide.h)

    const lums: number[] = []
    let sum = 0
    for (let i = 0; i < data.length; i += 16) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      lums.push(l)
      sum += l
    }
    const count = lums.length
    if (count === 0) return null

    const mean = sum / count
    const variance = lums.reduce((acc, l) => acc + (l - mean) ** 2, 0) / count

    let mad = 999
    const prev = prevLumsRef.current
    if (prev && prev.length === count) {
      mad = prev.reduce((acc, pl, i) => acc + Math.abs(pl - lums[i]), 0) / count
    }
    prevLumsRef.current = lums

    return { variance, mad }
  }, [])

  // Búsqueda en BD y comparación visual con OpenCV
  const searchAndMatchVisual = useCallback(
    async (
      candidate: { query: string; isCode: boolean },
      artCanvas: HTMLCanvasElement
    ) => {
      setScanState('scanning')
      try {
        let found: Card[] = []
        if (candidate.isCode) {
          const clean = normalizeFoundCode(candidate.query)
          const res = await api.getCards({ q: clean, limit: 16 })
          found = res.data || []
          if (found.length === 0) {
            try {
              const single = await api.getCard(clean)
              if (single) found = [single]
            } catch {}
          }
        } else {
          const res = await api.getCards({ q: candidate.query, limit: 16 })
          found = res.data || []
        }

        setDetectedText(candidate.isCode ? `Código: ${candidate.query}` : `"${candidate.query}"`)
        setDetectedQuery(candidate.query)

        if (found.length === 0) {
          setCards([])
          setScanState('error')
          return
        }

        // CASO 1: Si solo hay 1 carta que coincide exactamente -> Mostrarla directamente
        if (found.length === 1) {
          setCards(found)
          setSelectedCard(found[0].card_code) // <-- Abre directamente la carta
          setScanState('done')
          return
        }

        // CASO 2: Hay múltiples variantes (ej. regular vs alt-art / manga) -> Comparar con OpenCV
        setScanState('matching')
        const cv = await loadOpenCV()
        const scored: ScoredCard[] = []

        for (const card of found.slice(0, 8)) {
          const locale = card.locales.en ?? card.locales.jp
          const imgUrl = locale?.img_url ? proxyImg(locale.img_url) : null
          if (!imgUrl) {
            scored.push({ ...card, visualScore: 0, visualMatches: 0 })
            continue
          }

          try {
            const imgEl = await preloadImage(imgUrl)
            const result = compareWithORB(cv, artCanvas, imgEl)
            scored.push({
              ...card,
              visualScore: result.score,
              visualMatches: result.matches,
            })
          } catch {
            scored.push({ ...card, visualScore: 0, visualMatches: 0 })
          }
        }

        // Ordenar de mayor a menor coincidencia visual
        scored.sort((a, b) => (b.visualScore ?? 0) - (a.visualScore ?? 0))
        setCards(scored)

        const best = scored[0]
        const runnerUp = scored[1]
        const bestScore = best?.visualScore ?? 0
        const runnerScore = runnerUp?.visualScore ?? 0

        // Criterio de certeza visual:
        // Si el mejor puntaje es sólido (>= 35%) o supera al segundo con clara ventaja (>= 20% y +30% que el segundo)
        const isCertain = bestScore >= 35 || (bestScore >= 20 && bestScore >= runnerScore * 1.3)

        if (isCertain && best) {
          // Coincidencia segura: Mostrar directamente la carta detectada
          setSelectedCard(best.card_code)
        }

        setScanState('done')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setDebugError(msg)
        setScanState('error')
      }
    },
    []
  )

  const doScan = useCallback(async () => {
    if (isScanningRef.current) return
    isScanningRef.current = true
    loopActiveRef.current = false
    setScanState('scanning')
    setDetectedText('')
    setDetectedQuery('')
    setCards([])

    const video = webcamRef.current?.video
    if (!video || video.readyState < 2) {
      setScanState('error')
      isScanningRef.current = false
      return
    }

    setDebugImg(null)
    setDebugRaw('')
    setDebugError('')

    try {
      const { textImg, artCanvas } = captureZones(video)
      capturedArtRef.current = artCanvas
      setDebugImg(textImg)

      const ocrResult = await api.ocr(textImg)
      setDebugRaw(JSON.stringify(ocrResult, null, 2))
      const { text } = ocrResult

      if (!text || !text.trim()) {
        setScanState('error')
        isScanningRef.current = false
        return
      }

      const { candidates: foundCandidates } = parseOcrText(text)
      if (foundCandidates.length === 0) {
        setScanState('error')
        isScanningRef.current = false
        return
      }

      setCandidates(foundCandidates)
      isScanningRef.current = false

      // Procesar de inmediato la primera opción (código prioritario o nombre)
      const primary = foundCandidates[0]
      await searchAndMatchVisual(primary, artCanvas)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setDebugError(msg)
      console.error('OCR error', err)
      setScanState('error')
    } finally {
      isScanningRef.current = false
    }
  }, [searchAndMatchVisual])

  const startLoop = useCallback(() => {
    stableRef.current = 0
    prevLumsRef.current = null
    loopActiveRef.current = true

    const tick = () => {
      if (!loopActiveRef.current) return
      if (!isScanningRef.current) {
        const result = analyzeFrame()
        if (result) {
          const { variance, mad } = result
          if (variance > VARIANCE_MIN && mad < MAD_MAX) {
            stableRef.current++
          } else {
            stableRef.current = 0
          }
          const f = stableRef.current
          if (f === 0) {
            setScanState('ready')
            drawOverlay('#64748b')
          } else if (f < STABLE_NEEDED) {
            setScanState('detecting')
            drawOverlay('#facc15')
          } else {
            stableRef.current = 0
            drawOverlay('#22c55e')
            doScan()
            return
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [analyzeFrame, drawOverlay, doScan])

  const stopLoop = useCallback(() => {
    loopActiveRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    const t = setTimeout(startLoop, 1000)
    return () => {
      clearTimeout(t)
      stopLoop()
    }
  }, [cameraOn, startLoop, stopLoop])

  const handleUserMedia = useCallback(() => {
    const video = webcamRef.current?.video
    const overlay = overlayRef.current
    if (!video || !overlay) return
    const syncSize = () => {
      if (video.clientWidth > 0) {
        overlay.width = video.clientWidth
        overlay.height = video.clientHeight
        drawOverlay('#64748b')
      } else {
        requestAnimationFrame(syncSize)
      }
    }
    syncSize()
  }, [drawOverlay])

  const handleScanAgain = useCallback(() => {
    setCards([])
    setCandidates([])
    setDetectedText('')
    setDetectedQuery('')
    capturedArtRef.current = null
    isScanningRef.current = false
    setScanState('ready')
    drawOverlay('#64748b')
    startLoop()
  }, [drawOverlay, startLoop])

  const statusLabel: Record<ScanState, string> = {
    ready: 'Centra la carta en el marco (63 × 88 mm)',
    detecting: 'Carta detectada, mantén quieta…',
    scanning: 'Leyendo código y texto con OCR…',
    matching: 'Comparando variantes visuales con OpenCV…',
    choosing: 'Selecciona el texto a buscar',
    done: cards.length > 0 ? `${cards.length} resultado(s) encontrado(s)` : 'Sin resultados',
    error: 'No se identificó la carta. Intenta de nuevo o pulsa Escanear.',
  }
  const statusColor: Record<ScanState, string> = {
    ready: 'text-slate-300',
    detecting: 'text-yellow-400 font-semibold',
    scanning: 'text-blue-400 font-semibold animate-pulse',
    matching: 'text-purple-400 font-semibold animate-pulse',
    choosing: 'text-blue-300',
    done: cards.length > 0 ? 'text-green-400 font-semibold' : 'text-slate-400',
    error: 'text-red-400 font-semibold',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold text-white">📷 Escáner One Piece</h1>
        {cameraOn && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 ${
              cvReady ? 'bg-purple-900/60 text-purple-300 border border-purple-700/50' : 'bg-slate-800 text-slate-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${cvReady ? 'bg-purple-400 animate-ping' : 'bg-slate-500'}`} />
            {cvReady ? 'OpenCV activo' : 'Iniciando visión…'}
          </span>
        )}
      </div>

      <div className="max-w-md mx-auto">
        {!cameraOn ? (
          <div className="text-center py-10 bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">
              🃏
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Escáner con IA y Visión Computarizada</h2>
            <p className="text-slate-400 text-sm mb-6 max-w-xs mx-auto">
              Encuadra tu carta física (63 × 88 mm). El sistema lee el código en la esquina inferior derecha y usa OpenCV para identificar variantes y artes alternativos al instante.
            </p>
            <button
              onClick={() => setCameraOn(true)}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
            >
              <span>📷</span>
              <span>Activar cámara</span>
            </button>
          </div>
        ) : (
          <>
            {/* Cámara + marco overlay */}
            <div className="relative rounded-2xl overflow-hidden bg-black mb-3 shadow-xl border border-slate-800">
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1920, min: 1280 },
                  height: { ideal: 1080, min: 720 },
                }}
                className="w-full block"
                onUserMedia={handleUserMedia}
              />
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Botón flotante para reintentar rápido */}
              {(scanState === 'error' || scanState === 'done') && (
                <button
                  onClick={handleScanAgain}
                  title="Escanear de nuevo"
                  className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white text-lg transition-colors shadow-lg"
                >
                  ↺
                </button>
              )}
            </div>

            {/* Botón de captura manual inmediata */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => doScan()}
                disabled={scanState === 'scanning' || scanState === 'matching'}
                className="flex-1 py-3 px-4 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-950 font-bold rounded-xl shadow-lg shadow-yellow-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <span>📸</span>
                <span>Escanear ahora</span>
              </button>
              <button
                onClick={handleScanAgain}
                title="Reiniciar encuadre"
                className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl transition-colors border border-slate-700"
              >
                ↺
              </button>
            </div>

            {/* Estado del escáner */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 mb-3 text-center">
              <p className={`text-xs md:text-sm font-medium ${statusColor[scanState]}`}>
                {statusLabel[scanState]}
              </p>
            </div>

            {/* Texto / Código detectado */}
            {detectedText && (
              <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 mb-3 flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs">Identificado:</p>
                  <p className="text-white font-mono font-bold text-sm">{detectedText}</p>
                </div>
                <Link
                  to={`/search?q=${encodeURIComponent(detectedQuery)}`}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-blue-400 px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  🔍 Buscar en BD
                </Link>
              </div>
            )}

            {/* Otras opciones detectadas si hubo ambigüedad */}
            {candidates.length > 1 && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 mb-3">
                <p className="text-slate-400 text-xs mb-2">Otros textos leídos (toca para buscar):</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.slice(1).map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (capturedArtRef.current) {
                          searchAndMatchVisual(c, capturedArtRef.current)
                        }
                      }}
                      className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors"
                    >
                      <span className="font-mono">{c.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Resultados (cuando no hubo match directo o para elegir entre variantes) */}
            {scanState === 'done' && (
              <div className="mb-4">
                {cards.length > 0 ? (
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Cartas coincidentes:</p>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {cards.map((card, idx) => {
                        const locale = card.locales.en ?? card.locales.jp
                        const isTop = idx === 0 && card.visualScore != null && card.visualScore > 20
                        return (
                          <button
                            key={card.card_code}
                            onClick={() => setSelectedCard(card.card_code)}
                            className={`relative rounded-xl p-2 text-left transition-all ${
                              isTop
                                ? 'bg-slate-800 ring-2 ring-purple-500 shadow-lg shadow-purple-900/30 hover:bg-slate-700'
                                : 'bg-slate-800 hover:bg-slate-700'
                            }`}
                          >
                            {card.visualScore != null && card.visualScore > 0 && (
                              <span
                                className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow z-10 ${
                                  isTop ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                🎯 {card.visualScore}%
                              </span>
                            )}
                            {locale?.img_url && (
                              <img src={proxyImg(locale.img_url)!} alt={locale.name} className="w-full rounded-lg mb-1.5" />
                            )}
                            <p className="text-xs font-mono font-bold text-slate-300">{card.card_code}</p>
                            <p className="text-xs text-white truncate">{locale?.name}</p>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm text-center mb-3">
                    Sin resultados. Ajusta la iluminación y encuadra nuevamente.
                  </p>
                )}
                <button
                  onClick={handleScanAgain}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-blue-600/20"
                >
                  Escanear otra carta
                </button>
              </div>
            )}

            {scanState === 'error' && (
              <div className="text-center py-2">
                <p className="text-red-400 text-xs mb-2">No se detectó el código con claridad. Asegúrate de enfocar la esquina inferior derecha.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Hidden canvas para análisis de estabilidad */}
      <canvas ref={analysisRef} className="hidden" aria-hidden="true" />

      {/* Modal directo de la carta encontrada */}
      {selectedCard && <CardModal cardCode={selectedCard} onClose={() => setSelectedCard(null)} />}
    </div>
  )
}
