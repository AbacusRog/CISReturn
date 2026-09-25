import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Contractor, Payment, Subcontractor } from '../types/cis'
import { buildStatementPdf } from '../utils/statementPdf'

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

  const pdfPath = () =>
    `${contractor.id}/${subcontractor.id}/${payment.tax_month_start}.pdf`

  const handleGenerate = async () => {
    setBusy('generate')
    setError(null)
    try {
      const pdfBytes = await buildStatementPdf(contractor, subcontractor, payment)
      const path = pdfPath()
      const { error: uploadError } = await supabase.storage
        .from('cis-statements')
        .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
      if (uploadError) throw uploadError

      if (statement) {
        await supabase.from('cis_statements').update({ pdf_path: path }).eq('id', statement.id)
        setStatement({ ...statement, pdf_path: path })
      } else {
        const { data: created, error: insertError } = await supabase
          .from('cis_statements')
          .insert({ payment_id: payment.id, pdf_path: path })
          .select('id, pdf_path, sent_at')
          .single()
        if (insertError) throw insertError
        setStatement(created as StatementRow)
      }
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
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${subcontractor.business_name} - ${payment.tax_month_start}.pdf`
    a.click()
    URL.revokeObjectURL(url)
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
      const res = await fetch('/api/send-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId: statement.id }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Send failed')
      await supabase
        .from('cis_statements')
        .update({ sent_at: new Date().toISOString(), sent_method: 'email' })
        .eq('id', statement.id)
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
