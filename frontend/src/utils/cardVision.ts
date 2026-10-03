/**
 * cardVision.ts
 * Utility for loading OpenCV.js and running ORB feature matching
 * to compare a captured card photo against candidate card illustrations.
 */

let cvPromise: Promise<any> | null = null

/**
 * Loads OpenCV.js dynamically via WebAssembly from a reliable CDN with fallback.
 */
export function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window no disponible'))
  }

  // Ya cargado y listo
  if ((window as any).cv && typeof (window as any).cv.Mat === 'function') {
    return Promise.resolve((window as any).cv)
  }

  if (cvPromise) return cvPromise

  cvPromise = new Promise((resolve, reject) => {
    const CDNS = [
      'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
      'https://docs.opencv.org/4.x/opencv.js',
    ]
    let currentCdnIndex = 0

    const tryLoadScript = () => {
      // Remover cualquier script opencv previo si falló
      const prev = document.querySelector('script[data-opencv]')
      if (prev) prev.remove()

      const src = CDNS[currentCdnIndex]
      const script = document.createElement('script')
      script.setAttribute('data-opencv', 'true')
      script.src = src
      script.async = true

      let pollInterval: any = null
      let timeoutId: any = null

      const checkReady = () => {
        const cv = (window as any).cv
        if (cv && typeof cv.Mat === 'function') {
          if (pollInterval) clearInterval(pollInterval)
          if (timeoutId) clearTimeout(timeoutId)
          resolve(cv)
          return true
        }
        return false
      }

      const onFail = () => {
        if (pollInterval) clearInterval(pollInterval)
        if (timeoutId) clearTimeout(timeoutId)
        currentCdnIndex++
        if (currentCdnIndex < CDNS.length) {
          console.warn(`[OpenCV] Reintentando carga desde CDN alternativo: ${CDNS[currentCdnIndex]}`)
          tryLoadScript()
        } else {
          cvPromise = null // Permitir reintento en el siguiente escaneo
          reject(new Error('No se pudo cargar OpenCV.js'))
        }
      }

      script.onload = () => {
        if (checkReady()) return

        const cv = (window as any).cv
        if (cv) {
          if (typeof cv.then === 'function') {
            cv.then((readyCv: any) => {
              (window as any).cv = readyCv
              if (pollInterval) clearInterval(pollInterval)
              if (timeoutId) clearTimeout(timeoutId)
              resolve(readyCv)
            }).catch(onFail)
            return
          }

          cv.onRuntimeInitialized = () => {
            if (pollInterval) clearInterval(pollInterval)
            if (timeoutId) clearTimeout(timeoutId)
            resolve(cv)
          }
        }

        pollInterval = setInterval(() => {
          if (checkReady()) {
            clearInterval(pollInterval)
          }
        }, 80)

        timeoutId = setTimeout(() => {
          if (!checkReady()) {
            onFail()
          }
        }, 12000)
      }

      script.onerror = () => {
        onFail()
      }

      document.head.appendChild(script)
    }

    tryLoadScript()
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
