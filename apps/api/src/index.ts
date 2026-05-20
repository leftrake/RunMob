import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { meetsRouter } from './routes/meets.js'
import { athletesRouter } from './routes/athletes.js'
import { searchRouter } from './routes/search.js'

const app = new Hono()

app.use('*', logger())
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173', 'http://localhost:4173']

app.use('*', cors({ origin: allowedOrigins }))

app.route('/api/meets', meetsRouter)
app.route('/api/athletes', athletesRouter)
app.route('/api/search', searchRouter)

app.get('/api/health', (c) => c.json({ ok: true }))

const port = parseInt(process.env.PORT ?? '3001')
console.log(`API running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
