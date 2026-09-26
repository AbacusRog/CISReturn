import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MonthlyReturn } from '../types/cis'
import { formatTaxMonthLabel, taxMonthDueDate } from '../utils/taxMonth'

export default function ReturnsTab({ contractorId }: { contractorId: string }) {
  const [returns, setReturns] = useState<MonthlyReturn[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('cis_monthly_returns')
      .select('*')
      .eq('contractor_id', contractorId)
      .order('tax_month_start', { ascending: false })
      .then(({ data }) => {
        setReturns((data as MonthlyReturn[]) ?? [])
        setLoading(false)
      })
  }, [contractorId])

  if (loading) return <div className="text-sm text-slate-400">Loading…</div>

  if (returns.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        No returns yet for this contractor. Build one from the Payments tab, or bring in past ones
        from Import from HMRC.
      </div>
    )
  }

  return (
    <table className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500 text-left">
        <tr>
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
              <td className="px-4 py-2 font-medium text-slate-900">
                {formatTaxMonthLabel(monthStart)}
              </td>
              <td className="px-4 py-2 text-slate-600">
                {taxMonthDueDate(monthStart).toLocaleDateString('en-GB')}
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={r.status} nil={r.nil_return} filedExternally={r.filed_externally} />
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
  )
}

function StatusBadge({
  status,
  nil: isNil,
  filedExternally,
}: {
  status: MonthlyReturn['status']
  nil: boolean
  filedExternally: boolean
}) {
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
    submitted: filedExternally ? 'Filed elsewhere' : 'Submitted',
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
