// Sky Stories server: serves the page, accounts, stories (JSON + content-addressed blobs) and a small admin.
import express from 'express'
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { q, BLOBS } from './db.mjs'
import { authRoutes, currentUser, BASE, page } from './auth.mjs'
import { adminRoutes } from './admin.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const PAGE = join(ROOT, 'dist', 'index.html')
const BLOB_TYPES = { 'audio/webm': 25e6, 'audio/ogg': 25e6, 'audio/mp4': 25e6, 'audio/mpeg': 25e6, 'audio/wav': 25e6,
  'audio/x-wav': 25e6, 'audio/wave': 25e6, 'audio/flac': 25e6, 'audio/aac': 25e6, 'audio/x-m4a': 25e6,
  'image/webp': 3e6, 'image/png': 6e6, 'image/jpeg': 4e6 }
const QUOTA = +(process.env.USER_QUOTA_MB || 300) * 1e6

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback, uniquelocal')

// CSRF: state-changing requests must come from our own origin (cookies are SameSite=Lax as well)
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  const o = req.headers.origin
  if (o && o !== BASE) return res.status(403).json({ error: 'Wrong origin.' })
  next()
})
app.use('/api', express.json({ limit: '2mb' }))

authRoutes(app)
adminRoutes(app)

// ---- page ----
let pageHtml = null
app.get(['/', '/index.html'], (req, res) => {
  if (!pageHtml || process.env.NODE_ENV !== 'production') pageHtml = readFileSync(PAGE, 'utf8')
  res.set('Cache-Control', 'no-cache').type('html').send(pageHtml)
})
app.get('/vendor/webauthn.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400')
  res.sendFile(join(ROOT, 'server/node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js'))
})

// ---- blobs ----
const HEX = /^[0-9a-f]{64}$/
app.get('/blobs/:hash', (req, res) => {
  const h = req.params.hash, b = HEX.test(h) && q('SELECT type FROM blobs WHERE hash = ?').get(h)
  if (!b) return res.sendStatus(404)
  res.set('Cache-Control', 'public, max-age=31536000, immutable').type(b.type).sendFile(join(BLOBS, h))
})
app.head('/api/blobs/:hash', (req, res) => res.sendStatus(HEX.test(req.params.hash) && q('SELECT 1 FROM blobs WHERE hash = ?').get(req.params.hash) ? 200 : 404))
app.put('/api/blobs/:hash', express.raw({ type: () => true, limit: '26mb' }), (req, res) => {
  const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
  const h = req.params.hash, type = String(req.headers['content-type'] || '').split(';')[0].trim()
  if (!HEX.test(h)) return res.status(400).json({ error: 'Bad hash.' })
  if (q('SELECT 1 FROM blobs WHERE hash = ?').get(h)) return res.json({ ok: true })
  if (!BLOB_TYPES[type]) return res.status(415).json({ error: 'File type not allowed: ' + type })
  const buf = req.body
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > BLOB_TYPES[type]) return res.status(413).json({ error: 'File too large.' })
  if (createHash('sha256').update(buf).digest('hex') !== h) return res.status(400).json({ error: 'Hash does not match.' })
  const used = q('SELECT COALESCE(SUM(size), 0) n FROM blobs WHERE userId = ?').get(u.id).n
  if (used + buf.length > QUOTA) return res.status(413).json({ error: 'Your storage is full.' })
  const tmp = join(BLOBS, h + '.tmp'); writeFileSync(tmp, buf); renameSync(tmp, join(BLOBS, h))
  q('INSERT OR IGNORE INTO blobs (hash, type, size, userId, created) VALUES (?, ?, ?, ?, ?)').run(h, type, buf.length, u.id, Date.now())
  res.json({ ok: true })
})

// ---- stories ----
// visible to everyone: published, not blocked, and the author may publish
const PUBLIC = `s.status = 'published' AND s.blocked = 0 AND u.canPublish = 1`
const listRow = r => ({ id: r.id, title: r.title, duration: r.duration, status: r.status, blocked: !!r.blocked,
  updated: r.updated, author: r.author, mine: !!r.mine, subs: !!r.subs })
app.get('/api/stories', (req, res) => {
  const u = currentUser(req), uid = u ? u.id : -1
  const rows = q(`SELECT s.id, s.title, s.duration, s.status, s.blocked, s.updated, s.userId = ? mine,
      json_array_length(s.data, '$.subs') > 0 subs, u.email author
    FROM stories s JOIN users u ON u.id = s.userId
    WHERE s.userId = ? OR (${PUBLIC}) ORDER BY COALESCE(s.published, s.created)`).all(uid, uid)
  res.json(rows.map(r => ({ ...listRow(r), author: r.mine ? 'you' : null })))
})
function canRead(s, u) {
  if (!s) return false
  if (u && (u.id === s.userId || u.isAdmin)) return true
  return s.status === 'published' && !s.blocked && !!q('SELECT canPublish FROM users WHERE id = ?').get(s.userId)?.canPublish
}
app.get('/api/stories/:id', (req, res) => {
  const s = q('SELECT * FROM stories WHERE id = ?').get(req.params.id), u = currentUser(req)
  if (!canRead(s, u)) return res.status(404).json({ error: 'Story not found.' })
  res.set('Cache-Control', 'no-cache').json({ ...JSON.parse(s.data), id: s.id, title: s.title, status: s.status, mine: !!u && u.id === s.userId })
})
function hashesOf(d) {
  const h = [d.audio]
  ;(d.art || []).forEach(a => h.push(a.img))
  ;(d.sfx || []).forEach(x => h.push(x.audio))
  return h
}
app.put('/api/stories/:id', (req, res) => {
  const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
  const id = String(req.params.id), d = req.body || {}
  if (!/^[\w-]{3,64}$/.test(id)) return res.status(400).json({ error: 'Bad id.' })
  const old = q('SELECT userId FROM stories WHERE id = ?').get(id)
  if (old && old.userId !== u.id) return res.status(409).json({ error: 'This id belongs to another story.' })
  const title = String(d.title || 'Untitled').slice(0, 120)
  const missing = hashesOf(d).filter(h => !HEX.test(h || '') || !q('SELECT 1 FROM blobs WHERE hash = ?').get(h))
  if (missing.length) return res.status(400).json({ error: 'Missing files – upload them first.', missing })
  const data = JSON.stringify({ format: 'skystory', version: 3, duration: +d.duration || 0, created: +d.created || Date.now(),
    cues: d.cues || [], subs: d.subs || [], audio: d.audio, art: d.art || [], sfx: d.sfx || [] })
  if (data.length > 1.5e6) return res.status(413).json({ error: 'Story too large.' })
  const now = Date.now()
  if (old) q('UPDATE stories SET title = ?, duration = ?, data = ?, updated = ? WHERE id = ?').run(title, +d.duration || 0, data, now, id)
  else q('INSERT INTO stories (id, userId, title, duration, data, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, u.id, title, +d.duration || 0, data, now, now)
  res.json({ ok: true })
})
app.delete('/api/stories/:id', (req, res) => {
  const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
  q('DELETE FROM stories WHERE id = ? AND userId = ?').run(req.params.id, u.id)
  res.json({ ok: true })
})
app.post('/api/stories/:id/status', (req, res) => {
  const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
  const s = q('SELECT * FROM stories WHERE id = ? AND userId = ?').get(req.params.id, u.id)
  if (!s) return res.status(404).json({ error: 'Story not found.' })
  const pub = req.body?.status === 'published'
  if (pub && !u.canPublish) return res.status(403).json({ error: 'Publishing is disabled for your account.' })
  q('UPDATE stories SET status = ?, published = COALESCE(published, ?) WHERE id = ?').run(pub ? 'published' : 'draft', pub ? Date.now() : null, s.id)
  res.json({ ok: true, status: pub ? 'published' : 'draft', blocked: !!s.blocked })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Server error.' })
})

const PORT = +(process.env.PORT || 3000)
app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Sky Stories on :${PORT} (${BASE})`))

