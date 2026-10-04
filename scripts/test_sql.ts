import { Pool } from 'pg'
import dotenv from 'dotenv'
dotenv.config()

async function test() {
  const connectionString = process.env.DATABASE_URL
  const pool = new Pool({ connectionString, ssl: false })

  const isDon = true
  const op = isDon ? '=' : '!='
  const sql = `
    SELECT
      (SELECT COUNT(DISTINCT col.card_code)::int FROM collection col JOIN cards c ON c.card_code = col.card_code WHERE c.category ${op} 'DON!!') AS total_owned,
      (SELECT COUNT(*)::int FROM cards WHERE category ${op} 'DON!!') AS total_cards,
      (SELECT COUNT(DISTINCT c.set_id)::int FROM cards c WHERE category ${op} 'DON!!') AS total_sets,
      (SELECT COUNT(*)::int FROM collection col JOIN cards c ON c.card_code = col.card_code WHERE col.language = 'en' AND c.category ${op} 'DON!!') AS cards_with_en,
      (SELECT COUNT(*)::int FROM collection col JOIN cards c ON c.card_code = col.card_code WHERE col.language = 'jp' AND c.category ${op} 'DON!!') AS cards_with_jp,
      (SELECT ROUND(SUM(col.price_usd * col.quantity), 2)::float FROM collection col JOIN cards c ON c.card_code = col.card_code WHERE col.price_usd IS NOT NULL AND c.category ${op} 'DON!!') AS total_value_usd,
      (SELECT COUNT(*)::int FROM collection col JOIN cards c ON c.card_code = col.card_code WHERE col.price_usd IS NOT NULL AND c.category ${op} 'DON!!') AS priced_cards,
      (SELECT COUNT(DISTINCT l.card_code)::int FROM card_locales l JOIN cards c ON c.card_code = l.card_code WHERE l.language = 'en' AND c.category ${op} 'DON!!') AS total_en,
      (SELECT COUNT(DISTINCT l.card_code)::int FROM card_locales l JOIN cards c ON c.card_code = l.card_code WHERE l.language = 'jp' AND c.category ${op} 'DON!!') AS total_jp
  `

  try {
    const res = await pool.query(sql)
    console.log(res.rows[0])
  } catch (err) {
    console.error("QUERY FAILED:", err.message)
  }
  await pool.end()
}
test()
