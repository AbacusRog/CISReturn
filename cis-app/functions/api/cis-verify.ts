// Cloudflare Pages Function: verifies a subcontractor with HMRC's CIS service.
//
// IMPORTANT — this is still a scaffold, not a tested integration, but the
// envelope and endpoints below are now confirmed against HMRC's public
// "Transaction Engine: Document Submission Protocol" (the general spec for
// all of HMRC's older GovTalk/XML gateway services, of which CIS Online is
// one) rather than guessed. What's confirmed vs. still missing:
//
// CONFIRMED (from HMRC's public Document Submission Protocol):
//   - Submission endpoints:
//       Test: https://test-transaction-engine.tax.service.gov.uk/submission
//       Live: https://transaction-engine.tax.service.gov.uk/submission
//   - The GovTalkMessage envelope shape (Header/MessageDetails,
//     SenderDetails/IDAuthentication, GovTalkDetails/Keys, Body) used below.
//   - Credentials are a Government Gateway SenderID + password (clear-text
//     Value, sent over TLS) — the same style as other legacy HMRC XML
//     services, obtained by registering as a software developer with
//     HMRC's Software Developer Support (SDS) team.
//   - A GatewayTest flag distinguishes test traffic (1) from live (0).
//
// STILL MISSING — and NOT publicly published, unlike HMRC's modern REST
// APIs which ship an open API spec:
//   - The exact CIS body schema (the <VerificationRequest>/<CIS300>
//     elements inside <IRenvelope xmlns="...CISreturn">) — HMRC does not
//     publish this openly. It, along with test credentials and sample
//     test-scenario files, is issued when you register with HMRC's
//     Software Developer Support team and go through their recognition
//     process (they review test submissions and confirm your software is
//     "HMRC recognised" — this normally takes about 10 working days once
//     you're submitting valid test files).
//   - Note: an older CIS "Electronic Data Interchange" (EDI) technical spec
//     was formally withdrawn by HMRC in 2019 — that's a different, older
//     technology than the GovTalk/XML gateway used here, so it doesn't
//     mean this route is dead, but it's a reminder these things move and
//     should be double-checked against SDS directly, not assumed from an
//     old PDF.
//
// So the practical next step isn't "read more docs" — it's registering
// with HMRC's Software Developer Support team (via the Developer Hub or by
// contacting them directly) to get a Vendor ID, test credentials, and the
// actual CIS request/response schema + sample test files. The body XML
// below is a structurally reasonable placeholder built from the public CIS
// Quality Standard / Business Validation Specification, not a verified
// message — expect to revise it once SDS gives you the real one.
//
// Env vars expected (set these in Cloudflare Pages > Settings > Environment
// variables, as *secrets*, not plaintext):
//   HMRC_GATEWAY_URL        - test-transaction-engine... or transaction-engine... (see above)
//   HMRC_SENDER_ID          - your agent's Government Gateway sender ID (from SDS registration)
//   HMRC_SENDER_PASSWORD    - the associated password
//   HMRC_GATEWAY_TEST       - "1" while testing, unset/"0" once live
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

interface Env {
  HMRC_GATEWAY_URL: string
  HMRC_SENDER_ID: string
  HMRC_SENDER_PASSWORD: string
  HMRC_GATEWAY_TEST: string
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
  // Envelope shape (Header/MessageDetails/SenderDetails/GovTalkDetails) is
  // confirmed against HMRC's Transaction Engine Document Submission
  // Protocol. The <Body> content — everything inside <IRenvelope
  // xmlns="...CISreturn"> — is still a placeholder: HMRC doesn't publish
  // this schema openly, so it needs replacing with what their Software
  // Developer Support team issues on registration. Don't trust this body
  // shape until it's been checked against that.
  const isTest = env.HMRC_GATEWAY_TEST === '1'
  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CIS-CIS300-VER</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <TransactionID></TransactionID>
      <CorrelationID></CorrelationID>
      ${isTest ? '<GatewayTest>1</GatewayTest>' : ''}
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
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_subcontractors?id=eq.${subcontractorId}&select=*`, { headers }),
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_contractors?id=eq.${contractorId}&select=*`, { headers }),
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
  await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_verification_requests`, {
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
