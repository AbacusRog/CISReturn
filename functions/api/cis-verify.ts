// Cloudflare Pages Function: verifies a subcontractor with HMRC's CIS service.
//
// IMPORTANT — this is a scaffold, not a tested integration. HMRC's CIS
// service (verification + CIS300 submission) is one of the older
// GovTalk/XML government gateway services, not the newer OAuth/REST style
// used by VAT or Income Tax MTD. Before this will work against HMRC for
// real, you need to:
//
//   1. Read HMRC's actual "CIS Online" service documentation and the
//      Government Gateway XML submission protocol (GovTalkMessage envelope,
//      IRheader, IRmark digest, credentials block) — these define the exact
//      XML you must send, and the shape below is a reasonable approximation
//      based on the public CIS Quality Standard / Business Validation
//      Specification, not a verified-working message.
//   2. Register your agent credentials (Government Gateway sender ID and
//      password, or whatever the current CIS Online credential type is)
//      as environment secrets in Cloudflare Pages — never in the repo or
//      in client-side code.
//   3. Test everything against HMRC's test-in-live / test gateway before
//      pointing this at the live endpoint.
//
// Env vars expected (set these in Cloudflare Pages > Settings > Environment
// variables, as *secrets*, not plaintext):
//   HMRC_GATEWAY_URL        - the Government Gateway submission endpoint
//   HMRC_SENDER_ID          - your agent's Government Gateway sender ID
//   HMRC_SENDER_PASSWORD    - the associated password
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

interface Env {
  HMRC_GATEWAY_URL: string
  HMRC_SENDER_ID: string
  HMRC_SENDER_PASSWORD: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  let body: { subcontractorId?: string; contractorId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { subcontractorId, contractorId } = body
  if (!subcontractorId || !contractorId) {
    return json({ error: 'subcontractorId and contractorId are required' }, 400)
  }

  if (!env.HMRC_GATEWAY_URL || !env.HMRC_SENDER_ID) {
    return json(
      {
        error:
          'HMRC gateway credentials are not configured yet. Set HMRC_GATEWAY_URL, HMRC_SENDER_ID and HMRC_SENDER_PASSWORD as environment secrets in Cloudflare Pages before verification can run.',
      },
      501,
    )
  }

  const supabase = await getSupabaseRow(env, subcontractorId, contractorId)
  if ('error' in supabase) return json({ error: supabase.error }, 404)
  const { subcontractor, contractor } = supabase

  try {
    const xml = buildVerificationRequestXml({ subcontractor, contractor, env })
    const response = await fetch(env.HMRC_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })
    const text = await response.text()

    if (!response.ok) {
      await logVerification(env, subcontractorId, contractorId, xml, text, 'error', text)
      return json({ error: `HMRC returned ${response.status}` }, 502)
    }

    const parsed = parseVerificationResponse(text)
    await logVerification(env, subcontractorId, contractorId, xml, text, parsed.status)

    return json(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await logVerification(env, subcontractorId, contractorId, '', '', 'error', message)
    return json({ error: message }, 500)
  }
}

function buildVerificationRequestXml({ subcontractor, contractor, env }: any): string {
  // Placeholder structure only — replace with the exact schema from HMRC's
  // CIS Quality Standard / Business Validation Specification once you have
  // it in front of you and have tested against the sandbox.
  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CIS-CIS300-VER</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <TransactionID></TransactionID>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>${env.HMRC_SENDER_ID}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Value>${env.HMRC_SENDER_PASSWORD}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>
  <GovTalkDetails>
    <Keys>
      <Key Type="TaxOfficeNumber"></Key>
      <Key Type="TaxOfficeReference">${contractor.utr ?? ''}</Key>
    </Keys>
  </GovTalkDetails>
  <Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/CISreturn">
      <IRheader>
        <Sender>Agent</Sender>
      </IRheader>
      <VerificationRequest>
        <ContractorUTR>${contractor.utr ?? ''}</ContractorUTR>
        <Subcontractor>
          <BusinessName>${escapeXml(subcontractor.business_name)}</BusinessName>
          <UTR>${subcontractor.utr ?? ''}</UTR>
          <NINO>${subcontractor.ni_number ?? ''}</NINO>
          <CRN>${subcontractor.company_reg_number ?? ''}</CRN>
        </Subcontractor>
      </VerificationRequest>
    </IRenvelope>
  </Body>
</GovTalkMessage>`
}

function parseVerificationResponse(xml: string): {
  status: 'verified' | 'matched_higher_rate' | 'not_matched'
  deductionRate: 0 | 20 | 30
  verificationNumber: string | null
} {
  // Placeholder parser — replace once the real response schema is known.
  // Defaults to "not matched" / 30% (the safe fallback) rather than
  // guessing a lower rate.
  const verificationNumberMatch = xml.match(/<VerificationNumber>(.*?)<\/VerificationNumber>/)
  const matchResultMatch = xml.match(/<MatchResult>(.*?)<\/MatchResult>/)
  const matchResult = matchResultMatch?.[1]

  if (matchResult === 'Matched') {
    return { status: 'verified', deductionRate: 20, verificationNumber: verificationNumberMatch?.[1] ?? null }
  }
  if (matchResult === 'MatchedHigherRate') {
    return { status: 'matched_higher_rate', deductionRate: 30, verificationNumber: verificationNumberMatch?.[1] ?? null }
  }
  return { status: 'not_matched', deductionRate: 30, verificationNumber: null }
}

async function getSupabaseRow(env: Env, subcontractorId: string, contractorId: string) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }
  const [subRes, contractorRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/cis_subcontractors?id=eq.${subcontractorId}&select=*`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/cis_contractors?id=eq.${contractorId}&select=*`, { headers }),
  ])
  const [subs, contractors] = await Promise.all([subRes.json(), contractorRes.json()])
  if (!subs?.[0] || !contractors?.[0]) return { error: 'Subcontractor or contractor not found' }
  return { subcontractor: subs[0], contractor: contractors[0] }
}

async function logVerification(
  env: Env,
  subcontractorId: string,
  contractorId: string,
  requestXml: string,
  responseXml: string,
  status: string,
  errorMessage?: string,
) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/cis_verification_requests`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      subcontractor_id: subcontractorId,
      contractor_id: contractorId,
      request_payload: { xml: requestXml },
      response_payload: { xml: responseXml },
      status,
      error_message: errorMessage ?? null,
    }),
  }).catch(() => {})
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
