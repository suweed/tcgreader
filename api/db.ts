import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

let pool: Pool | null = null
let sqliteDb: any = null

function cleanSqlAndParamsForSqlite(sql: string, params: unknown[] = []): { cleanSql: string; mappedParams: unknown[] } {
  const mappedParams: unknown[] = []

  let cleaned = sql
    .replace(/TO_TIMESTAMP\(([^)]+)\)::date/gi, "date($1, 'unixepoch')")
    .replace(/::[a-zA-Z_]+/g, '')
    .replace(/EXTRACT\(EPOCH FROM NOW\(\)\)/gi, 'unixepoch()')
    .replace(/NULLS LAST/gi, '')
    .replace(/\bILIKE\b/gi, 'LIKE')

  cleaned = cleaned.replace(/\$([0-9]+)/g, (_, numStr) => {
    const idx = parseInt(numStr, 10) - 1
    mappedParams.push(params[idx])
    return '?'
  })

  return { cleanSql: cleaned, mappedParams }
}

export function getDbMode(): 'postgres' | 'sqlite' {
  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL

  if (connectionString) {
    return 'postgres'
  }

  return 'sqlite'
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_PRISMA_URL

    if (!connectionString) {
      throw new Error(
        'Falta la variable de entorno POSTGRES_URL o DATABASE_URL con la conexión a PostgreSQL.'
      )
    }

    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    })
  }

  return pool
}

async function getSqliteDb() {
  if (!sqliteDb) {
    const sqlitePath = path.resolve(process.cwd(), 'api/db/tcg.sqlite')
    if (!fs.existsSync(sqlitePath)) {
      throw new Error(`Base de datos SQLite local no encontrada en ${sqlitePath}`)
    }
    const { DatabaseSync } = await import('node:sqlite')
    sqliteDb = new DatabaseSync(sqlitePath)
  }
  return sqliteDb
}

export async function query(text: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
  if (getDbMode() === 'postgres') {
    const p = getPool()
    const res = await p.query(text, params)
    return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length }
  }

  // Fallback SQLite local si no hay DATABASE_URL configurado
  const db = await getSqliteDb()
  const { cleanSql, mappedParams } = cleanSqlAndParamsForSqlite(text, params)
  const stmt = db.prepare(cleanSql)
  const isRead = cleanSql.trim().toUpperCase().startsWith('SELECT') || cleanSql.toUpperCase().includes('RETURNING')

  if (isRead) {
    const rows = stmt.all(...mappedParams)
    return { rows, rowCount: rows.length }
  } else {
    const info = stmt.run(...mappedParams)
    return { rows: [], rowCount: Number(info.changes) }
  }
}
