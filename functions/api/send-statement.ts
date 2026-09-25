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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        error:
          'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set as environment secrets in Cloudflare Pages — this function cannot read the statement without them.',
      },
      501,
    )
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }

  const statement = await fetchOneOrThrow(
    `${env.SUPABASE_URL}/rest/v1/cis_statements?id=eq.${statementId}&select=*`,
    headers,
    'statement',
  )
  if ('error' in statement) return json({ error: statement.error }, statement.status)
  if (!statement.row?.pdf_path) return json({ error: 'Statement or its PDF not found' }, 404)

  const payment = await fetchOneOrThrow(
    `${env.SUPABASE_URL}/rest/v1/cis_payments?id=eq.${statement.row.payment_id}&select=*`,
    headers,
    'payment',
  )
  if ('error' in payment) return json({ error: payment.error }, payment.status)
  if (!payment.row) return json({ error: 'Payment not found' }, 404)

  const subcontractorResult = await fetchOneOrThrow(
    `${env.SUPABASE_URL}/rest/v1/cis_subcontractors?id=eq.${payment.row.subcontractor_id}&select=*`,
    headers,
    'subcontractor',
  )
  if ('error' in subcontractorResult) return json({ error: subcontractorResult.error }, subcontractorResult.status)
  const subcontractor = subcontractorResult.row
  if (!subcontractor?.email) return json({ error: 'Subcontractor has no email address on file' }, 400)

  const contractorResult = await fetchOneOrThrow(
    `${env.SUPABASE_URL}/rest/v1/cis_contractors?id=eq.${payment.row.contractor_id}&select=*`,
    headers,
    'contractor',
  )
  const contractor = 'row' in contractorResult ? contractorResult.row : null
  const paymentRow = payment.row

  // Download the PDF from Supabase Storage
  const pdfRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/cis-statements/${statement.row.pdf_path}`,
    { headers },
  )
  if (!pdfRes.ok) {
    const text = await pdfRes.text()
    return json({ error: `Could not fetch the statement PDF from storage (${pdfRes.status}): ${text}` }, 502)
  }
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
      html: `<p>Please find attached your Payment and Deduction Statement from ${contractor?.name ?? 'us'} for the tax month starting ${paymentRow.tax_month_start}.</p>`,
      attachments: [
        {
          filename: `${subcontractor.business_name} - ${paymentRow.tax_month_start}.pdf`,
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

// Fetches a single row from a PostgREST endpoint and distinguishes a genuine
// "not found" (empty array) from an auth/config failure (PostgREST returns
// an error object, not an array, when the API key is missing or wrong) —
// so misconfigured Cloudflare secrets get reported as what they are instead
// of a misleading "not found".
async function fetchOneOrThrow(
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<{ row: any } | { error: string; status: number }> {
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch (err) {
    return {
      error: `Could not reach Supabase to look up the ${label} (check SUPABASE_URL): ${
        err instanceof Error ? err.message : String(err)
      }`,
      status: 502,
    }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return {
      error: `Supabase rejected the ${label} lookup (${res.status}). Check SUPABASE_SERVICE_ROLE_KEY is set correctly. Details: ${JSON.stringify(body)}`,
      status: 502,
    }
  }
  if (!Array.isArray(body)) {
    return {
      error: `Unexpected response looking up the ${label}: ${JSON.stringify(body)}`,
      status: 502,
    }
  }
  return { row: body[0] ?? null }
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
