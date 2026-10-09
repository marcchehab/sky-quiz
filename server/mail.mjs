// Mail via Brevo (same account as Eduskript and Atlas). Without a key the mail is only logged.
export async function sendMail(to, subject, html, tag) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[mail, no BREVO_API_KEY] to ${to}: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}`)
    return
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      sender: { name: 'Sky Stories', email: process.env.EMAIL_FROM || 'noreply@eduskript.org' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      tags: [tag, 'no-tracking'],
    }),
  })
  if (!res.ok) throw new Error(`Brevo HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
