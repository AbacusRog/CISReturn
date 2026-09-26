// Parses a GovTalk CIS300 Monthly Return XML file — the same envelope this
// app's own functions/api/cis-submit.ts builds, and the format HMRC accepts
// submissions in (confirmed against a real submitted example from a
// BrightPay/BrightCIS export). Used to import historical months that were
// filed before this app existed.

export interface ParsedCis300Subcontractor {
  name: string
  utr: string | null
  ninoOrCrn: string | null
  nino: string | null
  crn: string | null
  verificationNumber: string | null
  totalPayments: number
  costOfMaterials: number
  totalDeducted: number
}

export interface ParsedCis300Return {
  contractorUtr: string | null
  contractorAOref: string | null
  periodEnd: string // YYYY-MM-DD, the 5th of the tax month
  taxMonthStart: string // YYYY-MM-DD, the 6th of the previous month
  submittedAt: string | null
  subcontractors: ParsedCis300Subcontractor[]
}

function text(el: Element | null | undefined): string | null {
  const t = el?.textContent?.trim()
  return t ? t : null
}

function num(el: Element | null | undefined): number {
  const t = text(el)
  return t ? parseFloat(t) : 0
}

export function periodEndToTaxMonthStart(periodEnd: string): string {
  // periodEnd is always the 5th of a month; the tax month it closes began
  // on the 6th of the previous month. Built from local date parts (not
  // toISOString(), which converts to UTC and can shift a local midnight
  // back a day during British Summer Time) so this always lands on the 6th.
  const d = new Date(periodEnd + 'T00:00:00')
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 6)
  const year = start.getFullYear()
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const day = String(start.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Business names like "Smith & Sons" are valid in HMRC's own submitted
// files (and in a PDF printout of one), but a bare "&" isn't valid XML
// unless it's escaped as an entity. Escape any "&" that isn't already the
// start of a recognised entity reference before handing the text to the
// XML parser.
function escapeStrayAmpersands(xmlText: string): string {
  return xmlText.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
}

export function parseCis300Xml(xmlText: string): ParsedCis300Return {
  const doc = new DOMParser().parseFromString(escapeStrayAmpersands(xmlText), 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    const detail = parserError.textContent?.trim().split('\n')[0]
    throw new Error(`Could not parse this file as XML${detail ? `: ${detail}` : ''}`)
  }

  // Namespaces make querySelector awkward across browsers, so match by
  // local tag name instead.
  const byTag = (root: Element | Document, tag: string): Element[] =>
    Array.from(root.getElementsByTagName(tag))
  const firstByTag = (root: Element | Document, tag: string): Element | null =>
    byTag(root, tag)[0] ?? null

  const irEnvelope = firstByTag(doc, 'IRenvelope')
  if (!irEnvelope) {
    throw new Error('This does not look like a CIS300 GovTalk XML file (no IRenvelope found)')
  }

  const irHeader = firstByTag(irEnvelope, 'IRheader')
  const periodEnd = text(firstByTag(irHeader ?? irEnvelope, 'PeriodEnd'))
  if (!periodEnd) {
    throw new Error('No PeriodEnd found in this file')
  }

  const timestampEl = firstByTag(doc, 'Timestamp')
  const submittedAt = text(timestampEl)

  const cisReturn = firstByTag(irEnvelope, 'CISreturn')
  const contractorEl = cisReturn ? firstByTag(cisReturn, 'Contractor') : null
  const contractorUtr = contractorEl ? text(firstByTag(contractorEl, 'UTR')) : null
  const contractorAOref = contractorEl ? text(firstByTag(contractorEl, 'AOref')) : null

  const subcontractorEls = cisReturn ? byTag(cisReturn, 'Subcontractor') : []
  const subcontractors: ParsedCis300Subcontractor[] = subcontractorEls.map((subEl) => {
    const nameEl = firstByTag(subEl, 'Name')
    let name = ''
    if (nameEl) {
      const fores = byTag(nameEl, 'Fore').map((f) => text(f)).filter(Boolean)
      const sur = text(firstByTag(nameEl, 'Sur'))
      name = [...fores, sur].filter(Boolean).join(' ')
    }
    const tradingName = text(firstByTag(subEl, 'TradingName'))
    if (!name && tradingName) name = tradingName

    const nino = text(firstByTag(subEl, 'NINO'))
    const crn = text(firstByTag(subEl, 'CRN'))

    return {
      name: name || 'Unnamed subcontractor',
      utr: text(firstByTag(subEl, 'UTR')),
      nino,
      crn,
      ninoOrCrn: nino ?? crn,
      verificationNumber: text(firstByTag(subEl, 'VerificationNumber')),
      totalPayments: num(firstByTag(subEl, 'TotalPayments')),
      costOfMaterials: num(firstByTag(subEl, 'CostOfMaterials')),
      totalDeducted: num(firstByTag(subEl, 'TotalDeducted')),
    }
  })

  return {
    contractorUtr,
    contractorAOref,
    periodEnd,
    taxMonthStart: periodEndToTaxMonthStart(periodEnd),
    submittedAt,
    subcontractors: mergeDuplicateSubcontractors(subcontractors),
  }
}

// A single CIS300 return can list the same subcontractor more than once
// (the same UTR/NINO appearing under two lines, sometimes even with
// different names or verification numbers — HMRC's own systems key a
// subcontractor by UTR/NINO/CRN, not by name). Since each subcontractor can
// only have one payment per tax month here, merge same-identity lines by
// summing their figures rather than letting the second insert fail against
// that constraint.
function mergeDuplicateSubcontractors(
  subs: ParsedCis300Subcontractor[],
): ParsedCis300Subcontractor[] {
  const byKey = new Map<string, ParsedCis300Subcontractor>()
  const order: string[] = []
  for (const sub of subs) {
    const key = sub.utr ?? sub.nino ?? sub.crn ?? `name:${sub.name}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...sub })
      order.push(key)
    } else {
      existing.totalPayments += sub.totalPayments
      existing.costOfMaterials += sub.costOfMaterials
      existing.totalDeducted += sub.totalDeducted
      // Keep whichever line actually carries a verification number/name,
      // preferring the first one already stored.
      existing.verificationNumber = existing.verificationNumber ?? sub.verificationNumber
    }
  }
  return order.map((key) => byKey.get(key)!)
}

// HMRC's CIS300 doesn't transmit the deduction rate directly — it's implied
// by TotalPayments/CostOfMaterials/TotalDeducted. Derive the nearest of the
// three standard rates (0/20/30%) from the numbers actually submitted.
export function inferDeductionRate(sub: ParsedCis300Subcontractor): 0 | 20 | 30 {
  const taxable = sub.totalPayments - sub.costOfMaterials
  if (taxable <= 0 || sub.totalDeducted <= 0) return 0
  const impliedRate = (sub.totalDeducted / taxable) * 100
  const candidates: (0 | 20 | 30)[] = [0, 20, 30]
  return candidates.reduce((closest, rate) =>
    Math.abs(rate - impliedRate) < Math.abs(closest - impliedRate) ? rate : closest,
  )
}
