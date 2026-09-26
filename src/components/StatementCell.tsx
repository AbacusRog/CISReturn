import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Contractor, Payment, Subcontractor } from '../types/cis'
import { taxYearStart, toISODate } from '../utils/taxMonth'
import { loadContractorLogo } from '../utils/logo'
import { upsertStatement, sendStatementEmail } from '../utils/statements'

interface Props {
  contractor: Contractor
  subcontractor: Subcontractor
  payment: Payment
}

interface StatementRow {
  id: string
  pdf_path: string | null
  sent_at: string | null
}

export default function StatementCell({ contractor, subcontractor, payment }: Props) {
  const [statement, setStatement] = useState<StatementRow | null>(null)
  const [busy, setBusy] = useState<'generate' | 'send' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('cis_statements')
      .select('id, pdf_path, sent_at')
      .eq('payment_id', payment.id)
      .maybeSingle()
      .then(({ data }) => setStatement(data as StatementRow | null))
  }, [payment.id])

  const [justGenerated, setJustGenerated] = useState(false)

  const downloadBytes = (bytes: Uint8Array | ArrayBuffer, filename: string) => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleGenerate = async () => {
    setBusy('generate')
    setError(null)
    setJustGenerated(false)
    try {
      const yearStart = toISODate(taxYearStart(new Date(payment.tax_month_start)))
      const { data: yearPayments } = await supabase
        .from('cis_payments')
        .select('*')
        .eq('subcontractor_id', subcontractor.id)
        .eq('finalised', true)
        .gte('tax_month_start', yearStart)
        .lte('tax_month_start', payment.tax_month_start)
      const ytd = ((yearPayments as Payment[]) ?? []).reduce(
        (acc, p) => ({
          gross: acc.gross + Number(p.gross_amount),
          materials: acc.materials + Number(p.materials_amount),
          deduction: acc.deduction + Number(p.deduction_amount),
          vat: acc.vat + Number(p.vat_amount),
          net: acc.net + Number(p.net_amount),
        }),
        { gross: 0, materials: 0, deduction: 0, vat: 0, net: 0 },
      )
      const logo = await loadContractorLogo(contractor)
      const { id, pdf_path, pdfBytes } = await upsertStatement(contractor, subcontractor, payment, ytd, logo)
      setStatement({ id, pdf_path, sent_at: statement?.sent_at ?? null })

      // Download immediately so generating feels like it did something,
      // rather than just quietly flipping the buttons shown below.
      downloadBytes(pdfBytes, `${subcontractor.business_name} - ${payment.tax_month_start}.pdf`)
      setJustGenerated(true)
      setTimeout(() => setJustGenerated(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate statement')
    } finally {
      setBusy(null)
    }
  }

  const handleDownload = async () => {
    if (!statement?.pdf_path) return
    const { data, error: downloadError } = await supabase.storage
      .from('cis-statements')
      .download(statement.pdf_path)
    if (downloadError || !data) {
      setError('Could not download the PDF')
      return
    }
    downloadBytes(await data.arrayBuffer(), `${subcontractor.business_name} - ${payment.tax_month_start}.pdf`)
  }

  const handleEmail = async () => {
    if (!statement) return
    if (!subcontractor.email) {
      setError('No email address on file for this subcontractor')
      return
    }
    setBusy('send')
    setError(null)
    try {
      await sendStatementEmail(statement.id)
      setStatement({ ...statement, sent_at: new Date().toISOString() })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach the email service — has it been deployed with a Resend API key?',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      {error && <span className="text-xs text-red-500">{error}</span>}
      {justGenerated && <span className="text-xs text-green-600">Downloaded ✓</span>}
      {!statement?.pdf_path ? (
        <button
          onClick={handleGenerate}
          disabled={busy !== null}
          className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          {busy === 'generate' ? 'Generating…' : 'Generate statement'}
        </button>
      ) : (
        <>
          <button onClick={handleDownload} className="text-xs text-slate-500 hover:text-slate-800">
            Download
          </button>
          {statement.sent_at ? (
            <span className="text-xs text-green-600">Sent</span>
          ) : (
            <button
              onClick={handleEmail}
              disabled={busy !== null}
              className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              {busy === 'send' ? 'Sending…' : 'Email'}
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={busy !== null}
            className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            Regenerate
          </button>
        </>
      )}
    </div>
  )
}
