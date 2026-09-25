// Cloudflare Pages Function: submits a CIS300 monthly return to HMRC.
//
// See cis-verify.ts for the full picture of what's confirmed vs. still
// missing — same envelope/endpoints, same gap (the CIS300 body schema
// itself isn't public; it comes from HMRC's Software Developer Support
// team on registration). Two things specific to this function:
//
//   - It previously built a GovTalkMessage with no SenderDetails block at
//     all, i.e. it never actually authenticated. Fixed below to match the
//     credentials block used in cis-verify.ts.
//   - HMRC's Transaction Engine protocol supports an asynchronous
//     "poll this URL" response for some services, rather than an
//     immediate result. This function assumes an immediate response;
//     if HMRC's real response is a poll redirect, this needs extending
//     to call GET on the poll endpoint until a final result comes back.
//
// This function reads the return + its persisted line snapshot from
// Supabase (cis_return_lines), builds the CIS300 XML, submits it, and
// writes the outcome back.

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

  let body: { monthlyReturnId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { monthlyReturnId } = body
  if (!monthlyReturnId) return json({ error: 'monthlyReturnId is required' }, 400)

  if (!env.HMRC_GATEWAY_URL || !env.HMRC_SENDER_ID) {
    return json(
      {
        error:
          'HMRC gateway credentials are not configured yet. Set HMRC_GATEWAY_URL, HMRC_SENDER_ID and HMRC_SENDER_PASSWORD as environment secrets in Cloudflare Pages, and confirm the CIS300 XML schema, before returns can be submitted.',
      },
      501,
    )
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }

  const [returnRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_monthly_returns?id=eq.${monthlyReturnId}&select=*`, { headers }),
  ])
  const returns = await returnRes.json()
  const monthlyReturn = returns?.[0]
  if (!monthlyReturn) return json({ error: 'Monthly return not found' }, 404)

  const [contractorRes, linesRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_contractors?id=eq.${monthlyReturn.contractor_id}&select=*`, { headers }),
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/cis_return_lines?monthly_return_id=eq.${monthlyReturnId}&select=*`, { headers }),
  ])
  const contractors = await contractorRes.json()
  const lines = await linesRes.json()
  const contractor = contractors?.[0]
  if (!contractor) return json({ error: 'Contractor not found' }, 404)

  try {
    const xml = buildCis300Xml({ contractor, monthlyReturn, lines, env })
    const response = await fetch(env.HMRC_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })
    const text = await response.text()

    if (!response.ok) {
      return json({ error: `HMRC returned ${response.status}`, status: 'rejected', raw: text }, 502)
    }

    const correlationId = text.match(/<CorrelationID>(.*?)<\/CorrelationID>/)?.[1] ?? null
    const qualifier = text.match(/<Qualifier>(.*?)<\/Qualifier>/)?.[1]
    const status = qualifier === 'error' ? 'rejected' : 'submitted'

    return json({ status, correlationId, raw: text })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json({ error: message }, 500)
  }
}

function buildCis300Xml({ contractor, monthlyReturn, lines, env }: any): string {
  const subcontractorBlocks = (lines ?? [])
    .map(
      (l: any) => `
      <Subcontractor>
        <BusinessName>${escapeXml(l.business_name)}</BusinessName>
        <UTR>${l.utr ?? ''}</UTR>
        <NINO>${l.ni_number ?? ''}</NINO>
        <VerificationNumber>${l.verification_number ?? ''}</VerificationNumber>
        <TotalPayments>${Number(l.gross_amount).toFixed(2)}</TotalPayments>
        <CostOfMaterials>${Number(l.materials_amount).toFixed(2)}</CostOfMaterials>
        <AmountDeducted>${Number(l.deduction_amount).toFixed(2)}</AmountDeducted>
      </Subcontractor>`,
    )
    .join('')

  const isTest = env.HMRC_GATEWAY_TEST === '1'

  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CIS-CIS300-CIS</Class>
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
      <Key Type="TaxOfficeReference">${contractor.utr ?? ''}</Key>
    </Keys>
  </GovTalkDetails>
  <Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/CISreturn">
      <IRheader>
        <TaxMonth>${monthlyReturn.tax_month_start}</TaxMonth>
      </IRheader>
      <CIS300>
        <NilReturn>${monthlyReturn.nil_return ? 'yes' : 'no'}</NilReturn>
        <InactivityIndicator>${monthlyReturn.inactivity_indicator ? 'yes' : 'no'}</InactivityIndicator>
        ${subcontractorBlocks}
      </CIS300>
    </IRenvelope>
  </Body>
</GovTalkMessage>`
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
