import http from 'http'
import { URL } from 'url'
import dotenv from 'dotenv'
import handler from '../api/index.ts'

dotenv.config()

const PORT = Number(process.env.PORT || 3000)

const server = http.createServer(async (req, res) => {
  // Enhanced response for Vercel Serverless Function compatibility
  const vRes: any = res

  vRes.status = function (code: number) {
    this.statusCode = code
    return this
  }

  vRes.json = function (data: any) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8')
    this.end(JSON.stringify(data))
    return this
  }

  vRes.send = function (data: any) {
    this.end(data)
    return this
  }

  // Parse query params
  const fullUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`)
  const query: Record<string, string> = {}
  fullUrl.searchParams.forEach((v, k) => {
    query[k] = v
  })
  ;(req as any).query = query

  // Read body if POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        ;(req as any).body = JSON.parse(body)
      } catch {
        ;(req as any).body = body
      }
      try {
        await handler(req as any, vRes)
      } catch (err: any) {
        vRes.status(500).json({ error: err.message })
      }
    })
  } else {
    try {
      await handler(req as any, vRes)
    } catch (err: any) {
      vRes.status(500).json({ error: err.message })
    }
  }
})

server.listen(PORT, () => {
  const dbMode = process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'PostgreSQL' : 'SQLite local (api/db/tcg.sqlite)'
  console.log(`\n🚀 Servidor API local corriendo en http://localhost:${PORT}`)
  console.log(`📡 Base de datos: ${dbMode}\n`)
})
