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

const GUIDE = { x: 0.15, y: 0.08, w: 0.70, h: 0.84 }

// Franja inferior de la carta donde está el nombre, tipo y código (~30% inferior)
const TEXT_ZONE_START = 0.68
const TEXT_ZONE_HEIGHT = 0.30

// Zona superior donde está la ilustración para OpenCV (~58% de la carta)
const ART_ZONE_START = 0.08
const ART_ZONE_HEIGHT = 0.58

const STABLE_NEEDED = 10
const VARIANCE_MIN = 400
const MAD_MAX = 6

// Códigos One Piece: OP01-001, ST01-001, EB01-001, P-001, PRB01-001
const CODE_RE = /\b((?:OP|ST|EB|PRB?|P)\s*[-–—]?\s*\d{1,3}\s*[-–—]\s*\d{3}(?:_p\d+|_r\d+)?)\b/gi
const PROMO_RE = /\b(P\s*[-–—]\s*\d{2,3}(?:_p\d+)?)\b/gi

// Tipos de carta One Piece — excluir de la búsqueda
const CARD_TYPES = new Set([
  'CHARACTER', 'LEADER', 'EVENT', 'STAGE', 'DON', 'DON!!', 'DONII',
  'キャラクター', 'リーダー', 'イベント', 'ステージ', 'ドン!!', 'ドン！！',
])
const CARD_TYPE_PREFIXES = ['CHARAC', 'LEADER', 'NATION', 'ATTRIB', 'TRIGGE', 'COUNTE', 'mination', 'ano']

function cleanOcrString(raw: string): string {
  return raw
    .replace(/\b0P(?=\d)/gi, 'OP')
    .replace(/\bS[7T](?=\d)/gi, 'ST')
    .replace(/\bEB(?=\d)/gi, 'EB')
    .replace(/\bPRB(?=\d)/gi, 'PRB')
    .replace(/([A-Z0-9]{1,4})\s*[-–—]\s*(\d{3})/gi, '$1-$2')
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

  // 1. Códigos de carta (máxima prioridad)
  const codes = cleanedRaw.match(CODE_RE) || cleanedRaw.match(PROMO_RE)
  if (codes) {
    codes.forEach((c) => {
      const normalized = c.toUpperCase().replace(/\s+/g, '').replace(/[-–—]/g, '-')
      add(normalized, true)
    })
  }

  // 2. Líneas del texto para nombres
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
        !/©|Toei|Animation|^\d+$/.test(l) &&
        !/^\d{4}$/.test(l.trim())
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
    const factor = 1.35
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
  const cardTop = H * GUIDE.y
  const cardH = H * GUIDE.h
  const cardLeft = Math.floor(W * GUIDE.x)
  const cardW = Math.floor(W * GUIDE.w)

  // 1. Zona de texto para OCR (aumentada y con filtro de contraste)
  const ty = Math.floor(cardTop + cardH * TEXT_ZONE_START)
  const th = Math.floor(cardH * TEXT_ZONE_HEIGHT)
  const SCALE = 2.5
  const textCanvas = document.createElement('canvas')
  textCanvas.width = Math.floor(cardW * SCALE)
  textCanvas.height = Math.floor(th * SCALE)
  const tCtx = textCanvas.getContext('2d')!
  tCtx.imageSmoothingEnabled = true
  tCtx.imageSmoothingQuality = 'high'
  tCtx.fillStyle = '#ffffff'
  tCtx.fillRect(0, 0, textCanvas.width, textCanvas.height)
  tCtx.drawImage(video, cardLeft, ty, cardW, th, 0, 0, textCanvas.width, textCanvas.height)
  enhanceContrast(tCtx, textCanvas.width, textCanvas.height)

  // 2. Zona de ilustración para OpenCV
  const ay = Math.floor(cardTop + cardH * ART_ZONE_START)
  const ah = Math.floor(cardH * ART_ZONE_HEIGHT)
  const artCanvas = document.createElement('canvas')
  artCanvas.width = 300
  artCanvas.height = Math.round(300 * (ah / cardW))
  const aCtx = artCanvas.getContext('2d')!
  aCtx.imageSmoothingEnabled = true
  aCtx.imageSmoothingQuality = 'high'
  aCtx.drawImage(video, cardLeft, ay, cardW, ah, 0, 0, artCanvas.width, artCanvas.height)

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

  // Precargar OpenCV en segundo plano cuando se activa la cámara
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
    const x = W * GUIDE.x
    const y = H * GUIDE.y
    const w = W * GUIDE.w
    const h = H * GUIDE.h
    const r = 14
    const cs = 20

    ctx.clearRect(0, 0, W, H)

    // Dim outer area
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, W, H)

    // Punch out guide area
    ctx.globalCompositeOperation = 'destination-out'
    drawRoundRect(ctx, x, y, w, h, r)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'

    // Guide border
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    drawRoundRect(ctx, x, y, w, h, r)
    ctx.stroke()

    // Corner accents
    ctx.lineWidth = 4
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

    // Franja de lectura OCR (zona inferior de la carta)
    const zoneY = y + h * TEXT_ZONE_START
    const zoneH = h * TEXT_ZONE_HEIGHT
    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)'
    ctx.fillRect(x, zoneY, w, zoneH)
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(x, zoneY, w, zoneH)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(250, 204, 21, 0.85)'
    ctx.font = `bold ${Math.max(9, W * 0.022)}px sans-serif`
    ctx.fillText('zona de lectura', x + 4, zoneY - 3)
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

    const gx = Math.floor(W * GUIDE.x)
    const gy = Math.floor(H * GUIDE.y)
    const gw = Math.floor(W * GUIDE.w)
    const gh = Math.floor(H * GUIDE.h)
    const { data } = ctx.getImageData(gx, gy, gw, gh)

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

  // Comparación visual con OpenCV de las candidatas encontradas
  const runVisualComparison = useCallback(
    async (candidateCards: Card[], capturedArt: HTMLCanvasElement) => {
      if (candidateCards.length <= 1) {
        setCards(candidateCards)
        setScanState('done')
        return
      }

      try {
        setScanState('matching')
        const cv = await loadOpenCV()
        const scored: ScoredCard[] = []

        // Comparar contra las variantes principales (hasta 8)
        const toCheck = candidateCards.slice(0, 8)
        for (const card of toCheck) {
          const locale = card.locales.en ?? card.locales.jp
          const imgUrl = locale?.img_url ? proxyImg(locale.img_url) : null
          if (!imgUrl) {
            scored.push({ ...card, visualScore: 0, visualMatches: 0 })
            continue
          }

          try {
            const imgEl = await preloadImage(imgUrl)
            const result = compareWithORB(cv, capturedArt, imgEl)
            scored.push({
              ...card,
              visualScore: result.score,
              visualMatches: result.matches,
            })
          } catch {
            scored.push({ ...card, visualScore: 0, visualMatches: 0 })
          }
        }

        // Ordenar con el mejor puntaje visual al inicio
        scored.sort((a, b) => (b.visualScore ?? 0) - (a.visualScore ?? 0))
        setCards(scored)
        setScanState('done')
      } catch (err) {
        console.warn('Matching visual omitido:', err)
        setCards(candidateCards)
        setScanState('done')
      }
    },
    []
  )

  const searchByCandidate = useCallback(
    async (query: string, isCode: boolean, artCanvas?: HTMLCanvasElement | null) => {
      setScanState('scanning')
      try {
        let found: Card[] = []
        if (isCode) {
          const clean = query.toUpperCase().replace(/\s+/g, '').replace(/[-–—]/g, '-')
          const res = await api.getCards({ q: clean, limit: 12 })
          found = res.data || []
          if (found.length === 0) {
            try {
              const single = await api.getCard(clean)
              if (single) found = [single]
            } catch {}
          }
        } else {
          const res = await api.getCards({ q: query, limit: 12 })
          found = res.data || []
        }

        setDetectedText(isCode ? `Código: ${query}` : `"${query}"`)
        setDetectedQuery(query)

        const art = artCanvas || capturedArtRef.current
        if (found.length > 1 && art) {
          await runVisualComparison(found, art)
        } else {
          setCards(found)
          setScanState('done')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setDebugError(msg)
        setScanState('error')
      }
    },
    [runVisualComparison]
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
    if (!video) {
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

      if (!text.trim()) {
        setScanState('error')
        isScanningRef.current = false
        return
      }

      const { candidates } = parseOcrText(text)
      if (candidates.length === 0) {
        setScanState('error')
        isScanningRef.current = false
        return
      }

      if (candidates.length === 1) {
        isScanningRef.current = false
        await searchByCandidate(candidates[0].query, candidates[0].isCode, artCanvas)
      } else {
        setCandidates(candidates)
        setScanState('choosing')
        isScanningRef.current = false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setDebugError(msg)
      console.error('OCR error', err)
      setScanState('error')
    } finally {
      isScanningRef.current = false
    }
  }, [searchByCandidate])

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
            drawOverlay('#6b7280')
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
        drawOverlay('#6b7280')
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
    drawOverlay('#6b7280')
    startLoop()
  }, [drawOverlay, startLoop])

  const statusLabel: Record<ScanState, string> = {
    ready: 'Centra la carta dentro del marco',
    detecting: 'Carta detectada, no muevas…',
    scanning: 'Analizando texto con OCR…',
    matching: 'Comparando variantes visuales con OpenCV…',
    choosing: 'Selecciona el texto a buscar',
    done: cards.length > 0 ? `${cards.length} resultado(s) encontrado(s)` : 'Sin resultados',
    error: 'No se identificó la carta. Intenta de nuevo.',
  }
  const statusColor: Record<ScanState, string> = {
    ready: 'text-slate-400',
    detecting: 'text-yellow-400',
    scanning: 'text-blue-400',
    matching: 'text-purple-400 font-semibold animate-pulse',
    choosing: 'text-blue-300',
    done: cards.length > 0 ? 'text-green-400' : 'text-slate-400',
    error: 'text-red-400',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">📷 Escáner</h1>
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

      <div className="max-w-sm mx-auto">
        {!cameraOn ? (
          <div className="text-center py-10">
            <p className="text-slate-400 text-sm mb-5">
              La cámara detectará la carta automáticamente cuando esté centrada y estable en el marco.
            </p>
            <button
              onClick={() => setCameraOn(true)}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
            >
              📷 Activar cámara
            </button>
          </div>
        ) : (
          <>
            {/* Camera + overlay */}
            <div className="relative rounded-xl overflow-hidden bg-black mb-2">
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
              {/* Botón reintentar flotante — solo visible en error o done */}
              {(scanState === 'error' || scanState === 'done') && (
                <button
                  onClick={handleScanAgain}
                  title="Escanear de nuevo"
                  className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white text-lg transition-colors"
                >
                  ↺
                </button>
              )}
            </div>

            {/* Status label */}
            <p className={`text-sm text-center mb-3 font-medium min-h-[1.25rem] ${statusColor[scanState]}`}>
              {statusLabel[scanState]}
            </p>

            {/* Selección de candidatos */}
            {scanState === 'choosing' && candidates.length > 0 && (
              <div className="bg-slate-800 rounded-lg p-3 mb-3">
                <p className="text-slate-400 text-xs mb-2">Se encontraron varios textos, ¿cuál busco?</p>
                <div className="flex flex-col gap-2">
                  {candidates.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => searchByCandidate(c.query, c.isCode, capturedArtRef.current)}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-left transition-colors"
                    >
                      {c.isCode ? (
                        <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded font-mono">Cód</span>
                      ) : (
                        <span className="text-xs bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded">Nom</span>
                      )}
                      <span className="text-white text-sm font-mono truncate">{c.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Detected text */}
            {detectedText && (
              <div className="bg-slate-800 rounded-lg p-3 mb-3">
                <p className="text-slate-400 text-xs mb-1">Texto detectado:</p>
                <Link
                  to={`/search?q=${encodeURIComponent(detectedQuery)}`}
                  className="text-blue-400 hover:text-blue-300 text-sm font-mono underline"
                >
                  {detectedText}
                </Link>
              </div>
            )}

            {/* Results */}
            {scanState === 'done' && (
              <div className="mb-4">
                {cards.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {cards.map((card) => {
                      const locale = card.locales.en ?? card.locales.jp
                      const isTopVisual =
                        card.visualScore != null && card.visualScore > 25 && cards.length > 1
                      return (
                        <button
                          key={card.card_code}
                          onClick={() => setSelectedCard(card.card_code)}
                          className={`relative rounded-lg p-2 text-left transition-all ${
                            isTopVisual
                              ? 'bg-slate-700 ring-2 ring-purple-500 shadow-lg shadow-purple-900/30 hover:bg-slate-600'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                        >
                          {isTopVisual && (
                            <span className="absolute top-1.5 right-1.5 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow z-10">
                              🎯 {card.visualScore}%
                            </span>
                          )}
                          {locale?.img_url && (
                            <img src={proxyImg(locale.img_url)!} alt={locale.name} className="w-full rounded mb-1" />
                          )}
                          <p className="text-xs font-mono text-slate-300">{card.card_code}</p>
                          <p className="text-xs text-white truncate">{locale?.name}</p>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm text-center mb-3">
                    Sin resultados. Intenta con otro ángulo o iluminación.
                  </p>
                )}
                {detectedQuery && (
                  <Link
                    to={`/search?q=${encodeURIComponent(detectedQuery)}`}
                    className="block w-full py-2 mb-2 bg-slate-600 hover:bg-slate-500 text-white text-sm font-bold rounded-lg transition-colors text-center"
                  >
                    🔍 Ver todos los resultados
                  </Link>
                )}
                <button
                  onClick={handleScanAgain}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  Escanear de nuevo
                </button>
              </div>
            )}

            {scanState === 'error' && (
              <p className="text-red-400 text-xs text-center mb-2">No se identificó. Usa ↺ para reintentar.</p>
            )}
          </>
        )}
      </div>

      {/* Hidden canvas for frame analysis */}
      <canvas ref={analysisRef} className="hidden" aria-hidden="true" />

      {selectedCard && <CardModal cardCode={selectedCard} onClose={() => setSelectedCard(null)} />}
    </div>
  )
}
