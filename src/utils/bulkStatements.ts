import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '../lib/supabase'
import type { Contractor, Payment, Subcontractor } from '../types/cis'
import { buildStatementPdf, type YtdTotals } from './statementPdf'
import { loadContractorLogo } from './logo'
import { taxYearFileLabel, toISODate } from './taxMonth'

// Builds one combined PDF per subcontractor — every finalised month's
// Payment & Deduction Statement for the given tax year, in order, with a
// running year-to-date total on each page — and bundles them all into a
// single zip so they can be downloaded in one go. Filenames follow
// "<Subcontractor name> - 2026-2027.pdf" per the requested naming.
export async function buildYearStatementsZip(
  contractor: Contractor,
  yearStartDate: Date,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const yearStart = toISODate(yearStartDate)
  const yearEndExclusive = toISODate(
    new Date(yearStartDate.getFullYear() + 1, yearStartDate.getMonth(), yearStartDate.getDate()),
  )

  const { data, error } = await supabase
    .from('cis_payments')
    .select('*, subcontractor:cis_subcontractors(*)')
    .eq('contractor_id', contractor.id)
    .eq('finalised', true)
    .gte('tax_month_start', yearStart)
    .lt('tax_month_start', yearEndExclusive)
    .order('tax_month_start', { ascending: true })
  if (error) throw error

  const rows = (data as unknown as (Payment & { subcontractor: Subcontractor })[]) ?? []
  if (rows.length === 0) {
    throw new Error('No finalised payments were found for this tax year yet.')
  }

  const bySub = new Map<string, { subcontractor: Subcontractor; payments: Payment[] }>()
  for (const r of rows) {
    const entry = bySub.get(r.subcontractor_id) ?? { subcontractor: r.subcontractor, payments: [] }
    entry.payments.push(r)
    bySub.set(r.subcontractor_id, entry)
  }

  const logo = await loadContractorLogo(contractor)
  const fileLabel = taxYearFileLabel(yearStartDate)
  const zip = new JSZip()

  for (const { subcontractor, payments } of bySub.values()) {
    const merged = await PDFDocument.create()
    const running: YtdTotals = { gross: 0, materials: 0, deduction: 0, vat: 0, net: 0 }
    for (const p of payments) {
      running.gross += Number(p.gross_amount)
      running.materials += Number(p.materials_amount)
      running.deduction += Number(p.deduction_amount)
      running.vat += Number(p.vat_amount)
      running.net += Number(p.net_amount)

      const pageBytes = await buildStatementPdf(contractor, subcontractor, p, { ...running }, logo)
      const src = await PDFDocument.load(pageBytes)
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach((pg) => merged.addPage(pg))
    }
    const mergedBytes = await merged.save()
    const safeName = sanitizeFilename(subcontractor.business_name)
    zip.file(`${safeName} - ${fileLabel}.pdf`, mergedBytes)
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' })
  return {
    bytes: zipBytes,
    filename: `Statements ${fileLabel} - ${sanitizeFilename(contractor.name)}.zip`,
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}
