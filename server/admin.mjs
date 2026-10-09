// Admin: block stories, stop users from publishing. Server-rendered, plain forms.
import express from 'express'
import { q } from './db.mjs'
import { currentUser, page } from './auth.mjs'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const day = t => t ? new Date(t).toISOString().slice(0, 10) : '–'

export function adminRoutes(app) {
  const admin = (req, res, next) => {
    const u = currentUser(req)
    if (!u?.isAdmin) return res.status(404).send(page('Not found.'))
    next()
  }
  app.use('/admin', admin, express.urlencoded({ extended: false }))

  app.get('/admin', (req, res) => {
    const users = q(`SELECT u.*, (SELECT COUNT(*) FROM stories WHERE userId = u.id) n,
      (SELECT COALESCE(SUM(size), 0) FROM blobs WHERE userId = u.id) bytes FROM users u ORDER BY u.created DESC`).all()
    const stories = q(`SELECT s.id, s.title, s.status, s.blocked, s.duration, s.updated, u.email
      FROM stories s JOIN users u ON u.id = s.userId ORDER BY s.updated DESC`).all()
    const btn = (action, label) => `<form method="post" action="${action}" style="display:inline"><button>${label}</button></form>`
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sky Stories admin</title>
<style>body{background:#0b0d33;color:#e8eaf6;font:14px system-ui,sans-serif;padding:16px;max-width:1100px;margin:auto}
table{border-collapse:collapse;width:100%;margin-bottom:28px}td,th{border-bottom:1px solid #2a2f6f;padding:5px 8px;text-align:left}
a{color:#f2c94c}button{background:#1a1f5c;color:#e8eaf6;border:1px solid #3a3f8f;border-radius:4px;padding:2px 8px;cursor:pointer}
.off{color:#f87171}.on{color:#4ade80}.dim{color:#8a90c0}</style>
<h2>📖 Sky Stories admin</h2><p><a href="/">← Sky Stories</a></p>
<h3>Stories (${stories.length})</h3><table><tr><th>Title</th><th>Author</th><th>Status</th><th>Length</th><th>Updated</th><th></th></tr>
${stories.map(s => `<tr><td>${esc(s.title)} <span class="dim">${esc(s.id)}</span></td><td>${esc(s.email)}</td>
<td>${s.blocked ? '<b class="off">blocked</b>' : s.status === 'published' ? '<span class="on">published</span>' : 'draft'}</td>
<td>${Math.round(s.duration)} s</td><td>${day(s.updated)}</td>
<td>${btn(`/admin/story/${encodeURIComponent(s.id)}/block`, s.blocked ? 'Unblock' : 'Block')}</td></tr>`).join('')}</table>
<h3>Users (${users.length})</h3><table><tr><th>Email</th><th>Since</th><th>Stories</th><th>Storage</th><th>Publishing</th><th></th></tr>
${users.map(u => `<tr><td>${esc(u.email)}${u.isAdmin ? ' <b>admin</b>' : ''}${u.verified ? '' : ' <span class="dim">(unconfirmed)</span>'}</td>
<td>${day(u.created)}</td><td>${u.n}</td><td>${(u.bytes / 1e6).toFixed(1)} MB</td>
<td>${u.canPublish ? '<span class="on">allowed</span>' : '<b class="off">banned</b>'}</td>
<td>${u.isAdmin ? '' : btn(`/admin/user/${u.id}/publish`, u.canPublish ? 'Ban from publishing' : 'Allow publishing')}</td></tr>`).join('')}</table>`)
  })
  app.post('/admin/story/:id/block', (req, res) => {
    q('UPDATE stories SET blocked = 1 - blocked WHERE id = ?').run(req.params.id); res.redirect('/admin')
  })
  app.post('/admin/user/:id/publish', (req, res) => {
    q('UPDATE users SET canPublish = 1 - canPublish WHERE id = ? AND isAdmin = 0').run(+req.params.id); res.redirect('/admin')
  })
}
