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

interface DebugMatchInfo {
  card_code: string
  name: string
  img_url: string | null
  visualScore: number
  visualMatches: number
  passedThreshold: boolean
}

// Proporciones exactas de cartas One Piece: 63 mm × 88 mm
export const CARD_RATIO = 63 / 88 // 0.715909...

export function getGuideRect(W: number, H: number, scale = 0.74) {
  let h = H * scale
  let w = h * CARD_RATIO
  if (w > W * 0.90) {
    w = W * 0.90
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

// Mapeo exacto entre la pantalla del usuario (CSS object-cover) y los píxeles reales del sensor de video
export function getVideoGuideRect(video: HTMLVideoElement, scale = 0.74) {
  const W_disp = video.clientWidth || 360
  const H_disp = video.clientHeight || 480
  const W_vid = video.videoWidth || W_disp
  const H_vid = video.videoHeight || H_disp

  // Escala que aplica object-cover al video para llenar el contenedor
  const s = Math.max(W_disp / W_vid, H_disp / H_vid)
  const W_rend = W_vid * s
  const H_rend = H_vid * s
  const dx = (W_rend - W_disp) / 2
  const dy = (H_rend - H_disp) / 2

  // Rectángulo guía en coordenadas de la pantalla (lo que ve el usuario)
  const dispGuide = getGuideRect(W_disp, H_disp, scale)

  // Mapeo exacto hacia coordenadas del sensor de video original
  const vx = Math.round((dispGuide.x + dx) / s)
  const vy = Math.round((dispGuide.y + dy) / s)
  const vw = Math.round(dispGuide.w / s)
  const vh = Math.round(dispGuide.h / s)

  return {
    dispGuide,
    videoGuide: {
      x: Math.max(0, vx),
      y: Math.max(0, vy),
      w: Math.min(W_vid - vx, vw),
      h: Math.min(H_vid - vy, vh),
    },
    s,
    dx,
    dy,
  }
}

// Calibración optimizada para dar tiempo de centrar el ID y evitar fotos con movimiento
const STABLE_NEEDED = 7 // Requiere ~600-700ms de calma sostenida para enfocar y centrar
const VARIANCE_MIN = 110 // Detecta presencia de la carta
const MAD_MAX = 7.5 // Si la mano se mueve para centrar (MAD > 7.5), NO dispara; espera a que se detenga

// Códigos One Piece: OP01-001, OP15-083, EB04-061, ST01-001, P-001, PRB01-001
const CODE_RE = /\b((?:OP|ST|EB|PRB?|P)\s*[-–—._/]?\s*\d{1,3}\s*[-–—._/]?\s*\d{2,3}(?:_p\d+|_r\d+)?)\b/gi
const PROMO_RE = /\b(P\s*[-–—._/]?\s*\d{2,3}(?:_p\d+)?)\b/gi

// Tipos y palabras reservadas a ignorar en OCR
const CARD_TYPES = new Set([
  'CHARACTER', 'LEADER', 'EVENT', 'STAGE', 'DON', 'DON!!', 'DONII',
  'キャラクター', 'リーダー', 'イベント', 'ステージ', 'ドン!!', 'ドン！！',
])
const CARD_TYPE_PREFIXES = ['CHARAC', 'LEADER', 'NATION', 'ATTRIB', 'TRIGGE', 'COUNTE', 'mination', 'ano', 'SPECIAL', 'SLASH', 'STRIKE']

// Palabras clave de reglas y efectos para no confundir párrafos de habilidades con el nombre del personaje
const EFFECT_KEYWORDS = new Set([
  'ACTIVATE', 'MAIN', 'ONCE', 'TURN', 'YOU', 'MAY', 'TRASH', 'THIS',
  'CHARACTER', 'CHARACTERS', 'GIVE', 'OPPONENT', 'OPPONENTS', 'RESTED', 'ACTIVE',
  'DON', 'DON!!', 'DONII', 'COUNTER', 'TRIGGER', 'BLOCKER', 'PLAY',
  'WHEN', 'ATTACKING', 'ON', 'BATTLE', 'LIFE', 'DECK', 'HAND', 'COST',
  'POWER', 'STRIKE', 'SLASH', 'SPECIAL', 'WISDOM', 'RANGED', 'STAGE',
  'LEADER', 'EVENT', 'TYPE', 'ATTRIBUTE', 'CARD', 'CARDS', 'TARGET',
  'DRAW', 'RETURN', 'PLACE', 'REST', 'UP', 'TO', 'AFFILIATIONS',
  'EAST', 'BLUE', 'BLACK', 'CAT', 'PIRATES', 'STRAW', 'HAT', 'NAVY',
  'FISH', 'MAN', 'ANIME', 'TOEI', 'ANIMATION', 'BANDAI', 'MADE',
  'JAPAN', 'EIICHIRO', 'ODA', 'SHUEISHA'
])

function cleanOcrString(raw: string): string {
  return raw
    .replace(/\b[0O]P(?=\d|[ -])/gi, 'OP')
    .replace(/\bOP[oO](?=\d)/gi, 'OP0')
    .replace(/\bS[7T](?=\d|[ -])/gi, 'ST')
    .replace(/\bEB(?=\d|[ -])/gi, 'EB')
    .replace(/\bPRB(?=\d|[ -])/gi, 'PRB')
    .replace(/\b(OP|ST|EB|PRB|P)[ -]?(\d{1,3})[ -]+(\d{2,3})/gi, '$1$2-$3')
    .replace(/\b(OP|ST|EB|PRB)(\d{2})(\d{3})\b/gi, '$1$2-$3')
    .replace(/([A-Z0-9]{1,4})\s*[-–—._/]\s*(\d{2,3})/gi, '$1-$2')
}

function normalizeFoundCode(raw: string): string {
  let c = raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[–—._/]/g, '-')
    .replace(/^0P/i, 'OP')
    .replace(/^S[7T]/i, 'ST')

  // Limpiar rareza pegada al final (ej. OP02-028C, OP05-083R -> OP02-028, OP05-083)
  c = c.replace(/(?:_?)(?:SEC|SR|UC|SP|C|R|L)$/i, '')

  // Casos donde el OCR no leyó el guión (ej. OP15083 -> OP15-083)
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
    const k = q.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (k.length >= 2 && !seen.has(k)) {
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
  const rawLines = raw.split('\n')
  for (const line of rawLines) {
    const trimmed = line
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF65-\uFF9F &.'\-_()']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (trimmed.length < 2 || trimmed.length > 35) continue

    const upper = trimmed.toUpperCase()
    // Descartar si es código (ya procesado en paso 1)
    if (CODE_RE.test(trimmed) || PROMO_RE.test(trimmed)) continue
    // Descartar tipo de carta o cabecera
    if (CARD_TYPES.has(upper) || CARD_TYPE_PREFIXES.some((p) => upper.startsWith(p))) continue
    // Descartar editorial / copyright / país
    if (/©|TOEI|ANIMATION|BANDAI|JAPAN|SHUEISHA|EIICHIRO|NOT FOR SALE/i.test(trimmed)) continue
    // Descartar números puros (poder, coste, etc.)
    if (/^\d+$/.test(trimmed)) continue

    // Descartar si contiene palabras típicas de reglas/efectos
    const words = upper.split(/\s+/).map((w) => w.replace(/'S$/, '').replace(/[^A-Z0-9]/g, ''))
    const effectWords = words.filter((w) => EFFECT_KEYWORDS.has(w))
    if (effectWords.length > 0 && (words.length >= 3 || effectWords.length >= words.length * 0.35)) continue
    if (words.some((w) => ['OPPONENT', 'CHARACTER', 'CHARACTERS', 'CARD', 'CARDS', 'RESTED', 'DON'].includes(w))) continue

    add(trimmed, false)
    const stripped = trimmed.replace(/[.'\-_()']/g, ' ').replace(/\s+/g, ' ').trim()
    if (stripped !== trimmed && stripped.length >= 2) {
      add(stripped, false)
    }
  }

  return { candidates: result.slice(0, 8) }
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

function captureZones(video: HTMLVideoElement, scale = 0.74): { textImg: string; artCanvas: HTMLCanvasElement } {
  // Usar mapeo exacto de coordenadas de la pantalla a los píxeles reales del video
  const { videoGuide } = getVideoGuideRect(video, scale)
  const guide = videoGuide

  // 1. Carta completa normalizada para comparación OpenCV (300 x 419, ratio 63:88)
  const artCanvas = document.createElement('canvas')
  artCanvas.width = 300
  artCanvas.height = 419
  const aCtx = artCanvas.getContext('2d')!
  aCtx.imageSmoothingEnabled = true
  aCtx.imageSmoothingQuality = 'high'
  aCtx.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, 300, 419)

  // 2. Extracción enfocada para OCR:
  // Zona A: ID / Código en esquina inferior derecha
  // Ocupa del 48% al 98% horizontal y del 78% al 98% vertical (20% de altura)
  // Con este tamaño y mapeo 1:1, NUNCA cae fuera de la carta ni en la mesa
  const codeSrcX = Math.floor(guide.x + guide.w * 0.48)
  const codeSrcY = Math.floor(guide.y + guide.h * 0.78)
  const codeSrcW = Math.floor(guide.w * 0.50)
  const codeSrcH = Math.floor(guide.h * 0.20)

  const CODE_ZOOM = 2.8
  const codeDstW = Math.floor(codeSrcW * CODE_ZOOM)
  const codeDstH = Math.floor(codeSrcH * CODE_ZOOM)

  // Zona B: Franja de Nombre del Personaje (x: 5% a 95%, y: 70% a 88%)
  const nameSrcX = Math.floor(guide.x + guide.w * 0.05)
  const nameSrcY = Math.floor(guide.y + guide.h * 0.70)
  const nameSrcW = Math.floor(guide.w * 0.90)
  const nameSrcH = Math.floor(guide.h * 0.18)

  const NAME_ZOOM = 2.2
  const nameDstW = Math.floor(nameSrcW * NAME_ZOOM)
  const nameDstH = Math.floor(nameSrcH * NAME_ZOOM)

  // Canvas compuesto: Apila la Zona de Código (arriba) y la Zona de Nombre (abajo)
  const sep = 16
  const totalW = Math.max(codeDstW, nameDstW)
  const totalH = codeDstH + nameDstH + sep

  const textCanvas = document.createElement('canvas')
  textCanvas.width = totalW
  textCanvas.height = totalH
  const tCtx = textCanvas.getContext('2d')!
  tCtx.imageSmoothingEnabled = true
  tCtx.imageSmoothingQuality = 'high'
  tCtx.fillStyle = '#ffffff'
  tCtx.fillRect(0, 0, totalW, totalH)

  // Dibujar Código ampliado arriba
  tCtx.drawImage(video, codeSrcX, codeSrcY, codeSrcW, codeSrcH, 0, 0, codeDstW, codeDstH)

  // Separador blanco
  tCtx.fillStyle = '#ffffff'
  tCtx.fillRect(0, codeDstH, totalW, sep)

  // Dibujar Nombre abajo
  tCtx.drawImage(video, nameSrcX, nameSrcY, nameSrcW, nameSrcH, 0, codeDstH + sep, nameDstW, nameDstH)

  // Realzar contraste para maximizar legibilidad en Google Cloud Vision
  enhanceContrast(tCtx, totalW, totalH)

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
  const containerRef = useRef<HTMLDivElement>(null)
  const analysisRef = useRef<HTMLCanvasElement>(null)
  const capturedArtRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const stableRef = useRef(0)
  const prevLumsRef = useRef<number[] | null>(null)
  const loopActiveRef = useRef(false)
  const isScanningRef = useRef(false)

  // Tamaño de marco fijo con proporción física One Piece (63 mm × 88 mm)
  const DEFAULT_CARD_SCALE = 0.74

  const [cameraOn, setCameraOn] = useState(false)
  const [cvReady, setCvReady] = useState(false)
  const [scanState, setScanState] = useState<ScanState>('ready')
  const [isCovered, setIsCovered] = useState(false)
  const [detectedText, setDetectedText] = useState('')
  const [detectedQuery, setDetectedQuery] = useState('')
  const [candidates, setCandidates] = useState<{ query: string; isCode: boolean }[]>([])
  const [cards, setCards] = useState<ScoredCard[]>([])
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<string>('')

  // Datos para el panel de diagnóstico (Debug)
  const [capturedArtData, setCapturedArtData] = useState<string | null>(null)
  const [capturedTextData, setCapturedTextData] = useState<string | null>(null)
  const [debugMatches, setDebugMatches] = useState<DebugMatchInfo[]>([])
  const [debugError, setDebugError] = useState<string>('')

  // Precargar OpenCV en segundo plano al iniciar la cámara
  useEffect(() => {
    if (!cameraOn) return
    loadOpenCV()
      .then(() => setCvReady(true))
      .catch((e) => console.warn('OpenCV lazy load:', e))
  }, [cameraOn])

  // Dibujar ÚNICAMENTE las esquinas del cuadro (Corner Brackets) y la línea guía OCR
  const drawOverlay = useCallback((color: string, progress = 0) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const container = containerRef.current
    if (container && container.clientWidth > 0 && (canvas.width <= 300 || canvas.height <= 150)) {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    }
    const W = canvas.width
    const H = canvas.height
    if (W < 100 || H < 100) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Marco proporcional exacto 63 mm × 88 mm
    const guide = getGuideRect(W, H, DEFAULT_CARD_SCALE)
    const { x, y, w, h } = guide
    const r = 16
    const cornerLen = Math.max(22, Math.round(w * 0.14))

    ctx.clearRect(0, 0, W, H)

    // 1. Atenuado exterior suave con la carta recortada en el centro
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, W, H)

    ctx.globalCompositeOperation = 'destination-out'
    drawRoundRect(ctx, x, y, w, h, r)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'

    // 2. SOLO las 4 esquinas del cuadro (Corner Brackets)
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Esquina Superior Izquierda ┌
    ctx.beginPath()
    ctx.moveTo(x, y + cornerLen)
    ctx.arcTo(x, y, x + cornerLen, y, r)
    ctx.lineTo(x + cornerLen, y)
    ctx.stroke()

    // Esquina Superior Derecha ┐
    ctx.beginPath()
    ctx.moveTo(x + w - cornerLen, y)
    ctx.arcTo(x + w, y, x + w, y + cornerLen, r)
    ctx.lineTo(x + w, y + cornerLen)
    ctx.stroke()

    // Esquina Inferior Derecha ┘
    ctx.beginPath()
    ctx.moveTo(x + w, y + h - cornerLen)
    ctx.arcTo(x + w, y + h, x + w - cornerLen, y + h, r)
    ctx.lineTo(x + w - cornerLen, y + h)
    ctx.stroke()

    // Esquina Inferior Izquierda └
    ctx.beginPath()
    ctx.moveTo(x + cornerLen, y + h)
    ctx.arcTo(x, y + h, x, y + h - cornerLen, r)
    ctx.lineTo(x, y + h - cornerLen)
    ctx.stroke()

    // 3. Línea guía para la franja de nombre (al ~74% de la altura de la carta) sin texto
    const nameLineY = Math.round(y + h * 0.74)
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(x + 12, nameLineY)
    ctx.lineTo(x + w - 12, nameLineY)
    ctx.stroke()
    ctx.setLineDash([])

    // 4. Recuadro guía en esquina inferior derecha para el Nº / ID de Carta (OPxx-xxx)
    // Cubre del 48% al 98% horizontal y del 78% al 98% vertical para coincidir exactamente con el crop
    const codeBoxX = Math.round(x + w * 0.48)
    const codeBoxY = Math.round(y + h * 0.78)
    const codeBoxW = Math.round(w * 0.50)
    const codeBoxH = Math.round(h * 0.20)
    const codeR = 6

    ctx.strokeStyle = color === '#22c55e' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(96, 165, 250, 0.85)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    drawRoundRect(ctx, codeBoxX, codeBoxY, codeBoxW, codeBoxH, codeR)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = color === '#22c55e' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(96, 165, 250, 0.95)'
    ctx.font = `bold ${Math.max(9, Math.round(w * 0.028))}px monospace`
    ctx.textAlign = 'right'
    ctx.fillText('🔍 Zona ID (OPxx-xxx)', codeBoxX + codeBoxW - 4, codeBoxY - 4)
    ctx.textAlign = 'left'

    // 5. Barra de progreso visual cuando el usuario mantiene quieta la carta
    if (progress > 0 && progress < 1) {
      const barTotalW = w - 32
      const barProgW = Math.round(barTotalW * progress)
      const barX = x + 16
      const barY = y + h - 8
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)'
      drawRoundRect(ctx, barX, barY, barTotalW, 5, 2.5)
      ctx.fill()
      ctx.fillStyle = 'rgba(250, 204, 21, 0.95)'
      drawRoundRect(ctx, barX, barY, barProgW, 5, 2.5)
      ctx.fill()
    }
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

    const { videoGuide } = getVideoGuideRect(video, DEFAULT_CARD_SCALE)
    const { data } = ctx.getImageData(videoGuide.x, videoGuide.y, videoGuide.w, videoGuide.h)

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
      setScanState('matching')
      setBatchProgress('')
      try {
        let found: Card[] = []
        if (candidate.isCode) {
          const clean = normalizeFoundCode(candidate.query)
          const res = await api.getCards({ q: clean, limit: 20 })
          found = res.data || []
          if (found.length === 0) {
            try {
              const single = await api.getCard(clean)
              if (single) found = [single]
            } catch {}
          }
        } else {
          // Búsqueda por NOMBRE (ej. Monkey.D.Luffy, Nami, etc.)
          // Traer todas las cartas disponibles para este personaje
          const firstRes = await api.getCards({ q: candidate.query, limit: 100 })
          found = firstRes.data || []
          if (firstRes.total > found.length && firstRes.pages > 1) {
            for (let p = 2; p <= firstRes.pages; p++) {
              try {
                const nextRes = await api.getCards({ q: candidate.query, limit: 100, page: p })
                if (nextRes.data) found = found.concat(nextRes.data)
              } catch {}
            }
          }
        }

        setDetectedText(candidate.isCode ? `Código: ${candidate.query}` : `"${candidate.query}"`)
        setDetectedQuery(candidate.query)

        if (found.length === 0) {
          setCards([])
          setDebugMatches([])
          setScanState('error')
          return
        }

        // CASO 1: Si solo hay 1 carta que coincide exactamente en BD -> Mostrarla directamente
        if (found.length === 1) {
          setCards(found)
          const loc = found[0].locales.en ?? found[0].locales.jp
          setDebugMatches([
            {
              card_code: found[0].card_code,
              name: loc?.name || '',
              img_url: loc?.img_url ? proxyImg(loc.img_url) : null,
              visualScore: 100,
              visualMatches: 100,
              passedThreshold: true,
            },
          ])
          setSelectedCard(found[0].card_code) // <-- Abre directamente el modal (coincidencia única 100% >= 50%)
          setScanState('done')
          setIsCovered(true)
          loopActiveRef.current = false
          return
        }

        // CASO 2: Comparar con OpenCV
        let cv: any = null
        try {
          cv = await loadOpenCV()
        } catch (cvErr) {
          console.warn('[OpenCV] No disponible o aún cargando en segundo plano:', cvErr)
        }

        const scored: ScoredCard[] = []

        if (!cv) {
          // Si OpenCV no está disponible aún, mostrar las cartas encontradas en la BD
          for (const card of found.slice(0, 10)) {
            scored.push({ ...card, visualScore: 0, visualMatches: 0 })
          }
        } else if (candidate.isCode || found.length <= 5) {
          // Si es búsqueda por código o son pocas cartas (<= 5): evaluar todas directamente
          for (const card of found) {
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
        } else {
          // CASO ESPECIAL: Carta por nombre con muchos resultados (> 5 cartas)
          // Proceso progresivo por lotes solicitado:
          // 1. Lote 1: primeras 5 cartas
          // 2. Si no hay coincidencia >= 50%:
          //    - Si quedan <= 10 restantes: evalúa todas las restantes
          //    - Si quedan > 10 restantes: evalúa por lotes de 20 hasta llegar al total
          const totalCards = found.length
          let currentIndex = 0
          let foundWinner = false

          // Lote 1: primeras 5 cartas
          const firstBatchSize = Math.min(5, totalCards)
          setBatchProgress(`Evaluando lote 1 (1-${firstBatchSize} de ${totalCards})…`)

          for (let i = 0; i < firstBatchSize; i++) {
            const card = found[i]
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

          currentIndex = firstBatchSize

          // Verificar si alguna de las primeras 5 alcanzó >= 50%
          const bestInBatch1 = scored.reduce((max, c) => Math.max(max, c.visualScore ?? 0), 0)
          if (bestInBatch1 >= 50) {
            foundWinner = true
          }

          // Lotes subsiguientes si no se alcanzó el 50%
          let batchNumber = 2
          while (!foundWinner && currentIndex < totalCards) {
            const remaining = totalCards - currentIndex
            const currentBatchSize = remaining <= 10 ? remaining : Math.min(20, remaining)
            const endIndex = currentIndex + currentBatchSize

            setBatchProgress(`Evaluando lote ${batchNumber} (${currentIndex + 1}-${endIndex} de ${totalCards})…`)

            for (let i = currentIndex; i < endIndex; i++) {
              const card = found[i]
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

            currentIndex = endIndex
            batchNumber++

            // Si en este lote apareció una coincidencia >= 50%, detenemos la búsqueda
            const currentBest = scored.reduce((max, c) => Math.max(max, c.visualScore ?? 0), 0)
            if (currentBest >= 50) {
              foundWinner = true
              break
            }
          }
        }

        // Ordenar de mayor a menor coincidencia visual
        scored.sort((a, b) => (b.visualScore ?? 0) - (a.visualScore ?? 0))
        setCards(scored)

        // Registrar datos de diagnóstico visual para depuración
        const debugList: DebugMatchInfo[] = scored.map((c) => {
          const loc = c.locales.en ?? c.locales.jp
          const s = c.visualScore ?? 0
          return {
            card_code: c.card_code,
            name: loc?.name || '',
            img_url: loc?.img_url ? proxyImg(loc.img_url) : null,
            visualScore: s,
            visualMatches: c.visualMatches ?? 0,
            passedThreshold: s >= 50,
          }
        })
        setDebugMatches(debugList)

        const best = scored[0]
        const bestScore = best?.visualScore ?? 0

        // Regla: si se encuentra alguna coincidencia con igual o más del 50%, muestra modal.
        // Si es menor a 50%, NO abre modal y se muestran los 5 resultados más cercanos.
        if (best && bestScore >= 50) {
          setSelectedCard(best.card_code)
        } else {
          setSelectedCard(null)
        }

        setBatchProgress('')
        setScanState('done')
        setIsCovered(true)
        loopActiveRef.current = false
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setDebugError(msg)
        setBatchProgress('')
        setScanState('error')
        setIsCovered(true)
        loopActiveRef.current = false
      }
    },
    []
  )

  const doScan = useCallback(async () => {
    if (isScanningRef.current) return
    isScanningRef.current = true
    loopActiveRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setScanState('scanning')
    setDetectedText('')
    setDetectedQuery('')
    setCards([])
    setDebugMatches([])

    const video = webcamRef.current?.video
    if (!video || video.readyState < 2) {
      setScanState('error')
      setIsCovered(true)
      isScanningRef.current = false
      return
    }

    setDebugError('')

    try {
      const { textImg, artCanvas } = captureZones(video, DEFAULT_CARD_SCALE)
      capturedArtRef.current = artCanvas
      setCapturedArtData(artCanvas.toDataURL('image/jpeg', 0.85))
      setCapturedTextData(textImg)

      const ocrResult = await api.ocr(textImg)
      const { text } = ocrResult

      if (!text || !text.trim()) {
        setScanState('error')
        setIsCovered(true)
        isScanningRef.current = false
        return
      }

      const { candidates: foundCandidates } = parseOcrText(text)
      if (foundCandidates.length === 0) {
        setScanState('error')
        setIsCovered(true)
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
      setIsCovered(true)
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
          // Detección acumulativa suave: no resetea brutalmente a 0 ante micro-movimiento
          const isStable = variance > VARIANCE_MIN && mad < MAD_MAX
          if (isStable) {
            stableRef.current = Math.min(STABLE_NEEDED, stableRef.current + 1)
          } else {
            stableRef.current = Math.max(0, stableRef.current - 1)
          }

          const f = stableRef.current
          if (f === 0) {
            setScanState('ready')
            drawOverlay('#64748b', 0)
          } else if (f < STABLE_NEEDED) {
            setScanState('detecting')
            drawOverlay('#facc15', f / STABLE_NEEDED)
          } else {
            stableRef.current = 0
            drawOverlay('#22c55e', 1)
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

  const syncSize = useCallback(() => {
    const video = webcamRef.current?.video
    const overlay = overlayRef.current
    const container = containerRef.current
    if (!overlay) return

    const w = video?.clientWidth || container?.clientWidth || 0
    const h = video?.clientHeight || container?.clientHeight || 0

    if (w > 0 && h > 0) {
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w
        overlay.height = h
      }
      drawOverlay(scanState === 'detecting' ? '#facc15' : scanState === 'scanning' ? '#22c55e' : '#64748b', 0)
    }
  }, [drawOverlay, scanState])

  // ResizeObserver para redimensionar dinámicamente y sincronizar el canvas sin deformación
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      syncSize()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [syncSize])

  const handleScanAgain = useCallback(() => {
    setSelectedCard(null)
    setCards([])
    setCandidates([])
    setDetectedText('')
    setDetectedQuery('')
    setBatchProgress('')
    setDebugMatches([])
    capturedArtRef.current = null
    isScanningRef.current = false
    setIsCovered(false)
    setScanState('ready')
    drawOverlay('#64748b', 0)
    startLoop()
  }, [drawOverlay, startLoop])

  const statusLabel: Record<ScanState, string> = {
    ready: 'Centra la carta y el código ID en el marco',
    detecting: 'Enfocando... mantén quieta la carta para capturar',
    scanning: 'Leyendo código y texto con OCR…',
    matching: batchProgress || 'Comparando ilustración con OpenCV…',
    choosing: 'Selecciona el texto a buscar',
    done: cards.length > 0 ? `${cards.length} resultado(s) encontrado(s)` : 'Sin resultados',
    error: 'No se identificó el código. Centra la esquina inferior derecha y reintenta.',
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

  // Primeras 5 cartas encontradas en la BD
  const top5Cards = cards.slice(0, 5)

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
              Centra la carta entre las 4 esquinas del marco para escanear.
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
            {/* Cámara + marco proporcional One Piece */}
            <div
              ref={containerRef}
              className="relative w-full aspect-[3/4] max-h-[70vh] rounded-2xl overflow-hidden bg-black mb-3 shadow-xl border border-slate-800"
            >
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1920, min: 1280 },
                  height: { ideal: 1080, min: 720 },
                }}
                className="w-full h-full object-cover block"
                onUserMedia={syncSize}
                onLoadedMetadata={syncSize}
              />
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Cubierta de cámara cuando se completa el escaneo para detener detecciones y ahorrar peticiones */}
              {isCovered && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md z-20 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                  <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center text-3xl mb-3 shadow-lg">
                    {cards.length > 0 ? (cards[0]?.visualScore != null && cards[0].visualScore >= 50 ? '✅' : '🃏') : '⚠️'}
                  </div>
                  <h3 className="text-white font-bold text-lg mb-1">
                    {cards.length > 0
                      ? cards[0]?.visualScore != null && cards[0].visualScore >= 50
                        ? '¡Carta Identificada!'
                        : 'Resultados Encontrados'
                      : scanState === 'error'
                      ? 'No se identificó la carta'
                      : 'Escaneo Pausado'}
                  </h3>
                  <p className="text-slate-300 text-xs max-w-xs mb-5">
                    {cards.length > 0
                      ? cards[0]?.visualScore != null && cards[0].visualScore >= 50
                        ? 'Coincidencia visual ≥ 50%. Cámara pausada para ahorrar peticiones.'
                        : 'Certeza visual < 50%. Revisa abajo las 5 opciones más cercanas.'
                      : 'Asegúrate de que la carta esté bien iluminada y centrada entre las 4 esquinas.'}
                  </p>
                  <button
                    onClick={handleScanAgain}
                    className="py-3 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/30 flex items-center gap-2 transition-all transform active:scale-95"
                  >
                    <span>🔄</span>
                    <span>Escanear otra carta</span>
                  </button>
                </div>
              )}

              {/* Botón flotante para reintentar rápido cuando la cámara está activa */}
              {!isCovered && (scanState === 'error' || scanState === 'done') && (
                <button
                  onClick={handleScanAgain}
                  title="Escanear de nuevo"
                  className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white text-lg transition-colors shadow-lg z-10"
                >
                  ↺
                </button>
              )}
            </div>

            {/* Acciones principales */}
            <div className="flex gap-2 mb-3">
              {isCovered ? (
                <button
                  onClick={handleScanAgain}
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all"
                >
                  <span>🔄</span>
                  <span>Escanear otra carta</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => doScan()}
                    disabled={scanState === 'scanning' || scanState === 'matching'}
                    className="flex-1 py-3 px-4 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-950 font-bold rounded-xl shadow-lg shadow-yellow-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    <span>📸</span>
                    <span>Escanear carta ahora</span>
                  </button>
                  <button
                    onClick={handleScanAgain}
                    title="Reiniciar encuadre"
                    className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl transition-colors border border-slate-700"
                  >
                    ↺
                  </button>
                </>
              )}
            </div>

            {/* Estado del escáner */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 mb-3 text-center">
              <p className={`text-xs md:text-sm font-medium ${statusColor[scanState]}`}>
                {statusLabel[scanState]}
              </p>
            </div>

            {/* 1. SECCIÓN: IDENTIFICADO (con botón "Ver en álbum") */}
            {detectedText && (
              <div className="bg-slate-800/95 border border-slate-700 rounded-xl p-3.5 mb-3 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-slate-400 text-xs font-medium">Identificado:</p>
                  <p className="text-white font-mono font-bold text-base">{detectedText}</p>
                </div>
                <Link
                  to={`/?q=${encodeURIComponent(detectedQuery)}`}
                  className="text-xs bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow"
                >
                  <span>📖</span>
                  <span>Ver en álbum</span>
                </Link>
              </div>
            )}

            {/* 2. SECCIÓN: 5 RESULTADOS MÁS CERCANOS */}
            {top5Cards.length > 0 && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 mb-3 shadow">
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>🎯</span>
                    <span>
                      {cards[0]?.visualScore != null && cards[0].visualScore >= 50
                        ? `Mejores coincidencias (${top5Cards.length}):`
                        : `5 resultados más cercanos (< 50% de certeza):`}
                    </span>
                  </p>
                  <span className="text-[11px] text-slate-400">Toca para abrir detalle</span>
                </div>
                {cards[0]?.visualScore != null && cards[0].visualScore < 50 && (
                  <div className="bg-yellow-950/40 border border-yellow-800/50 rounded-lg p-2.5 mb-3 text-xs text-yellow-300">
                    ⚠️ Ninguna opción superó el 50% de certeza visual. Aquí están las 5 más cercanas encontradas:
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {top5Cards.map((card, idx) => {
                    const locale = card.locales.en ?? card.locales.jp
                    const isTop = idx === 0 && card.visualScore != null && card.visualScore >= 50
                    return (
                      <button
                        key={card.card_code}
                        onClick={() => setSelectedCard(card.card_code)}
                        className={`relative rounded-xl p-2 text-left transition-all ${
                          isTop
                            ? 'bg-slate-800 ring-2 ring-purple-500 shadow-lg shadow-purple-900/30 hover:bg-slate-700'
                            : 'bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60'
                        }`}
                      >
                        {card.visualScore != null && card.visualScore > 0 && (
                          <span
                            className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow z-10 ${
                              card.visualScore >= 50
                                ? 'bg-green-600 text-white'
                                : card.visualScore >= 25
                                ? 'bg-yellow-600 text-white'
                                : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            🎯 {card.visualScore}%
                          </span>
                        )}
                        {locale?.img_url ? (
                          <img
                            src={proxyImg(locale.img_url)!}
                            alt={locale.name}
                            className="w-full h-36 object-contain rounded-lg mb-1.5 bg-black/40"
                          />
                        ) : (
                          <div className="w-full h-36 bg-slate-800 rounded-lg mb-1.5 flex items-center justify-center text-xl">
                            🃏
                          </div>
                        )}
                        <p className="text-xs font-mono font-bold text-yellow-400 truncate">{card.card_code}</p>
                        <p className="text-xs text-white truncate font-medium">{locale?.name || card.card_code}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 3. SECCIÓN: OTROS TEXTOS LEÍDOS */}
            {candidates.length > 1 && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 mb-3">
                <p className="text-slate-400 text-xs mb-2">Otros textos leídos (toca para reintentar con este):</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.slice(1).map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (capturedArtRef.current) {
                          searchAndMatchVisual(c, capturedArtRef.current)
                        }
                      }}
                      className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
                    >
                      {c.isCode ? (
                        <span className="text-[10px] bg-blue-600 text-white px-1 py-0.2 rounded font-mono">CÓD</span>
                      ) : (
                        <span className="text-[10px] bg-slate-700 text-slate-300 px-1 py-0.2 rounded">NOM</span>
                      )}
                      <span className="font-mono text-white font-medium">{c.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scanState === 'error' && (
              <div className="text-center py-2 bg-red-950/40 border border-red-900/50 rounded-xl mb-3 p-3">
                <p className="text-red-400 text-xs font-medium">
                  No se detectó el código con claridad. Ajusta el tamaño del marco para encuadrar la carta y pulsa "Escanear carta ahora".
                </p>
              </div>
            )}

            {/* 4. SECCIÓN: DIAGNÓSTICO DEBUG DEL ESCÁNER */}
            <details className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-lg mb-4">
              <summary className="p-3.5 text-xs font-bold text-slate-300 cursor-pointer flex items-center justify-between hover:bg-slate-800/50 transition-colors">
                <span className="flex items-center gap-2">
                  <span>🔬</span>
                  <span>Diagnóstico Visual (Debug OpenCV & OCR)</span>
                </span>
                <span className="text-[11px] text-blue-400 font-mono">
                  {debugMatches.length > 0 ? `${debugMatches.length} evaluadas` : 'Ver capturas'}
                </span>
              </summary>
              <div className="p-4 pt-2 border-t border-slate-800 space-y-4">
                {/* Miniaturas de captura */}
                <div className="grid grid-cols-2 gap-3">
                  {capturedArtData && (
                    <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 text-center">
                      <p className="text-[11px] text-purple-400 font-mono mb-1 font-semibold">Foto recortada (OpenCV)</p>
                      <img src={capturedArtData} alt="Recorte OpenCV" className="w-full h-36 object-contain rounded-lg bg-black" />
                    </div>
                  )}
                  {capturedTextData && (
                    <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 text-center">
                      <p className="text-[11px] text-yellow-400 font-mono mb-1 font-semibold">Franja OCR (Contraste)</p>
                      <img src={capturedTextData} alt="Recorte OCR" className="w-full h-36 object-contain rounded-lg bg-black" />
                    </div>
                  )}
                </div>

                {/* Texto detectado */}
                {detectedText && (
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs">
                    <span className="text-slate-400">Texto interpretado: </span>
                    <span className="text-white font-mono font-bold">{detectedText}</span>
                  </div>
                )}

                {/* Candidatas evaluadas con su umbral OpenCV */}
                {debugMatches.length > 0 ? (
                  <div>
                    <p className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                      <span>Cartas evaluadas vs Foto:</span>
                      <span className="text-[10px] text-slate-500 font-normal">Umbral de certeza directa: ≥ 50%</span>
                    </p>
                    <div className="space-y-2">
                      {debugMatches.map((dm) => (
                        <div
                          key={dm.card_code}
                          className={`flex items-center gap-3 p-2 rounded-xl border ${
                            dm.passedThreshold
                              ? 'bg-purple-950/40 border-purple-600/60 ring-1 ring-purple-500/40'
                              : 'bg-slate-950 border-slate-800'
                          }`}
                        >
                          {dm.img_url ? (
                            <img src={dm.img_url} alt={dm.name} className="w-12 h-16 object-contain rounded-lg bg-black shrink-0" />
                          ) : (
                            <div className="w-12 h-16 bg-slate-800 rounded-lg shrink-0 flex items-center justify-center text-xs">🃏</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className="text-xs font-mono font-bold text-white truncate">{dm.card_code}</span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-mono font-bold ${
                                  dm.visualScore >= 50
                                    ? 'bg-green-600 text-white'
                                    : dm.visualScore >= 25
                                    ? 'bg-yellow-600 text-white'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                🎯 {dm.visualScore}%
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 truncate mb-1">{dm.name}</p>
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span>Puntos ORB: {dm.visualMatches} matches</span>
                              {dm.passedThreshold ? (
                                <span className="text-green-400 font-medium">✅ Supera umbral</span>
                              ) : (
                                <span className="text-slate-500">⚪ Descartado</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center py-2">
                    Aún no se han evaluado candidatos. Escanea una carta para ver el análisis de OpenCV en tiempo real.
                  </p>
                )}

                {debugError && (
                  <div className="p-2 bg-red-950/50 border border-red-800 rounded-xl text-xs text-red-300">
                    {debugError}
                  </div>
                )}
              </div>
            </details>
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
