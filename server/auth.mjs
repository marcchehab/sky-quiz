// Accounts: email + password, magic links (sign-up confirmation, login, recovery) and passkeys.
// Sessions and links are HMAC-signed, so they need no table.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { q } from './db.mjs'
import { sendMail } from './mail.mjs'

const SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev')
if (!SECRET) throw new Error('SESSION_SECRET missing')
export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const RP_ID = new URL(BASE).hostname
const SECURE = BASE.startsWith('https:')
const ADMINS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean)
const DAY = 86400e3

const mac = s => createHmac('sha256', SECRET).update(s).digest('base64url')
function sign(payload) { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return p + '.' + mac(p) }
function unsign(tok) {
  const [p, m] = String(tok || '').split('.')
  if (!p || !m || m.length !== 43) return null
  if (!timingSafeEqual(Buffer.from(m), Buffer.from(mac(p)))) return null
  try { const x = JSON.parse(Buffer.from(p, 'base64url').toString()); return x.exp > Date.now() ? x : null } catch { return null }
}

// ---- passwords (scrypt) ----
export function hashPw(pw) { const salt = randomBytes(16); return salt.toString('hex') + '$' + scryptSync(pw, salt, 32).toString('hex') }
function checkPw(pw, stored) {
  if (!stored) return false
  const [s, h] = stored.split('$'), x = scryptSync(pw, Buffer.from(s, 'hex'), 32)
  return timingSafeEqual(x, Buffer.from(h, 'hex'))
}

// ---- users / sessions ----
export const normEmail = e => String(e || '').trim().toLowerCase()
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200
export function userByEmail(email) { return q('SELECT * FROM users WHERE email = ?').get(email) }
export function userById(id) { return q('SELECT * FROM users WHERE id = ?').get(id) }
export function ensureUser(email) {
  let u = userByEmail(email)
  if (!u) {
    q('INSERT INTO users (email, isAdmin, created) VALUES (?, ?, ?)').run(email, ADMINS.includes(email) ? 1 : 0, Date.now())
    u = userByEmail(email)
  }
  return u
}
function setSession(res, uid) {
  res.cookie('sid', sign({ uid, exp: Date.now() + 180 * DAY }), { httpOnly: true, sameSite: 'lax', secure: SECURE, maxAge: 180 * DAY, path: '/' })
}
export function currentUser(req) {
  const s = unsign(parseCookies(req).sid)
  return s ? userById(s.uid) || null : null
}
export function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
export const publicUser = u => u && { email: u.email, isAdmin: !!u.isAdmin, canPublish: !!u.canPublish, hasPassword: !!u.password,
  passkeys: q('SELECT COUNT(*) n FROM passkeys WHERE userId = ?').get(u.id).n }

// ---- rate limits (in memory; one small server) ----
const hits = new Map()
function limited(key, max, ms) {
  const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms)
  a.push(now); hits.set(key, a)
  return a.length > max
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (a.every(t => now - t > 3600e3)) hits.delete(k) }, 600e3).unref()

// ---- magic links ----
async function sendLink(email, why) {
  const tok = sign({ e: email, exp: Date.now() + 30 * 60e3 })
  const url = `${BASE}/auth/link?t=${tok}`
  const head = why === 'register' ? 'Welcome to Sky Stories! Confirm your email address:' : 'Sign in to Sky Stories:'
  await sendMail(email, why === 'register' ? 'Confirm your Sky Stories account' : 'Your Sky Stories sign-in link',
    `<p>${head}</p><p><a href="${url}">${url}</a></p><p>The link is valid for 30 minutes. If you didn't ask for it, just ignore this mail.</p>`, 'skystories-' + why)
}

// ---- passkey ceremonies: the challenge travels in a short signed cookie ----
function setChallenge(res, c, uid) {
  res.cookie('wac', sign({ c, uid, exp: Date.now() + 5 * 60e3 }), { httpOnly: true, sameSite: 'strict', secure: SECURE, maxAge: 5 * 60e3, path: '/api/auth/passkey' })
}
const getChallenge = req => unsign(parseCookies(req).wac)

export function authRoutes(app) {
  const ip = req => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
  const tooMany = (res, msg) => res.status(429).json({ error: msg || 'Too many attempts – please wait a few minutes.' })

  app.get('/api/me', (req, res) => res.json({ user: publicUser(currentUser(req)) }))

  app.post('/api/auth/register', async (req, res) => {
    const email = normEmail(req.body?.email), pw = String(req.body?.password || '')
    if (!okEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
    if (pw.length < 8) return res.status(400).json({ error: 'The password needs at least 8 characters.' })
    if (limited('reg:' + ip(req), 5, 3600e3) || limited('mail:' + email, 4, 3600e3)) return tooMany(res)
    const u = userByEmail(email)
    if (u && u.verified) {   // don't reveal anything; send a sign-in link instead
      await sendLink(email, 'login'); return res.json({ ok: true, sent: true })
    }
    const v = ensureUser(email)
    q('UPDATE users SET password = ? WHERE id = ?').run(hashPw(pw), v.id)
    await sendLink(email, 'register')
    res.json({ ok: true, sent: true })
  })

  app.post('/api/auth/login', (req, res) => {
    const email = normEmail(req.body?.email), pw = String(req.body?.password || '')
    if (limited('login:' + ip(req), 20, 900e3) || limited('login:' + email, 8, 900e3)) return tooMany(res)
    const u = userByEmail(email)
    if (!u || !checkPw(pw, u.password)) return res.status(401).json({ error: 'Email or password is wrong.' })
    if (!u.verified) return res.status(403).json({ error: 'Please confirm your email address first (see the mail we sent you).' })
    setSession(res, u.id); res.json({ user: publicUser(u) })
  })

  app.post('/api/auth/magic', async (req, res) => {
    const email = normEmail(req.body?.email)
    if (!okEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
    if (limited('magic:' + ip(req), 10, 3600e3) || limited('mail:' + email, 4, 3600e3)) return tooMany(res)
    await sendLink(email, 'login')
    res.json({ ok: true, sent: true })
  })

  // the link from the mail: confirms the address (and creates the account if needed), then signs in
  app.get('/auth/link', (req, res) => {
    const x = unsign(req.query.t)
    if (!x?.e) return res.status(400).send(page('This link has expired or is invalid. Please ask for a new one.'))
    const u = ensureUser(x.e)
    if (!u.verified) q('UPDATE users SET verified = 1 WHERE id = ?').run(u.id)
    setSession(res, u.id)
    res.redirect('/?signedin=1')
  })

  app.post('/api/auth/logout', (req, res) => { res.clearCookie('sid', { path: '/' }); res.json({ ok: true }) })

  app.post('/api/auth/password', (req, res) => {   // set or change (signed in, e.g. after a recovery link)
    const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
    const pw = String(req.body?.password || '')
    if (pw.length < 8) return res.status(400).json({ error: 'The password needs at least 8 characters.' })
    q('UPDATE users SET password = ? WHERE id = ?').run(hashPw(pw), u.id)
    res.json({ user: publicUser(userById(u.id)) })
  })

  // --- passkeys ---
  app.post('/api/auth/passkey/register-options', async (req, res) => {
    const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' })
    const existing = q('SELECT id, transports FROM passkeys WHERE userId = ?').all(u.id)
    const opts = await generateRegistrationOptions({
      rpName: 'Sky Stories', rpID: RP_ID, userName: u.email,
      userID: new TextEncoder().encode('u' + u.id),
      attestationType: 'none',
      excludeCredentials: existing.map(p => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    })
    setChallenge(res, opts.challenge, u.id); res.json(opts)
  })
  app.post('/api/auth/passkey/register', async (req, res) => {
    const u = currentUser(req), ch = getChallenge(req)
    if (!u || !ch || ch.uid !== u.id) return res.status(400).json({ error: 'Please try again.' })
    try {
      const v = await verifyRegistrationResponse({ response: req.body, expectedChallenge: ch.c, expectedOrigin: BASE, expectedRPID: RP_ID })
      if (!v.verified) throw new Error('not verified')
      const c = v.registrationInfo.credential
      q('INSERT OR REPLACE INTO passkeys (id, userId, publicKey, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.id, u.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports || []), Date.now())
      res.json({ user: publicUser(u) })
    } catch (e) { res.status(400).json({ error: 'Passkey could not be saved: ' + e.message }) }
  })
  app.post('/api/auth/passkey/login-options', async (req, res) => {
    if (limited('pk:' + ip(req), 30, 900e3)) return tooMany(res)
    const opts = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' })
    setChallenge(res, opts.challenge, 0); res.json(opts)
  })
  app.post('/api/auth/passkey/login', async (req, res) => {
    const ch = getChallenge(req), p = q('SELECT * FROM passkeys WHERE id = ?').get(String(req.body?.id || ''))
    if (!ch || !p) return res.status(400).json({ error: 'This passkey is not known here.' })
    try {
      const v = await verifyAuthenticationResponse({
        response: req.body, expectedChallenge: ch.c, expectedOrigin: BASE, expectedRPID: RP_ID,
        credential: { id: p.id, publicKey: new Uint8Array(p.publicKey), counter: p.counter, transports: JSON.parse(p.transports || '[]') },
      })
      if (!v.verified) throw new Error('not verified')
      q('UPDATE passkeys SET counter = ? WHERE id = ?').run(v.authenticationInfo.newCounter, p.id)
      const u = userById(p.userId)
      if (!u.verified) q('UPDATE users SET verified = 1 WHERE id = ?').run(u.id)
      setSession(res, u.id); res.json({ user: publicUser(u) })
    } catch (e) { res.status(400).json({ error: 'Passkey sign-in failed: ' + e.message }) }
  })
}

export function page(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sky Stories</title>
<body style="background:#0b0d33;color:#e8eaf6;font:16px system-ui,sans-serif;padding:40px 16px;max-width:520px;margin:auto">
<h2>📖 Sky Stories</h2><p>${msg}</p><p><a style="color:#f2c94c" href="/">Back to Sky Stories</a></p>`
}
