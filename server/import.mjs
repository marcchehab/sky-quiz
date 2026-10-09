// Import an exported .skystory file into an account: node import.mjs <file.skystory> <email> [--publish]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { q, BLOBS } from './db.mjs'
import { ensureUser, normEmail } from './auth.mjs'

const [file, email, flag] = process.argv.slice(2)
if (!file || !email) { console.error('usage: node import.mjs <file.skystory> <email> [--publish]'); process.exit(1) }
const s = JSON.parse(readFileSync(file, 'utf8')), u = ensureUser(normEmail(email))
q('UPDATE users SET verified = 1 WHERE id = ?').run(u.id)

function blob(dataUrl) {   // data:<type>;base64,<…> -> hash
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(dataUrl || ''); if (!m) throw new Error('bad data url')
  const buf = Buffer.from(m[2], 'base64'), h = createHash('sha256').update(buf).digest('hex')
  if (!existsSync(join(BLOBS, h))) writeFileSync(join(BLOBS, h), buf)
  q('INSERT OR IGNORE INTO blobs (hash, type, size, userId, created) VALUES (?, ?, ?, ?, ?)').run(h, m[1], buf.length, u.id, Date.now())
  return h
}
const data = {
  format: 'skystory', version: 3, duration: s.duration, created: s.created || Date.now(), cues: s.cues || [], subs: s.subs || [],
  audio: blob(s.audio),
  art: (s.art || []).map(a => ({ ...a, img: blob(a.img) })),
  sfx: (s.sfx || []).map(x => ({ ...x, audio: blob(x.audio) })),
}
const now = Date.now(), pub = flag === '--publish'
q(`INSERT INTO stories (id, userId, title, duration, data, created, updated, status, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, duration = excluded.duration, data = excluded.data, updated = excluded.updated,
  status = excluded.status, published = COALESCE(stories.published, excluded.published)`)
  .run(s.id, u.id, s.title, s.duration, JSON.stringify(data), s.created || now, now, pub ? 'published' : 'draft', pub ? now : null)
console.log(`imported "${s.title}" (${s.id}) for ${u.email}${pub ? ', published' : ''}`)
