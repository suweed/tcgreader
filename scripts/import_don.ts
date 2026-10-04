import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

async function run() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error("No DATABASE_URL found in .env")

  const pool = new Pool({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } })
  const query = (text: string, params?: any[]) => pool.query(text, params)

  console.log("Fetching DON cards from optcgapi...")
  const res = await fetch('https://www.optcgapi.com/api/allDonCards/')
  const json = await res.json()
  
  let promoSetRes = await query("SELECT id FROM sets WHERE code = 'OP-PR' LIMIT 1")
  let promoSetId = promoSetRes.rows[0]?.id
  if (!promoSetId) {
    await query("INSERT INTO sets (code, raw_title) VALUES ('OP-PR', 'Promotion Cards')")
    promoSetRes = await query("SELECT id FROM sets WHERE code = 'OP-PR' LIMIT 1")
    promoSetId = promoSetRes.rows[0]?.id
  }

  let count = 0
  for (const card of json) {
    if (!card.card_image_id) continue
    const cardCode = card.card_image_id.toUpperCase()
    let setId = promoSetId
    const match = card.optcg_don_name?.match(/\(([A-Z0-9-]+)\)$/)
    if (match) {
      let code = match[1]
      let setRes = await query("SELECT id FROM sets WHERE code = $1 LIMIT 1", [code])
      if (setRes.rows.length > 0) setId = setRes.rows[0].id
      else {
        let altCode = code.includes('-') ? code.replace('-', '') : code.replace(/([a-zA-Z]+)(\d+)/, '$1-$2')
        setRes = await query("SELECT id FROM sets WHERE code = $1 LIMIT 1", [altCode])
        if (setRes.rows.length > 0) setId = setRes.rows[0].id
      }
    }

    await query(`
      INSERT INTO cards (card_code, set_id, category, colors, cost, power, rarity, attributes, types)
      VALUES ($1, $2, 'DON!!', '[]', 0, 0, 'DON!!', '[]', '[]')
      ON CONFLICT (card_code) DO UPDATE SET set_id = EXCLUDED.set_id
    `, [cardCode, setId])

    const donName = card.optcg_don_name || card.card_name || 'DON!! Card'
    const donEffect = card.optcg_don_text || card.card_text || ''
    await query(`
      INSERT INTO card_locales (card_code, language, name, effect, img_url)
      VALUES ($1, 'en', $2, $3, $4)
      ON CONFLICT (card_code, language) DO UPDATE SET 
        name = EXCLUDED.name, effect = EXCLUDED.effect, img_url = EXCLUDED.img_url
    `, [cardCode, donName, donEffect, card.card_image || null])
    count++
  }
  
  console.log(`Successfully imported ${count} DON!! cards into Postgres.`)
  await pool.end()
}

run().catch(console.error).finally(() => process.exit(0))
