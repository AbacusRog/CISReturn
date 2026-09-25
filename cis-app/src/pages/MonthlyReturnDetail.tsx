import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MonthlyReturn, ReturnLine, Contractor, Payment, Subcontractor } from '../types/cis'
import { formatTaxMonthLabel } from '../utils/taxMonth'

export default function MonthlyReturnDetail() {
  const { returnId } = useParams<{ returnId: string }>()
  const [monthlyReturn, setMonthlyReturn] = useState<MonthlyReturn | null>(null)
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [inactivityIndicator, setInactivityIndicator] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    if (!returnId) return
    setLoading(true)
    const { data: ret } = await supabase
      .from('cis_monthly_returns')
      .select('*')
      .eq('id', returnId)
      .single()
    setMonthlyReturn(ret as MonthlyReturn)
    setInactivityIndicator(!!ret?.inactivity_indicator)

    if (ret) {
      const { data: c } = await supabase
        .from('cis_contractors')
        .select('*')
        .eq('id', ret.contractor_id)
        .single()
      setContractor(c as Contractor)

      const { data: existingLines } = await supabase
        .from('cis_return_lines')
        .select('*')
        .eq('monthly_return_id', ret.id)

      if (existingLines && existingLines.length > 0) {
        setLines(existingLines as ReturnLine[])
      } else if (ret.status === 'draft') {
        // Build lines from finalised payments for this tax month, not yet persisted
        const { data: payments } = await supabase
          .from('cis_payments')
          .select('*, subcontractor:cis_subcontractors(*)')
          .eq('contractor_id', ret.contractor_id)
          .eq('tax_month_start', ret.tax_month_start)
          .eq('finalised', true)

        const built = ((payments as unknown as (Payment & { subcontractor: Subcontractor })[]) ?? []).map(
          (p) => ({
            id: `draft-${p.id}`,
            monthly_return_id: ret.id,
            payment_id: p.id,
            subcontractor_id: p.subcontractor_id,
            business_name: p.subcontractor.business_name,
            utr: p.subcontractor.utr,
            ni_number: p.subcontractor.ni_number,
            verification_number: p.subcontractor.verification_number,
            gross_amount: p.gross_amount,
            materials_amount: p.materials_amount,
            deduction_rate: p.deduction_rate,
            deduction_amount: p.deduction_amount,
          }),
        )
        setLines(built as ReturnLine[])
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId])

  const handleMarkReady = async () => {
    if (!monthlyReturn) return
    // Persist the return lines as a snapshot before marking ready
    const draftLines = lines.filter((l) => l.id.startsWith('draft-'))
    if (draftLines.length > 0) {
      await supabase.from('cis_return_lines').insert(
        draftLines.map((l) => ({
          monthly_return_id: monthlyReturn.id,
          payment_id: l.payment_id,
          subcontractor_id: l.subcontractor_id,
          business_name: l.business_name,
          utr: l.utr,
          ni_number: l.ni_number,
          verification_number: l.verification_number,
          gross_amount: l.gross_amount,
          materials_amount: l.materials_amount,
          deduction_rate: l.deduction_rate,
          deduction_amount: l.deduction_amount,
        })),
      )
    }
    await supabase
      .from('cis_monthly_returns')
      .update({ status: 'ready', inactivity_indicator: inactivityIndicator })
      .eq('id', monthlyReturn.id)
    load()
  }

  const handleReopen = async () => {
    if (!monthlyReturn) return
    const alreadySubmitted = monthlyReturn.status === 'submitted' || monthlyReturn.status === 'accepted'
    if (
      !confirm(
        alreadySubmitted
          ? 'This return was already submitted to HMRC. Reopening it here only resets its status in this app — it does NOT withdraw or amend anything HMRC has received. Continue?'
          : 'Reopen this return to draft? You can then reopen individual payments and rebuild it.',
      )
    )
      return

    // Drop the persisted line snapshot so it's rebuilt fresh from payments once finalised again
    await supabase.from('cis_return_lines').delete().eq('monthly_return_id', monthlyReturn.id)
    await supabase
      .from('cis_monthly_returns')
      .update({
        status: 'draft',
        submitted_at: null,
        correlation_id: null,
        hmrc_response: null,
      })
      .eq('id', monthlyReturn.id)
    setMessage('Return reopened — go back to Payments to make changes, then rebuild it.')
    load()
  }

  const handleSubmit = async () => {
    if (!monthlyReturn) return
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/cis-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyReturnId: monthlyReturn.id }),
      })
      const result = await res.json()
      if (res.ok) {
        await supabase
          .from('cis_monthly_returns')
          .update({
            status: result.status ?? 'submitted',
            submitted_at: new Date().toISOString(),
            correlation_id: result.correlationId ?? null,
            hmrc_response: result,
          })
          .eq('id', monthlyReturn.id)
        setMessage('Submitted to HMRC.')
        load()
      } else {
        setMessage(`Submission failed: ${result.error ?? 'unknown error'}`)
      }
    } catch (err) {
      setMessage(
        'Could not reach the HMRC submission service. It needs deploying with your agent credentials before returns can actually be sent — see functions/api/cis-submit.ts.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !monthlyReturn) return <div className="p-4 text-sm text-slate-400">Loading…</div>

  const totals = lines.reduce(
    (acc, l) => ({
      gross: acc.gross + Number(l.gross_amount),
      materials: acc.materials + Number(l.materials_amount),
      deduction: acc.deduction + Number(l.deduction_amount),
    }),
    { gross: 0, materials: 0, deduction: 0 },
  )

  return (
    <div>
      <Link to="/returns" className="text-xs text-slate-400 hover:text-slate-600">
        ← All returns
      </Link>
      <h1 className="text-lg font-semibold text-slate-900 mt-1 mb-1">
        {contractor?.name} — {formatTaxMonthLabel(new Date(monthlyReturn.tax_month_start))}
      </h1>
      <div className="text-xs text-slate-400 mb-4">
        Status: {monthlyReturn.status}
        {monthlyReturn.nil_return ? ' · Nil return' : ''}
        {monthlyReturn.is_sandbox ? ' · Sandbox' : ' · Live'}
      </div>

      {monthlyReturn.nil_return ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-4">
          No finalised payments were found for this tax month. This will be submitted as a nil
          return.
        </div>
      ) : (
        <table className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden text-sm mb-4">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Subcontractor</th>
              <th className="px-4 py-2">UTR</th>
              <th className="px-4 py-2">Gross (£)</th>
              <th className="px-4 py-2">Materials (£)</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Deduction (£)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 font-medium text-slate-900">{l.business_name}</td>
                <td className="px-4 py-2 text-slate-600">{l.utr || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{Number(l.gross_amount).toFixed(2)}</td>
                <td className="px-4 py-2 text-slate-600">{Number(l.materials_amount).toFixed(2)}</td>
                <td className="px-4 py-2 text-slate-600">{l.deduction_rate}%</td>
                <td className="px-4 py-2 text-slate-600">{Number(l.deduction_amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-sm font-medium">
            <tr>
              <td className="px-4 py-2" colSpan={2}>
                Totals
              </td>
              <td className="px-4 py-2">{totals.gross.toFixed(2)}</td>
              <td className="px-4 py-2">{totals.materials.toFixed(2)}</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2">{totals.deduction.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      {monthlyReturn.nil_return && monthlyReturn.status === 'draft' && (
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input
            type="checkbox"
            checked={inactivityIndicator}
            onChange={(e) => setInactivityIndicator(e.target.checked)}
          />
          No payments expected for up to 6 months (inactivity indicator)
        </label>
      )}

      {message && (
        <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4">
          {message}
        </div>
      )}

      <div className="flex gap-3">
        {monthlyReturn.status === 'draft' && (
          <button
            onClick={handleMarkReady}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800"
          >
            Mark ready for submission
          </button>
        )}
        {monthlyReturn.status === 'ready' && (
          <>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit to HMRC (sandbox)'}
            </button>
            <button
              onClick={handleReopen}
              className="text-sm text-slate-500 hover:text-slate-800 px-3 py-1.5"
            >
              Reopen to draft
            </button>
          </>
        )}
        {(monthlyReturn.status === 'submitted' || monthlyReturn.status === 'accepted' || monthlyReturn.status === 'rejected') && (
          <>
            <span className="text-sm text-slate-500">
              {monthlyReturn.status === 'rejected' ? 'Rejected' : 'Submitted'}
              {monthlyReturn.submitted_at ? ` ${new Date(monthlyReturn.submitted_at).toLocaleString('en-GB')}` : ''}
              {monthlyReturn.correlation_id ? ` · Correlation ID: ${monthlyReturn.correlation_id}` : ''}
            </span>
            <button
              onClick={handleReopen}
              className="text-sm text-slate-500 hover:text-slate-800 px-3 py-1.5"
            >
              Reopen to draft
            </button>
          </>
        )}
      </div>
    </div>
  )
}
