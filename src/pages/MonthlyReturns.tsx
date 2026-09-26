import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MonthlyReturn, Contractor } from '../types/cis'
import { formatTaxMonthLabel, taxMonthDueDate } from '../utils/taxMonth'

interface ReturnRow extends MonthlyReturn {
  contractor: Contractor
}

export default function MonthlyReturns() {
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('cis_monthly_returns')
      .select('*, contractor:cis_contractors(*)')
      .order('tax_month_start', { ascending: false })
      .then(({ data }) => {
        setReturns((data as unknown as ReturnRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-4">Monthly returns</h1>
      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : returns.length === 0 ? (
        <div className="text-sm text-slate-400">
          No returns yet. Build one from a contractor's Payments tab.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        <table className="w-full min-w-[560px] bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Contractor</th>
              <th className="px-4 py-2">Tax month</th>
              <th className="px-4 py-2">Due by</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returns.map((r) => {
              const monthStart = new Date(r.tax_month_start)
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{r.contractor?.name}</td>
                  <td className="px-4 py-2 text-slate-600">{formatTaxMonthLabel(monthStart)}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {taxMonthDueDate(monthStart).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} nil={r.nil_return} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link to={`/returns/${r.id}`} className="text-xs text-slate-500 hover:text-slate-800">
                      Open →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, nil: isNil }: { status: MonthlyReturn['status']; nil: boolean }) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-500',
    ready: 'bg-amber-50 text-amber-700',
    submitted: 'bg-blue-50 text-blue-700',
    accepted: 'bg-green-50 text-green-700',
    rejected: 'bg-red-50 text-red-700',
  }
  const labels: Record<string, string> = {
    draft: 'Draft',
    ready: 'Ready',
    submitted: 'Submitted',
    accepted: 'Accepted',
    rejected: 'Rejected',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
      {isNil ? ' · Nil' : ''}
    </span>
  )
}
