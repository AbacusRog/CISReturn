import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Payment, Subcontractor } from '../types/cis'
import { calculateDeduction } from '../utils/cisCalc'
import { currentTaxMonthStart, formatTaxMonthLabel, toISODate, previousTaxMonths } from '../utils/taxMonth'

export default function PaymentsTab({ contractorId }: { contractorId: string }) {
  const navigate = useNavigate()
  const months = previousTaxMonths(6)
  const [selectedMonth, setSelectedMonth] = useState(toISODate(currentTaxMonthStart()))
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [payments, setPayments] = useState<Record<string, Payment>>({})
  const [draft, setDraft] = useState<Record<string, { gross: string; materials: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
    setSubcontractors((subs as Subcontractor[]) ?? [])
    const map: Record<string, Payment> = {}
    for (const p of (pays as Payment[]) ?? []) map[p.subcontractor_id] = p
    setPayments(map)
    const nextDraft: Record<string, { gross: string; materials: string }> = {}
    for (const s of (subs as Subcontractor[]) ?? []) {
      const existing = map[s.id]
      nextDraft[s.id] = {
        gross: existing ? String(existing.gross_amount) : '',
        materials: existing ? String(existing.materials_amount) : '',
      }
    }
    setDraft(nextDraft)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractorId, selectedMonth])

  const handleSaveRow = async (subcontractor: Subcontractor) => {
    const row = draft[subcontractor.id]
    const gross = parseFloat(row?.gross || '0') || 0
    const materials = parseFloat(row?.materials || '0') || 0
    const { deductionAmount, netAmount } = calculateDeduction(
      gross,
      materials,
      subcontractor.deduction_rate,
    )
    const existing = payments[subcontractor.id]
    const payload = {
      contractor_id: contractorId,
      subcontractor_id: subcontractor.id,
      tax_month_start: selectedMonth,
      gross_amount: gross,
      materials_amount: materials,
      deduction_rate: subcontractor.deduction_rate,
      deduction_amount: deductionAmount,
      net_amount: netAmount,
    }
    if (existing) {
      await supabase.from('cis_payments').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('cis_payments').insert(payload)
    }
    load()
  }

  const finalisedCount = Object.values(payments).filter((p) => p.finalised).length
  const totalPayable = subcontractors.reduce((sum, s) => {
    const row = draft[s.id]
    return sum + (parseFloat(row?.gross || '0') || 0)
  }, 0)

  const handleCreateReturn = async () => {
    setSaving(true)
    // Finalise any payments with amounts entered for this month
    const toFinalise = subcontractors.filter((s) => {
      const row = draft[s.id]
      return (parseFloat(row?.gross || '0') || 0) > 0
    })
    for (const s of toFinalise) {
      const existing = payments[s.id]
      if (existing && !existing.finalised) {
        await supabase
          .from('cis_payments')
          .update({ finalised: true, finalised_at: new Date().toISOString() })
          .eq('id', existing.id)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
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
        <button
          onClick={handleCreateReturn}
          disabled={saving || loading}
          className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Preparing…' : 'Build monthly return →'}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : subcontractors.length === 0 ? (
        <div className="text-sm text-slate-400">
          Add subcontractors first before entering payments.
        </div>
      ) : (
        <table className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Subcontractor</th>
              <th className="px-4 py-2">Gross (£)</th>
              <th className="px-4 py-2">Materials (£)</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Deduction (£)</th>
              <th className="px-4 py-2">Net (£)</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subcontractors.map((s) => {
              const row = draft[s.id] ?? { gross: '', materials: '' }
              const gross = parseFloat(row.gross || '0') || 0
              const materials = parseFloat(row.materials || '0') || 0
              const { deductionAmount, netAmount } = calculateDeduction(
                gross,
                materials,
                s.deduction_rate,
              )
              const finalised = payments[s.id]?.finalised
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{s.business_name}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      disabled={finalised}
                      value={row.gross}
                      onChange={(e) =>
                        setDraft({ ...draft, [s.id]: { ...row, gross: e.target.value } })
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                    />
                  </td>
                  <td className="px-4 py-2">
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
                  </td>
                  <td className="px-4 py-2 text-slate-600">{s.deduction_rate}%</td>
                  <td className="px-4 py-2 text-slate-600">{deductionAmount.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-900 font-medium">{netAmount.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    {finalised ? (
                      <span className="text-xs text-green-600">Finalised</span>
                    ) : (
                      <button
                        onClick={() => handleSaveRow(s)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                      >
                        Save
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="mt-3 text-xs text-slate-400">
        {finalisedCount} of {subcontractors.length} finalised for this month · Total gross £
        {totalPayable.toFixed(2)}
      </div>
    </div>
  )
}
