/**
 * cardVision.ts
 * Utility for loading OpenCV.js and running ORB feature matching
 * to compare a captured card photo against candidate card illustrations.
 */

let cvPromise: Promise<any> | null = null

/**
 * Loads OpenCV.js dynamically via WebAssembly from a reliable CDN.
 */
export function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window no disponible'))
  }

  // Ya cargado y listo
  const currentCv = (window as any).cv
  if (currentCv && typeof currentCv.Mat === 'function') {
    try {
      delete currentCv.then
    } catch {}
    return Promise.resolve(currentCv)
  }

  if (cvPromise) return cvPromise

  cvPromise = new Promise((resolve, reject) => {
    let pollInterval: any = null
    let timeoutId: any = null

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const checkReady = () => {
      const cv = (window as any).cv
      if (cv && typeof cv.Mat === 'function') {
        cleanup()
        // IMPORTANTE: Emscripten define .then en el módulo, lo que hace que JavaScript
        // intente encadenar recursivamente la promesa indefinidamente (chaining cycle).
        // Al borrar .then antes de resolver, se evita el ciclo infinito y el bloqueo del navegador.
        try {
          delete cv.then
        } catch {}
        resolve(cv)
        return true
      }
      return false
    }

    if (checkReady()) return

    const existing = document.querySelector('script[data-opencv]')
    if (!existing) {
      const script = document.createElement('script')
      script.setAttribute('data-opencv', 'true')
      script.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'
      script.async = true

      script.onload = () => {
        if (checkReady()) return
        const cv = (window as any).cv
        if (cv) {
          const prev = cv.onRuntimeInitialized
          cv.onRuntimeInitialized = () => {
            if (prev) prev()
            checkReady()
          }
        }
      }

      script.onerror = () => {
        cleanup()
        cvPromise = null
        reject(new Error('No se pudo descargar OpenCV.js'))
      }

      document.head.appendChild(script)
    } else {
      const cv = (window as any).cv
      if (cv) {
        const prev = cv.onRuntimeInitialized
        cv.onRuntimeInitialized = () => {
          if (prev) prev()
          checkReady()
        }
      }
    }

    pollInterval = setInterval(checkReady, 80)

    timeoutId = setTimeout(() => {
      cleanup()
      if (!checkReady()) {
        cvPromise = null
        reject(new Error('Tiempo de espera agotado cargando OpenCV.js'))
      }
    }, 12000)
  })

  return cvPromise
}

/**
 * Preloads an image from a URL into an HTMLImageElement with crossOrigin set.
 */
export function preloadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Error al cargar imagen ${url}`))
    img.src = url
  })
}

/**
 * Runs ORB (Oriented FAST and Rotated BRIEF) feature matching
 * between a captured canvas (query) and a reference image (ref).
 * Returns matching score and number of good feature matches.
 */
export function compareWithORB(
  cv: any,
  queryCanvas: HTMLCanvasElement,
  refImage: HTMLImageElement
): { score: number; matches: number } {
  let matQuery: any = null
  let matRef: any = null
  let grayQuery: any = null
  let grayRef: any = null
  let normQuery: any = null
  let normRef: any = null
  let orb: any = null
  let kpQuery: any = null
  let kpRef: any = null
  let descQuery: any = null
  let descRef: any = null
  let matcher: any = null
  let matches: any = null
  let mask: any = null

  try {
    matQuery = cv.imread(queryCanvas)
    matRef = cv.imread(refImage)

    grayQuery = new cv.Mat()
    grayRef = new cv.Mat()
    cv.cvtColor(matQuery, grayQuery, cv.COLOR_RGBA2GRAY)
    cv.cvtColor(matRef, grayRef, cv.COLOR_RGBA2GRAY)

    // Normalizar a una resolución estándar de comparación (300 x 419, ratio exacto 63:88)
    const stdSize = new cv.Size(300, 419)
    normQuery = new cv.Mat()
    normRef = new cv.Mat()
    cv.resize(grayQuery, normQuery, stdSize, 0, 0, cv.INTER_AREA)
    cv.resize(grayRef, normRef, stdSize, 0, 0, cv.INTER_AREA)

    // ORB con 500 características clave
    orb = new cv.ORB(500)
    kpQuery = new cv.KeyPointVector()
    kpRef = new cv.KeyPointVector()
    descQuery = new cv.Mat()
    descRef = new cv.Mat()

    mask = new cv.Mat()
    orb.detectAndCompute(normQuery, mask, kpQuery, descQuery)
    orb.detectAndCompute(normRef, mask, kpRef, descRef)

    if (descQuery.empty() || descRef.empty() || kpQuery.size() === 0 || kpRef.size() === 0) {
      return { score: 0, matches: 0 }
    }

    // Brute force matcher con distancia de Hamming para descriptores binarios
    matcher = new cv.BFMatcher(cv.NORM_HAMMING, true)
    matches = new cv.DMatchVector()
    matcher.match(descQuery, descRef, matches)

    let goodMatches = 0
    const count = matches.size()
    for (let i = 0; i < count; i++) {
      const match = matches.get(i)
      // Umbral de distancia Hamming estricto para descartar ruido
      if (match.distance <= 48) {
        goodMatches++
      }
    }

    const minKp = Math.min(kpQuery.size(), kpRef.size())
    // Puntuación sobre 100 basada en matches consistentes
    const score = minKp > 0 ? Math.min(100, Math.round((goodMatches / Math.min(minKp, 100)) * 100)) : 0

    return { score, matches: goodMatches }
  } catch (err) {
    console.warn('[OpenCV] Error comparando imagen:', err)
    return { score: 0, matches: 0 }
  } finally {
    // Liberar memoria WebAssembly rigurosamente
    try {
      if (mask) mask.delete()
      if (matQuery) matQuery.delete()
      if (matRef) matRef.delete()
      if (grayQuery) grayQuery.delete()
      if (grayRef) grayRef.delete()
      if (normQuery) normQuery.delete()
      if (normRef) normRef.delete()
      if (orb) orb.delete()
      if (kpQuery) kpQuery.delete()
      if (kpRef) kpRef.delete()
      if (descQuery) descQuery.delete()
      if (descRef) descRef.delete()
      if (matcher) matcher.delete()
      if (matches) matches.delete()
    } catch {}
  }
}
