// Mail via SMTP at Infomaniak (same mailbox as Eduskript and Atlas: SMTP_USER=marc@eduskript.org,
// sender alias noreply@eduskript.org), no open/click tracking. Without SMTP_PASSWORD the mail is only logged.
import nodemailer from 'nodemailer'

let transport = null

export async function sendMail(to, subject, html, tag) {
  if (!process.env.SMTP_PASSWORD) {
    console.log(`[mail, no SMTP_PASSWORD] to ${to}: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}`)
    return
  }
  const from = process.env.EMAIL_FROM || 'noreply@eduskript.org'
  const port = Number(process.env.SMTP_PORT || 465)
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER || from, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 30000,
  })
  await transport.sendMail({ from: { name: 'Sky Stories', address: from }, to, subject, html, headers: { 'X-Sky-Tag': tag } })
}
