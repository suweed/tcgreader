import type { VercelRequest, VercelResponse } from '@vercel/node'
import { query, getDbMode } from './_db.ts'

const PRICE_CACHE_TTL = 21600 // 6 horas en segundos
const GOOGLE_VISION_KEY = process.env.GOOGLE_VISION_KEY || 'AIzaSyANv1ZjjyVlQ2cYqmhi6y5W5N1v95b1Tks'
const OPTCG_API_URL = process.env.OPTCG_API_URL || 'https://optcgapi.com/api'

function normalizeCardCode(code: string): string {
  const parts = code.split('_')
  parts[0] = parts[0].toUpperCase()
  return parts.join('_')
}

function safeParseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed
      if (parsed) return [String(parsed)]
    } catch {
      return val ? [val] : []
    }
  }
  return []
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  try {
    const endpointParam = typeof req.query?.__endpoint === 'string'
      ? req.query.__endpoint
      : Array.isArray(req.query?.__endpoint)
        ? req.query.__endpoint[0]
        : ''

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    let pathname = endpointParam || url.pathname
    pathname = pathname.replace(/^\/tcg_read\/api/, '').replace(/^\/api/, '')
    pathname = pathname.replace(/\/+$/, '') || '/'

    // Limpiar __endpoint de req.query para no afectar otros filtros
    if (req.query && '__endpoint' in req.query) {
      delete (req.query as any).__endpoint
    }

    const segments = pathname.split('/').filter(Boolean)
    const resource = segments[0] || ''

    switch (resource) {
      case 'sets':
        return await handleSets(req, res)
      case 'cards':
        return await handleCards(req, res, segments)
      case 'collection':
        return await handleCollection(req, res, segments)
      case 'price':
        return await handlePrice(req, res, segments)
      case 'img':
        return await handleImg(req, res, url)
      case 'ocr':
        return await handleOcr(req, res)
      case 'visual-cache':
        return await handleVisualCache(req, res)
      case 'health':
      case '':
        return res.status(200).json({
          status: 'ok',
          service: 'TCG Reader API',
          db_mode: getDbMode(),
          has_db_url: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        })
      default:
        return res.status(404).json({ error: `Endpoint no encontrado: ${resource || '/'}` })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('API Error:', message)
    return res.status(500).json({ error: 'Error del servidor: ' + message })
  }
}

// ----------------------------------------------------------------------------
// 1. SETS
// ----------------------------------------------------------------------------
async function handleSets(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const lang = String(req.query.lang || '').toLowerCase().trim()
  let langJoin = ''

  if (lang === 'en') {
    langJoin = "JOIN card_locales cl ON cl.card_code = c.card_code AND cl.language = 'en'"
  } else if (lang === 'jp') {
    langJoin = "JOIN card_locales cl ON cl.card_code = c.card_code AND cl.language = 'jp'"
  }

  const sql = `
    SELECT s.id, s.code, s.raw_title, s.total_cards,
           COUNT(DISTINCT c.card_code)::int AS imported_cards
    FROM sets s
    LEFT JOIN cards c ON c.set_id = s.id
    ${langJoin}
    GROUP BY s.id
    HAVING COUNT(DISTINCT c.card_code) > 0
    ORDER BY s.code ASC
  `
  const result = await query(sql)
  return res.status(200).json(result.rows)
}

// ----------------------------------------------------------------------------
// 2. CARDS
// ----------------------------------------------------------------------------
async function handleCards(req: VercelRequest, res: VercelResponse, segments: string[]) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  if (segments[1]) {
    // Detalle de una carta
    const cardCode = normalizeCardCode(segments[1])
    const cardRes = await query(
      `
      SELECT c.card_code, c.category, c.colors, c.cost, c.power,
             c.counter, c.rarity, c.attributes, c.types,
             s.code AS set_code, s.raw_title AS set_name
      FROM cards c
      JOIN sets s ON s.id = c.set_id
      WHERE c.card_code = $1
    `,
      [cardCode]
    )

    if (cardRes.rows.length === 0) {
      return res.status(404).json({ error: 'Carta no encontrada' })
    }

    const card = cardRes.rows[0]

    // Locales
    const locRes = await query(
      'SELECT language, name, effect, trigger, img_url FROM card_locales WHERE card_code = $1',
      [cardCode]
    )
    const locales: Record<string, unknown> = { en: null, jp: null }
    for (const l of locRes.rows) {
      locales[l.language] = {
        name: l.name,
        effect: l.effect,
        trigger: l.trigger,
        img_url: l.img_url,
      }
    }

    // Owned
    const colRes = await query(
      'SELECT language, quantity, condition, price_usd FROM collection WHERE card_code = $1',
      [cardCode]
    )
    const owned: Record<string, unknown> = { en: null, jp: null }
    for (const c of colRes.rows) {
      owned[c.language] = {
        quantity: c.quantity,
        condition: c.condition,
        price_usd: c.price_usd != null ? Number(c.price_usd) : null,
      }
    }

    return res.status(200).json({
      card_code: card.card_code,
      set_code: card.set_code,
      set_name: card.set_name,
      category: card.category,
      rarity: card.rarity,
      cost: card.cost,
      power: card.power,
      counter: card.counter,
      colors: safeParseArray(card.colors),
      attributes: safeParseArray(card.attributes),
      types: safeParseArray(card.types),
      locales,
      owned,
    })
  }

  // Lista con filtros
  const q = String(req.query.q || '').trim()
  const set = String(req.query.set || '').toUpperCase().trim()
  const color = String(req.query.color || '').trim()
  const category = String(req.query.category || '').trim()
  const rarity = String(req.query.rarity || '').trim()
  const type = String(req.query.type || '').trim()
  const lang = String(req.query.lang || '').toLowerCase().trim()
  const ownedLang = String(req.query.owned_lang || '').toLowerCase().trim()
  const owned = req.query.owned !== undefined ? String(req.query.owned) : null
  const costMin = req.query.cost_min !== undefined ? Number(req.query.cost_min) : null
  const costMax = req.query.cost_max !== undefined ? Number(req.query.cost_max) : null
  const priceMin = req.query.price_min !== undefined ? Number(req.query.price_min) : null
  const priceMax = req.query.price_max !== undefined ? Number(req.query.price_max) : null
  const dateFrom = String(req.query.date_from || '').trim()
  const dateTo = String(req.query.date_to || '').trim()
  const sort = String(req.query.sort || '').trim()
  const page = Math.max(1, Number(req.query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)))
  const offset = (page - 1) * limit

  const where: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (q) {
    // Reemplaza espacios, comillas, ampersands y el punto medio japonés (・) por '%'
    const fuzzyQ = '%' + q.replace(/[\s"&・]+/g, '%') + '%'
    where.push(`(c.card_code ILIKE $${paramIdx} OR en_loc.name ILIKE $${paramIdx} OR jp_loc.name ILIKE $${paramIdx})`)
    params.push(fuzzyQ)
    paramIdx++
  }
  if (set) {
    where.push(`s.code = $${paramIdx}`)
    params.push(set)
    paramIdx++
  }
  if (color) {
    where.push(`c.colors::text ILIKE $${paramIdx}`)
    params.push(`%${color}%`)
    paramIdx++
  }
  if (category) {
    where.push(`c.category = $${paramIdx}`)
    params.push(category)
    paramIdx++
  }
  if (rarity) {
    where.push(`c.rarity = $${paramIdx}`)
    params.push(rarity)
    paramIdx++
  }
  if (type) {
    where.push(`c.types::text ILIKE $${paramIdx}`)
    params.push(`%${type}%`)
    paramIdx++
  }
  if (costMin !== null && !isNaN(costMin)) {
    where.push(`c.cost >= $${paramIdx}`)
    params.push(costMin)
    paramIdx++
  }
  if (costMax !== null && !isNaN(costMax)) {
    where.push(`c.cost <= $${paramIdx}`)
    params.push(costMax)
    paramIdx++
  }
  if (owned === 'true') {
    where.push('(col_en.card_code IS NOT NULL OR col_jp.card_code IS NOT NULL)')
  } else if (owned === 'false') {
    where.push('(col_en.card_code IS NULL AND col_jp.card_code IS NULL)')
  }
  if (lang === 'en') {
    where.push('en_loc.card_code IS NOT NULL')
  } else if (lang === 'jp') {
    where.push('jp_loc.card_code IS NOT NULL')
  }
  if (ownedLang === 'en') {
    where.push('col_en.card_code IS NOT NULL')
  } else if (ownedLang === 'jp') {
    where.push('col_jp.card_code IS NOT NULL')
  }
  if (priceMin !== null && !isNaN(priceMin)) {
    where.push(`COALESCE(col_en.price_usd, col_jp.price_usd) >= $${paramIdx}`)
    params.push(priceMin)
    paramIdx++
  }
  if (priceMax !== null && !isNaN(priceMax)) {
    where.push(`COALESCE(col_en.price_usd, col_jp.price_usd) <= $${paramIdx}`)
    params.push(priceMax)
    paramIdx++
  }
  if (dateFrom) {
    where.push(`EXISTS (SELECT 1 FROM collection col_d WHERE col_d.card_code = c.card_code AND TO_TIMESTAMP(col_d.added_at)::date >= $${paramIdx}::date)`)
    params.push(dateFrom)
    paramIdx++
  }
  if (dateTo) {
    where.push(`EXISTS (SELECT 1 FROM collection col_d WHERE col_d.card_code = c.card_code AND TO_TIMESTAMP(col_d.added_at)::date <= $${paramIdx}::date)`)
    params.push(dateTo)
    paramIdx++
  }

  const whereSQL = where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''

  let orderSQL = 's.code ASC, c.card_code ASC'
  if (sort === 'newest' || (!sort && (owned === 'true' || Boolean(ownedLang)))) {
    orderSQL = 'COALESCE(GREATEST(col_en.added_at, col_jp.added_at), col_en.added_at, col_jp.added_at, 0) DESC, s.code ASC, c.card_code ASC'
  } else if (sort === 'oldest') {
    orderSQL = 'COALESCE(LEAST(col_en.added_at, col_jp.added_at), col_en.added_at, col_jp.added_at, 9999999999) ASC, s.code ASC, c.card_code ASC'
  } else if (sort === 'name_asc') {
    orderSQL = 'COALESCE(en_loc.name, jp_loc.name) ASC, c.card_code ASC'
  } else if (sort === 'name_desc') {
    orderSQL = 'COALESCE(en_loc.name, jp_loc.name) DESC, c.card_code ASC'
  } else if (sort === 'set_desc') {
    orderSQL = 's.code DESC, c.card_code DESC'
  }

  // Count total
  const countSQL = `
    SELECT COUNT(DISTINCT c.card_code)::int AS total
    FROM cards c
    JOIN sets s ON s.id = c.set_id
    LEFT JOIN card_locales en_loc ON en_loc.card_code = c.card_code AND en_loc.language = 'en'
    LEFT JOIN card_locales jp_loc ON jp_loc.card_code = c.card_code AND jp_loc.language = 'jp'
    LEFT JOIN collection col_en ON col_en.card_code = c.card_code AND col_en.language = 'en'
    LEFT JOIN collection col_jp ON col_jp.card_code = c.card_code AND col_jp.language = 'jp'
    ${whereSQL}
  `
  const countRes = await query(countSQL, params)
  const total = countRes.rows[0]?.total || 0

  // Fetch data
  const dataSQL = `
    SELECT c.card_code, c.category, c.colors, c.cost, c.power,
           c.counter, c.rarity, c.attributes, c.types,
           s.code AS set_code, s.raw_title AS set_name,
           en_loc.name AS name_en, en_loc.img_url AS img_en,
           jp_loc.name AS name_jp, jp_loc.img_url AS img_jp,
           col_en.quantity AS owned_en_qty, col_en.condition AS owned_en_cond, col_en.price_usd AS owned_en_price,
           col_jp.quantity AS owned_jp_qty, col_jp.condition AS owned_jp_cond, col_jp.price_usd AS owned_jp_price
    FROM cards c
    JOIN sets s ON s.id = c.set_id
    LEFT JOIN card_locales en_loc ON en_loc.card_code = c.card_code AND en_loc.language = 'en'
    LEFT JOIN card_locales jp_loc ON jp_loc.card_code = c.card_code AND jp_loc.language = 'jp'
    LEFT JOIN collection col_en ON col_en.card_code = c.card_code AND col_en.language = 'en'
    LEFT JOIN collection col_jp ON col_jp.card_code = c.card_code AND col_jp.language = 'jp'
    ${whereSQL}
    ORDER BY ${orderSQL}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `
  const dataRes = await query(dataSQL, [...params, limit, offset])

  const cards = dataRes.rows.map((r: any) => ({
    card_code: r.card_code,
    set_code: r.set_code,
    set_name: r.set_name,
    category: r.category,
    rarity: r.rarity,
    cost: r.cost,
    power: r.power,
    counter: r.counter,
    colors: safeParseArray(r.colors),
    attributes: safeParseArray(r.attributes),
    types: safeParseArray(r.types),
    locales: {
      en: r.name_en ? { name: r.name_en, img_url: r.img_en } : null,
      jp: r.name_jp ? { name: r.name_jp, img_url: r.img_jp } : null,
    },
    owned: {
      en: r.owned_en_qty != null ? { quantity: r.owned_en_qty, condition: r.owned_en_cond, price_usd: r.owned_en_price ? Number(r.owned_en_price) : null } : null,
      jp: r.owned_jp_qty != null ? { quantity: r.owned_jp_qty, condition: r.owned_jp_cond, price_usd: r.owned_jp_price ? Number(r.owned_jp_price) : null } : null,
    },
  }))

  return res.status(200).json({
    data: cards,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  })
}

// ----------------------------------------------------------------------------
// 3. COLLECTION
// ----------------------------------------------------------------------------
async function handleCollection(req: VercelRequest, res: VercelResponse, segments: string[]) {
  const sub = segments[1] || ''

  if (sub === 'stats') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
    const statsRes = await query(`
      SELECT
        (SELECT COUNT(DISTINCT card_code)::int FROM collection) AS total_owned,
        (SELECT COUNT(*)::int FROM cards) AS total_cards,
        (SELECT COUNT(*)::int FROM sets) AS total_sets,
        (SELECT COUNT(*)::int FROM collection WHERE language = 'en') AS cards_with_en,
        (SELECT COUNT(*)::int FROM collection WHERE language = 'jp') AS cards_with_jp,
        (SELECT ROUND(SUM(price_usd * quantity), 2)::float FROM collection WHERE price_usd IS NOT NULL) AS total_value_usd,
        (SELECT COUNT(*)::int FROM collection WHERE price_usd IS NOT NULL) AS priced_cards,
        (SELECT COUNT(DISTINCT card_code)::int FROM card_locales WHERE language = 'en') AS total_en,
        (SELECT COUNT(DISTINCT card_code)::int FROM card_locales WHERE language = 'jp') AS total_jp
    `)
    return res.status(200).json(statsRes.rows[0])
  }

  if (sub === 'refresh-prices') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    const codesRes = await query('SELECT DISTINCT card_code FROM collection')
    let updated = 0
    let skipped = 0
    let errors = 0

    for (const row of codesRes.rows) {
      try {
        const price = await fetchAndCachePrice(row.card_code)
        if (price !== null) {
          await query('UPDATE collection SET price_usd = $1 WHERE card_code = $2', [price, row.card_code])
          updated++
        } else {
          skipped++
        }
      } catch {
        errors++
      }
    }

    const totalRes = await query('SELECT ROUND(SUM(price_usd * quantity), 2)::float AS total_usd FROM collection WHERE price_usd IS NOT NULL')
    return res.status(200).json({
      updated,
      skipped,
      errors,
      total_usd: totalRes.rows[0]?.total_usd || null,
    })
  }

  // PUT / DELETE /collection/:code/:lang
  if (segments[1] && segments[2]) {
    const cardCode = normalizeCardCode(segments[1])
    const language = segments[2].toLowerCase()

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
      const quantity = Math.max(1, Number(body.quantity || 1))
      const condition = body.condition || 'near_mint'
      const upd = await query(
        'UPDATE collection SET quantity = $1, condition = $2 WHERE card_code = $3 AND language = $4 RETURNING *',
        [quantity, condition, cardCode, language]
      )
      if (upd.rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada' })
      return res.status(200).json(upd.rows[0])
    }

    if (req.method === 'DELETE') {
      const del = await query('DELETE FROM collection WHERE card_code = $1 AND language = $2', [cardCode, language])
      if ((del.rowCount || 0) === 0) return res.status(404).json({ error: 'Entrada no encontrada' })
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).json({ error: 'Método no permitido' })
  }

  // GET /collection
  if (req.method === 'GET') {
    const colRes = await query(`
      SELECT col.card_code, col.language, col.quantity, col.condition, col.added_at,
             col.price_usd::float,
             c.rarity, c.category, c.colors, c.cost, c.power,
             s.code AS set_code, s.raw_title AS set_name,
             loc.name, loc.img_url
      FROM collection col
      JOIN cards c ON c.card_code = col.card_code
      JOIN sets s ON s.id = c.set_id
      LEFT JOIN card_locales loc ON loc.card_code = col.card_code AND loc.language = col.language
      ORDER BY col.added_at DESC, s.code ASC, col.card_code ASC
    `)
    const rows = colRes.rows.map((r: any) => ({
      ...r,
      colors: safeParseArray(r.colors),
    }))
    return res.status(200).json(rows)
  }

  // POST /collection (Agregar carta)
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const cardCode = normalizeCardCode(String(body.card_code || '').trim())
    const language = String(body.language || '').toLowerCase().trim()
    const quantity = Math.max(1, Number(body.quantity || 1))
    const condition = body.condition || 'near_mint'

    if (!cardCode || !['en', 'jp'].includes(language)) {
      return res.status(400).json({ error: 'Parámetros inválidos' })
    }

    await query(`
      INSERT INTO collection (card_code, language, quantity, condition, added_at)
      VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT)
      ON CONFLICT(card_code, language) DO UPDATE
      SET quantity = collection.quantity + EXCLUDED.quantity,
          condition = EXCLUDED.condition,
          added_at = EXTRACT(EPOCH FROM NOW())::BIGINT
    `, [cardCode, language, quantity, condition])

    // Auto-adjuntar precio cacheado si está disponible
    const prRes = await query('SELECT price_data, price_cached_at FROM cards WHERE card_code = $1', [cardCode])
    const pr = prRes.rows[0]
    const now = Math.floor(Date.now() / 1000)
    if (pr?.price_data && pr.price_cached_at && (now - Number(pr.price_cached_at)) < PRICE_CACHE_TTL) {
      const p = extractMarketPrice(pr.price_data)
      if (p !== null) {
        await query('UPDATE collection SET price_usd = $1 WHERE card_code = $2 AND language = $3', [p, cardCode, language])
      }
    }

    const item = await query(`
      SELECT col.card_code, col.language, col.quantity, col.condition, col.added_at,
             col.price_usd::float, loc.name, loc.img_url
      FROM collection col
      LEFT JOIN card_locales loc ON loc.card_code = col.card_code AND loc.language = col.language
      WHERE col.card_code = $1 AND col.language = $2
    `, [cardCode, language])

    return res.status(201).json(item.rows[0])
  }

  return res.status(405).json({ error: 'Método no permitido' })
}

// ----------------------------------------------------------------------------
// 4. PRICE (OPTCG API)
// ----------------------------------------------------------------------------
async function handlePrice(req: VercelRequest, res: VercelResponse, segments: string[]) {
  const cardCode = normalizeCardCode(segments[1] || '')
  if (!cardCode) return res.status(400).json({ error: 'Código de carta requerido' })

  const now = Math.floor(Date.now() / 1000)

  // POST /api/price/:cardCode -> set manual price
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const customUsd = Number(body.priceUsd)
    if (isNaN(customUsd) || customUsd < 0) return res.status(400).json({ error: 'Precio inválido' })

    const row = (await query('SELECT price_data FROM cards WHERE card_code = $1', [cardCode])).rows[0]
    let oldData = row?.price_data ? (typeof row.price_data === 'string' ? JSON.parse(row.price_data) : row.price_data) : {}

    const newData = {
      ...oldData,
      prices: {
        raw: {
          near_mint: { tcgplayer: { market: customUsd, low: customUsd } }
        }
      },
      _is_manual: true
    }

    await query('UPDATE cards SET price_data = $1, price_cached_at = $2 WHERE card_code = $3', [
      JSON.stringify(newData),
      0, // Forzar caché vencido para que el backend intente buscar precio real en la siguiente recarga, si lo encuentra lo pisa, si no lo conserva.
      cardCode,
    ])

    return res.status(200).json(newData)
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const cardRow = (await query('SELECT price_data, price_cached_at FROM cards WHERE card_code = $1', [cardCode])).rows[0]

  if (!cardRow) return res.status(404).json({ error: 'Carta no encontrada' })

  // Servir caché si tiene menos de 6 horas
  if (cardRow.price_data && cardRow.price_cached_at && (now - Number(cardRow.price_cached_at)) < PRICE_CACHE_TTL) {
    const data = typeof cardRow.price_data === 'string' ? JSON.parse(cardRow.price_data) : cardRow.price_data
    return res.status(200).json({
      ...data,
      _cached: true,
      _cached_at: Number(cardRow.price_cached_at),
    })
  }

  const payload = await fetchFromOptcg(cardCode)
  if (!payload) {
    if (cardRow.price_data) {
      const data = typeof cardRow.price_data === 'string' ? JSON.parse(cardRow.price_data) : cardRow.price_data
      return res.status(200).json({
        ...data,
        _cached: true,
        _cached_at: Number(cardRow.price_cached_at),
      })
    }
    return res.status(200).json({ card_code: cardCode, prices: null, _cached: false })
  }

  const newMarket = extractMarketPrice(payload)
  let dataToSave = payload

  // Si el API no devolvió precio válido, pero teníamos uno manual, conservar el manual.
  if (newMarket === null && cardRow.price_data) {
    const oldData = typeof cardRow.price_data === 'string' ? JSON.parse(cardRow.price_data) : cardRow.price_data
    if (oldData._is_manual) {
      dataToSave = oldData
    }
  }

  await query('UPDATE cards SET price_data = $1, price_cached_at = $2 WHERE card_code = $3', [
    JSON.stringify(dataToSave),
    now,
    cardCode,
  ])

  return res.status(200).json({
    ...dataToSave,
    _cached: false,
    _cached_at: now,
  })
}

async function fetchFromOptcg(cardCode: string): Promise<any | null> {
  const parts = cardCode.split('_')
  const baseCode = parts[0]
  const variant = parts[1] || null

  const encoded = encodeURIComponent(baseCode)
  const endpoints: string[] = []

  if (baseCode.startsWith('ST')) {
    endpoints.push(`${OPTCG_API_URL}/decks/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/sets/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/promos/card/${encoded}/`)
  } else if (baseCode.startsWith('P-') || baseCode.startsWith('P')) {
    endpoints.push(`${OPTCG_API_URL}/promos/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/sets/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/decks/card/${encoded}/`)
  } else {
    endpoints.push(`${OPTCG_API_URL}/sets/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/decks/card/${encoded}/`)
    endpoints.push(`${OPTCG_API_URL}/promos/card/${encoded}/`)
  }

  let items: any[] | null = null
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        headers: { Accept: 'application/json', 'User-Agent': 'TCGRead/1.0' },
      })
      if (r.ok) {
        const json = await r.json()
        if (Array.isArray(json) && json.length > 0) {
          items = json
          break
        }
      }
    } catch {}
  }

  if (!items || items.length === 0) return null

  let match: any = null
  if (variant) {
    match = items.find((it) => (it.card_image_id || '').toLowerCase() === cardCode.toLowerCase())
    if (!match) {
      match = items.find((it) => {
        const n = it.card_name || ''
        return n.includes('Parallel') || n.includes('Alternate Art')
      })
    }
  } else {
    match = items.find((it) => (it.card_image_id || '').toLowerCase() === baseCode.toLowerCase())
    if (!match) {
      match = items.find((it) => {
        const n = it.card_name || ''
        return !n.includes('Parallel') && !n.includes('Alternate Art')
      })
    }
  }

  if (!match) match = items[0]

  const marketPrice = Number(match.market_price || 0)
  const lowPrice = Number(match.inventory_price || 0)

  return {
    id: match.card_image_id || cardCode,
    name: match.card_name || '',
    number: match.card_set_id || baseCode,
    rarity: match.rarity || '',
    variant: variant ? variant.toUpperCase() : 'Normal',
    image_url: match.card_image || null,
    set: {
      name: match.set_name || '',
      slug: (match.set_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    },
    prices: {
      raw: {
        near_mint: {
          tcgplayer: {
            market: marketPrice,
            low: lowPrice,
          },
        },
      },
    },
  }
}

function extractMarketPrice(priceData: any): number | null {
  if (!priceData) return null
  const d = typeof priceData === 'string' ? JSON.parse(priceData) : priceData
  const p = d?.prices?.raw?.near_mint?.tcgplayer?.market ?? d?.prices?.near_mint?.market
  return p != null && Number(p) > 0 ? Number(p) : null
}

async function fetchAndCachePrice(cardCode: string): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000)
  const row = (await query('SELECT price_data, price_cached_at FROM cards WHERE card_code = $1', [cardCode])).rows[0]
  if (!row) return null

  if (row.price_data && row.price_cached_at && (now - Number(row.price_cached_at)) < PRICE_CACHE_TTL) {
    return extractMarketPrice(row.price_data)
  }

  const payload = await fetchFromOptcg(cardCode)
  if (!payload) return extractMarketPrice(row.price_data)

  const newMarket = extractMarketPrice(payload)
  let dataToSave = payload

  // Si el API no devolvió precio válido, pero teníamos uno manual, conservar el manual.
  if (newMarket === null && row.price_data) {
    const oldData = typeof row.price_data === 'string' ? JSON.parse(row.price_data) : row.price_data
    if (oldData._is_manual) {
      dataToSave = oldData
    }
  }

  await query('UPDATE cards SET price_data = $1, price_cached_at = $2 WHERE card_code = $3', [
    JSON.stringify(dataToSave),
    now,
    cardCode,
  ])

  return extractMarketPrice(dataToSave)
}

// ----------------------------------------------------------------------------
// 5. IMAGE PROXY
// ----------------------------------------------------------------------------
const ALLOWED_IMAGE_HOSTS = ['www.onepiece-cardgame.com', 'en.onepiece-cardgame.com', 'optcgapi.com']

async function handleImg(req: VercelRequest, res: VercelResponse, url: URL) {
  const targetUrl = url.searchParams.get('u')
  if (!targetUrl) return res.status(400).json({ error: 'Falta parámetro u' })

  let parsed: URL
  try {
    parsed = new URL(decodeURIComponent(targetUrl))
  } catch {
    return res.status(400).json({ error: 'URL inválida' })
  }

  if (!ALLOWED_IMAGE_HOSTS.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'Host no permitido' })
  }

  try {
    const imgRes = await fetch(parsed.toString(), {
      headers: {
        Referer: 'https://www.onepiece-cardgame.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; TCGTracker/1.0)',
      },
    })

    if (!imgRes.ok) return res.status(502).json({ error: 'Error al descargar imagen' })

    const contentType = imgRes.headers.get('content-type') || 'image/png'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')

    const arrayBuffer = await imgRes.arrayBuffer()
    return res.status(200).send(Buffer.from(arrayBuffer))
  } catch (err: any) {
    return res.status(502).json({ error: 'Fallo al solicitar imagen: ' + err.message })
  }
}

// ----------------------------------------------------------------------------
// 6. OCR (Google Cloud Vision)
// ----------------------------------------------------------------------------
async function handleOcr(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  let imageBase64 = body.image

  if (!imageBase64) return res.status(400).json({ error: 'Falta campo image' })

  if (imageBase64.includes(',')) {
    imageBase64 = imageBase64.split(',')[1]
  }

  const payload = {
    requests: [
      {
        image: { content: imageBase64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['en', 'ja'] },
      },
    ],
  }

  const gUrl = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(GOOGLE_VISION_KEY)}`
  const gRes = await fetch(gUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await gRes.json()
  if (!gRes.ok || data.error) {
    return res.status(502).json({ error: data.error?.message || 'Error de Vision API' })
  }

  const fullText = data.responses?.[0]?.fullTextAnnotation?.text || ''
  const annotations = data.responses?.[0]?.textAnnotations || []
  const blocks = annotations.slice(1).map((a: any) => ({
    text: a.description,
    confidence: a.confidence || null,
  }))

  return res.status(200).json({
    text: fullText,
    blocks,
  })
}

// ----------------------------------------------------------------------------
// 7. VISUAL CACHE (ORB Descriptors)
// ----------------------------------------------------------------------------
let visualTableEnsured = false
async function ensureVisualCacheTable() {
  if (visualTableEnsured) return
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS card_visual_cache (
        card_code VARCHAR(50) NOT NULL REFERENCES cards(card_code) ON DELETE CASCADE,
        language VARCHAR(10) NOT NULL DEFAULT 'en',
        orb_descriptors TEXT NOT NULL,
        rows_count INTEGER NOT NULL DEFAULT 500,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        PRIMARY KEY (card_code, language)
      );
      CREATE INDEX IF NOT EXISTS idx_visual_cache_code ON card_visual_cache(card_code);
    `)
    visualTableEnsured = true
  } catch (e) {
    console.warn('[VisualCache] Auto-create table notice:', e)
  }
}

async function handleVisualCache(req: VercelRequest, res: VercelResponse) {
  await ensureVisualCacheTable()

  if (req.method === 'GET') {
    const codesParam = String(req.query.codes || '').trim()
    const lang = String(req.query.lang || 'en').toLowerCase().trim()
    if (!codesParam) return res.status(200).json({})

    const codes = codesParam
      .split(',')
      .map((c) => normalizeCardCode(c.trim()))
      .filter(Boolean)
    if (codes.length === 0) return res.status(200).json({})

    const limitedCodes = codes.slice(0, 200)
    const placeholders = limitedCodes.map((_, i) => `$${i + 2}`).join(', ')
    const sql = `
      SELECT card_code, orb_descriptors, rows_count
      FROM card_visual_cache
      WHERE language = $1 AND card_code IN (${placeholders})
    `
    const dbRes = await query(sql, [lang, ...limitedCodes])
    const result: Record<string, { descriptors: string; rows: number }> = {}
    for (const r of dbRes.rows) {
      result[r.card_code] = {
        descriptors: r.orb_descriptors,
        rows: Number(r.rows_count) || 500,
      }
    }
    return res.status(200).json(result)
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const items: Array<{ card_code: string; language?: string; descriptors: string; rows_count?: number }> =
      Array.isArray(body.items) ? body.items : [body]

    let saved = 0
    for (const item of items) {
      if (!item.card_code || !item.descriptors) continue
      const cardCode = normalizeCardCode(item.card_code)
      const lang = String(item.language || 'en').toLowerCase().trim()
      const rows = Number(item.rows_count || 500)

      await query(
        `
        INSERT INTO card_visual_cache (card_code, language, orb_descriptors, rows_count, updated_at)
        VALUES ($1, $2, $3, $4, EXTRACT(EPOCH FROM NOW())::BIGINT)
        ON CONFLICT (card_code, language)
        DO UPDATE SET orb_descriptors = EXCLUDED.orb_descriptors,
                      rows_count = EXCLUDED.rows_count,
                      updated_at = EXCLUDED.updated_at
      `,
        [cardCode, lang, item.descriptors, rows]
      )
      saved++
    }
    return res.status(200).json({ status: 'ok', saved })
  }

  return res.status(405).json({ error: 'Método no permitido' })
}
