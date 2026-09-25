// Cloudflare Pages Function: emails a Payment & Deduction Statement PDF
// to a subcontractor, via Resend — same pattern as the payslip mailer.
//
// Env vars expected (set as secrets in Cloudflare Pages):
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL          - e.g. "Abacus Consultancy <cis@abacusconsultancy.co.uk>"
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

interface Env {
  RESEND_API_KEY: string
  RESEND_FROM_EMAIL: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  let body: { statementId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { statementId } = body
  if (!statementId) return json({ error: 'statementId is required' }, 400)

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return json(
      {
        error:
          'Email sending is not configured yet. Set RESEND_API_KEY and RESEND_FROM_EMAIL as environment secrets in Cloudflare Pages.',
      },
      501,
    )
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }

  const statementRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cis_statements?id=eq.${statementId}&select=*`,
    { headers },
  )
  const statements = await statementRes.json()
  const statement = statements?.[0]
  if (!statement?.pdf_path) return json({ error: 'Statement or its PDF not found' }, 404)

  const paymentRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cis_payments?id=eq.${statement.payment_id}&select=*`,
    { headers },
  )
  const payments = await paymentRes.json()
  const payment = payments?.[0]
  if (!payment) return json({ error: 'Payment not found' }, 404)

  const subRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cis_subcontractors?id=eq.${payment.subcontractor_id}&select=*`,
    { headers },
  )
  const subs = await subRes.json()
  const subcontractor = subs?.[0]
  if (!subcontractor?.email) return json({ error: 'Subcontractor has no email address on file' }, 400)

  const contractorRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cis_contractors?id=eq.${payment.contractor_id}&select=*`,
    { headers },
  )
  const contractors = await contractorRes.json()
  const contractor = contractors?.[0]

  // Download the PDF from Supabase Storage
  const pdfRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/cis-statements/${statement.pdf_path}`,
    { headers },
  )
  if (!pdfRes.ok) return json({ error: 'Could not fetch the statement PDF from storage' }, 502)
  const pdfBuffer = await pdfRes.arrayBuffer()
  const pdfBase64 = arrayBufferToBase64(pdfBuffer)

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: subcontractor.email,
      subject: `Payment and Deduction Statement — ${contractor?.name ?? 'Contractor'}`,
      html: `<p>Please find attached your Payment and Deduction Statement from ${contractor?.name ?? 'us'} for the tax month starting ${payment.tax_month_start}.</p>`,
      attachments: [
        {
          filename: `${subcontractor.business_name} - ${payment.tax_month_start}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  })

  if (!resendRes.ok) {
    const text = await resendRes.text()
    return json({ error: `Resend error: ${text}` }, 502)
  }

  return json({ ok: true })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
