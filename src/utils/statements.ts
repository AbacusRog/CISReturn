import { supabase } from '../lib/supabase'
import type { Contractor, Subcontractor, Payment } from '../types/cis'
import { buildStatementPdf, type YtdTotals } from './statementPdf'
import type { LogoAsset } from './logo'

// Builds (or regenerates) the Payment & Deduction Statement PDF for a single
// payment, uploads it to Storage, and creates/updates its cis_statements
// row — the shared core used by both the single-row "Generate" button and
// the bulk "Email all" action, so the two stay in sync.
export async function upsertStatement(
  contractor: Contractor,
  subcontractor: Subcontractor,
  payment: Payment,
  ytd: YtdTotals | undefined,
  logo: LogoAsset | null,
): Promise<{ id: string; pdf_path: string; pdfBytes: Uint8Array }> {
  const path = `${contractor.id}/${subcontractor.id}/${payment.tax_month_start}.pdf`
  const pdfBytes = await buildStatementPdf(contractor, subcontractor, payment, ytd, logo)

  const { error: uploadError } = await supabase.storage
    .from('cis-statements')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw uploadError

  const { data: existing } = await supabase
    .from('cis_statements')
    .select('id')
    .eq('payment_id', payment.id)
    .maybeSingle()

  let id: string
  if (existing) {
    id = existing.id
    await supabase.from('cis_statements').update({ pdf_path: path }).eq('id', id)
  } else {
    const { data: created, error } = await supabase
      .from('cis_statements')
      .insert({ payment_id: payment.id, pdf_path: path })
      .select('id')
      .single()
    if (error) throw error
    id = created.id
  }

  return { id, pdf_path: path, pdfBytes }
}

export async function sendStatementEmail(statementId: string): Promise<void> {
  const res = await fetch('/api/send-statement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statementId }),
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error ?? 'Send failed')
  await supabase
    .from('cis_statements')
    .update({ sent_at: new Date().toISOString(), sent_method: 'email' })
    .eq('id', statementId)
}
