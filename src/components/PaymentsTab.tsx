import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Contractor, Payment, Subcontractor } from '../types/cis'
import { calculatePayment } from '../utils/cisCalc'
import {
  currentTaxMonthStart,
  formatTaxMonthLabel,
  taxMonthEnd,
  toISODate,
  taxYearStart,
  taxYearMonths,
  taxYearLabel,
  recentTaxYearStarts,
} from '../utils/taxMonth'
import StatementCell from './StatementCell'
import { loadContractorLogo } from '../utils/logo'
import { upsertStatement, sendStatementEmail } from '../utils/statements'
import { buildYearStatementsZip } from '../utils/bulkStatements'
import { describeError } from '../utils/errors'

interface DraftRow {
  basicPay: string
  materials: string
  materialsOnTop: boolean
  vat: string
}

const emptyDraftRow: DraftRow = { basicPay: '', materials: '', materialsOnTop: true, vat: '' }

interface YtdTotals {
  gross: number
  materials: number
  deduction: number
  vat: number
  net: number
}

export default function PaymentsTab({ contractorId }: { contractorId: string }) {
  const navigate = useNavigate()
  const currentTaxYear = taxYearStart(currentTaxMonthStart())
  const taxYearOptions = recentTaxYearStarts(6)
  const [selectedTaxYear, setSelectedTaxYear] = useState(toISODate(currentTaxYear))
  const months = taxYearMonths(new Date(selectedTaxYear))
  const [selectedMonth, setSelectedMonth] = useState(toISODate(currentTaxMonthStart()))
  const [view, setView] = useState<'period' | 'ytd'>('period')
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [payments, setPayments] = useState<Record<string, Payment>>({})
  const [draft, setDraft] = useState<Record<string, DraftRow>>({})
  const [ytdTotals, setYtdTotals] = useState<Record<string, YtdTotals>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('cis_contractors')
      .select('*')
      .eq('id', contractorId)
      .single()
      .then(({ data }) => setContractor(data as Contractor))
  }, [contractorId])

  // Keep the month selector inside whichever tax year is picked — jump to
  // that year's first month unless the currently selected month already
  // falls within it (e.g. switching years while browsing the same slot).
  useEffect(() => {
    const monthsInYear = taxYearMonths(new Date(selectedTaxYear)).map(toISODate)
    if (!monthsInYear.includes(selectedMonth)) {
      setSelectedMonth(monthsInYear[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaxYear])

  const load = async () => {
    setLoading(true)
    const [{ data: subs }, { data: pays }] = await Promise.all([
      supabase
        .from('cis_subcontractors')
        .select('*')
        .eq('contractor_id', contractorId)
        .eq('active', true)
        .order('business_name'),
      supabase
        .from('cis_payments')
        .select('*')
        .eq('contractor_id', contractorId)
        .eq('tax_month_start', selectedMonth),
    ])
    // Exclude subcontractors who hadn't started yet as of this tax month,
    // so they don't get a payment row (and so don't end up in the monthly
    // return) for periods before they actually began work.
    const monthEnd = toISODate(taxMonthEnd(new Date(selectedMonth)))
    const eligibleSubs = ((subs as Subcontractor[]) ?? []).filter(
      (s) => !s.start_date || s.start_date <= monthEnd,
    )
    setSubcontractors(eligibleSubs)
    const map: Record<string, Payment> = {}
    for (const p of (pays as Payment[]) ?? []) map[p.subcontractor_id] = p
    setPayments(map)
    const nextDraft: Record<string, DraftRow> = {}
    for (const s of eligibleSubs) {
      const existing = map[s.id]
      nextDraft[s.id] = existing
        ? {
            basicPay: String(existing.basic_pay),
            materials: String(existing.materials_amount),
            materialsOnTop: existing.materials_on_top,
            vat: String(existing.vat_amount),
          }
        : { ...emptyDraftRow }
    }
    setDraft(nextDraft)
    setLoading(false)

    // Year-to-date sums, computed from all finalised payments in the tax
    // year containing the selected month, up to and including that month.
    const yearStart = toISODate(taxYearStart(new Date(selectedMonth)))
    const { data: yearPayments } = await supabase
      .from('cis_payments')
      .select('*')
      .eq('contractor_id', contractorId)
      .eq('finalised', true)
      .gte('tax_month_start', yearStart)
      .lte('tax_month_start', selectedMonth)
    const totals: Record<string, YtdTotals> = {}
    for (const p of (yearPayments as Payment[]) ?? []) {
      const t = totals[p.subcontractor_id] ?? { gross: 0, materials: 0, deduction: 0, vat: 0, net: 0 }
      t.gross += Number(p.gross_amount)
      t.materials += Number(p.materials_amount)
      t.deduction += Number(p.deduction_amount)
      t.vat += Number(p.vat_amount)
      t.net += Number(p.net_amount)
      totals[p.subcontractor_id] = t
    }
    setYtdTotals(totals)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractorId, selectedMonth])

  const calcFor = (s: Subcontractor, row: DraftRow) =>
    calculatePayment({
      basicPay: parseFloat(row.basicPay || '0') || 0,
      materialsAmount: parseFloat(row.materials || '0') || 0,
      materialsOnTop: row.materialsOnTop,
      vatAmount: s.vat_registered ? parseFloat(row.vat || '0') || 0 : 0,
      deductionRate: s.deduction_rate,
    })

  const buildPaymentPayload = (subcontractor: Subcontractor, row: DraftRow) => {
    const { totalGross, deductionAmount, netAmount } = calcFor(subcontractor, row)
    return {
      contractor_id: contractorId,
      subcontractor_id: subcontractor.id,
      tax_month_start: selectedMonth,
      basic_pay: parseFloat(row.basicPay || '0') || 0,
      materials_amount: parseFloat(row.materials || '0') || 0,
      materials_on_top: row.materialsOnTop,
      vat_amount: subcontractor.vat_registered ? parseFloat(row.vat || '0') || 0 : 0,
      gross_amount: totalGross,
      deduction_rate: subcontractor.deduction_rate,
      deduction_amount: deductionAmount,
      net_amount: netAmount,
    }
  }

  const [savedId, setSavedId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState<'download' | 'email' | null>(null)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [statementRefreshToken, setStatementRefreshToken] = useState(0)

  const handleSaveRow = async (subcontractor: Subcontractor) => {
    const row = draft[subcontractor.id] ?? emptyDraftRow
    const existing = payments[subcontractor.id]
    const payload = buildPaymentPayload(subcontractor, row)
    if (existing) {
      await supabase.from('cis_payments').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('cis_payments').insert(payload)
    }
    setSavedId(subcontractor.id)
    setTimeout(() => setSavedId((id) => (id === subcontractor.id ? null : id)), 2000)
    load()
  }

  const handleReopenPayment = async (subcontractor: Subcontractor) => {
    const existing = payments[subcontractor.id]
    if (!existing) return
    if (
      !confirm(
        `Reopen ${subcontractor.business_name}'s payment for this month? If a monthly return has already been built from it, you'll need to rebuild the return afterwards.`,
      )
    )
      return
    await supabase
      .from('cis_payments')
      .update({ finalised: false, finalised_at: null })
      .eq('id', existing.id)
    load()
  }

  const finalisedCount = Object.values(payments).filter((p) => p.finalised).length
  const totalPayable = subcontractors.reduce((sum, s) => {
    const row = draft[s.id]
    if (!row) return sum
    return sum + calcFor(s, row).totalGross
  }, 0)

  const periodColumnTotals = subcontractors.reduce(
    (acc, s) => {
      const row = draft[s.id] ?? emptyDraftRow
      const { deductionAmount, netAmount } = calcFor(s, row)
      acc.basicPay += parseFloat(row.basicPay || '0') || 0
      acc.materials += parseFloat(row.materials || '0') || 0
      acc.vat += s.vat_registered ? parseFloat(row.vat || '0') || 0 : 0
      acc.deduction += deductionAmount
      acc.net += netAmount
      return acc
    },
    { basicPay: 0, materials: 0, vat: 0, deduction: 0, net: 0 },
  )

  const ytdColumnTotals = subcontractors.reduce(
    (acc, s) => {
      const t = ytdTotals[s.id]
      if (t) {
        acc.gross += t.gross
        acc.materials += t.materials
        acc.deduction += t.deduction
        acc.vat += t.vat
        acc.net += t.net
      }
      return acc
    },
    { gross: 0, materials: 0, deduction: 0, vat: 0, net: 0 },
  )

  const handleCreateReturn = async () => {
    setSaving(true)
    // Save (or create) and finalise every row with an amount entered this
    // month — including ones never explicitly clicked "Save" — so nothing
    // typed in gets silently left out of the return.
    const toFinalise = subcontractors.filter((s) => {
      const row = draft[s.id]
      return row && calcFor(s, row).totalGross > 0
    })
    for (const s of toFinalise) {
      const row = draft[s.id] ?? emptyDraftRow
      const existing = payments[s.id]
      const payload = { ...buildPaymentPayload(s, row), finalised: true, finalised_at: new Date().toISOString() }
      if (existing) {
        if (!existing.finalised) {
          await supabase.from('cis_payments').update(payload).eq('id', existing.id)
        }
      } else {
        await supabase.from('cis_payments').insert(payload)
      }
    }

    const nilReturn = toFinalise.length === 0

    const { data: existingReturn } = await supabase
      .from('cis_monthly_returns')
      .select('*')
      .eq('contractor_id', contractorId)
      .eq('tax_month_start', selectedMonth)
      .maybeSingle()

    let returnId = existingReturn?.id
    if (!returnId) {
      const { data: created, error } = await supabase
        .from('cis_monthly_returns')
        .insert({
          contractor_id: contractorId,
          tax_month_start: selectedMonth,
          nil_return: nilReturn,
          status: 'draft',
        })
        .select()
        .single()
      if (error) {
        setSaving(false)
        alert(error.message)
        return
      }
      returnId = created.id
    }

    setSaving(false)
    navigate(`/returns/${returnId}`)
  }

  const handleDownloadAllStatements = async () => {
    if (!contractor) return
    setBulkBusy('download')
    setBulkMessage(null)
    try {
      const { bytes, filename } = await buildYearStatementsZip(contractor, new Date(selectedTaxYear))
      const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setBulkMessage(describeError(err))
    } finally {
      setBulkBusy(null)
    }
  }

  const handleEmailAll = async () => {
    if (!contractor) return
    setBulkBusy('email')
    setBulkMessage(null)
    try {
      const logo = await loadContractorLogo(contractor)
      const targets = subcontractors.filter((s) => payments[s.id]?.finalised)
      let sent = 0
      let skipped = 0
      const failed: string[] = []
      for (const s of targets) {
        if (!s.email) {
          skipped++
          continue
        }
        try {
          const paymentRow = payments[s.id]
          const ytd = ytdTotals[s.id]
          const { id } = await upsertStatement(contractor, s, paymentRow, ytd, logo)
          await sendStatementEmail(id)
          sent++
        } catch (err) {
          failed.push(`${s.business_name}: ${describeError(err)}`)
        }
      }
      setBulkMessage(
        `Emailed ${sent} statement${sent === 1 ? '' : 's'}` +
          (skipped ? ` · skipped ${skipped} with no email on file` : '') +
          (failed.length ? ` · failed: ${failed.join('; ')}` : ''),
      )
      setStatementRefreshToken((t) => t + 1)
    } catch (err) {
      setBulkMessage(describeError(err))
    } finally {
      setBulkBusy(null)
    }
  }

  // Show subcontractors with something to review first — paid this period
  // (or, in the year-to-date view, paid this year) — then everyone else
  // alphabetically, so a filed month's sheet doesn't bury the people who
  // were actually paid among a long list of zero rows.
  const sortedForPeriod = [...subcontractors].sort((a, b) => {
    const aPaid = calcFor(a, draft[a.id] ?? emptyDraftRow).totalGross > 0
    const bPaid = calcFor(b, draft[b.id] ?? emptyDraftRow).totalGross > 0
    if (aPaid !== bPaid) return aPaid ? -1 : 1
    return a.business_name.localeCompare(b.business_name)
  })

  const sortedForYtd = [...subcontractors].sort((a, b) => {
    const aPaid = (ytdTotals[a.id]?.gross ?? 0) > 0
    const bPaid = (ytdTotals[b.id]?.gross ?? 0) > 0
    if (aPaid !== bPaid) return aPaid ? -1 : 1
    return a.business_name.localeCompare(b.business_name)
  })

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={selectedTaxYear}
            onChange={(e) => setSelectedTaxYear(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {taxYearOptions.map((y) => (
              <option key={toISODate(y)} value={toISODate(y)}>
                Tax year {taxYearLabel(y)}
              </option>
            ))}
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {months.map((m) => (
              <option key={toISODate(m)} value={toISODate(m)}>
                {formatTaxMonthLabel(m)}
              </option>
            ))}
          </select>
          <div className="flex rounded border border-slate-300 overflow-hidden text-sm">
            <button
              onClick={() => setView('period')}
              className={`px-3 py-1.5 ${view === 'period' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
            >
              This period
            </button>
            <button
              onClick={() => setView('ytd')}
              className={`px-3 py-1.5 ${view === 'ytd' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
            >
              Year to date
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              onClick={handleDownloadAllStatements}
              disabled={bulkBusy !== null || loading}
              className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              {bulkBusy === 'download' ? 'Zipping…' : 'Download all statements (year)'}
            </button>
            <button
              onClick={handleEmailAll}
              disabled={bulkBusy !== null || loading || finalisedCount === 0}
              className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              {bulkBusy === 'email' ? 'Emailing…' : 'Email all (this period)'}
            </button>
          </div>
          <button
            onClick={handleCreateReturn}
            disabled={saving || loading}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50 w-full sm:w-auto"
          >
            {saving ? 'Preparing…' : 'Build monthly return →'}
          </button>
        </div>
      </div>

      {bulkMessage && (
        <div className="mb-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          {bulkMessage}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : subcontractors.length === 0 ? (
        <div className="text-sm text-slate-400">
          Add subcontractors first before entering payments.
        </div>
      ) : view === 'ytd' ? (
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        <table className="w-full min-w-[640px] bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Subcontractor</th>
              <th className="px-4 py-2">Gross (£)</th>
              <th className="px-4 py-2">Materials (£)</th>
              <th className="px-4 py-2">Deduction (£)</th>
              <th className="px-4 py-2">VAT (£)</th>
              <th className="px-4 py-2">Net (£)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedForYtd.map((s) => {
              const t = ytdTotals[s.id] ?? { gross: 0, materials: 0, deduction: 0, vat: 0, net: 0 }
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{s.business_name}</td>
                  <td className="px-4 py-2 text-slate-600">{t.gross.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-600">{t.materials.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-600">{t.deduction.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-600">{t.vat.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-900 font-medium">{t.net.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 font-medium text-slate-900 border-t border-slate-200">
            <tr>
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2">{ytdColumnTotals.gross.toFixed(2)}</td>
              <td className="px-4 py-2">{ytdColumnTotals.materials.toFixed(2)}</td>
              <td className="px-4 py-2">{ytdColumnTotals.deduction.toFixed(2)}</td>
              <td className="px-4 py-2">{ytdColumnTotals.vat.toFixed(2)}</td>
              <td className="px-4 py-2">{ytdColumnTotals.net.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        <table className="w-full min-w-[860px] bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Subcontractor</th>
              <th className="px-4 py-2">Basic pay (£)</th>
              <th className="px-4 py-2">Materials (£)</th>
              <th className="px-4 py-2">VAT (£)</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Deduction (£)</th>
              <th className="px-4 py-2">Net (£)</th>
              <th className="px-4 py-2"></th>
              <th className="px-4 py-2">Statement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedForPeriod.map((s) => {
              const row = draft[s.id] ?? emptyDraftRow
              const { deductionAmount, netAmount } = calcFor(s, row)
              const paymentRow = payments[s.id]
              const finalised = paymentRow?.finalised
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{s.business_name}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      disabled={finalised}
                      value={row.basicPay}
                      onChange={(e) =>
                        setDraft({ ...draft, [s.id]: { ...row, basicPay: e.target.value } })
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-1">
                      <input
                        type="number"
                        step="0.01"
                        disabled={finalised}
                        value={row.materials}
                        onChange={(e) =>
                          setDraft({ ...draft, [s.id]: { ...row, materials: e.target.value } })
                        }
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          disabled={finalised}
                          checked={row.materialsOnTop}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [s.id]: { ...row, materialsOnTop: e.target.checked },
                            })
                          }
                        />
                        Added to basic
                      </label>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {s.vat_registered ? (
                      <input
                        type="number"
                        step="0.01"
                        disabled={finalised}
                        value={row.vat}
                        onChange={(e) =>
                          setDraft({ ...draft, [s.id]: { ...row, vat: e.target.value } })
                        }
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                      />
                    ) : (
                      <span className="text-xs text-slate-300">Not VAT reg.</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{s.deduction_rate}%</td>
                  <td className="px-4 py-2 text-slate-600">{deductionAmount.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-900 font-medium">{netAmount.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    {finalised ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-green-600">Finalised</span>
                        <button
                          onClick={() => handleReopenPayment(s)}
                          className="text-xs text-slate-400 hover:text-slate-700"
                        >
                          Reopen
                        </button>
                      </span>
                    ) : savedId === s.id ? (
                      <span className="text-xs text-green-600">Saved ✓</span>
                    ) : (
                      <button
                        onClick={() => handleSaveRow(s)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                      >
                        Save
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {finalised && contractor && paymentRow ? (
                      <StatementCell
                        key={`${s.id}-${statementRefreshToken}`}
                        contractor={contractor}
                        subcontractor={s}
                        payment={paymentRow}
                      />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 font-medium text-slate-900 border-t border-slate-200">
            <tr>
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2">{periodColumnTotals.basicPay.toFixed(2)}</td>
              <td className="px-4 py-2">{periodColumnTotals.materials.toFixed(2)}</td>
              <td className="px-4 py-2">{periodColumnTotals.vat.toFixed(2)}</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2">{periodColumnTotals.deduction.toFixed(2)}</td>
              <td className="px-4 py-2">{periodColumnTotals.net.toFixed(2)}</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2"></td>
            </tr>
          </tfoot>
        </table>
        </div>
      )}

      {view === 'period' && (
        <div className="mt-3 text-xs text-slate-400">
          {finalisedCount} of {subcontractors.length} finalised for this month · Total gross £
          {totalPayable.toFixed(2)}
        </div>
      )}
    </div>
  )
}
