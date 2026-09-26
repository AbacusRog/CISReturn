import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Contractor } from '../types/cis'
import SubcontractorsTab from '../components/SubcontractorsTab'
import PaymentsTab from '../components/PaymentsTab'
import ImportXmlTab from '../components/ImportXmlTab'
import ReturnsTab from '../components/ReturnsTab'

type Tab = 'subcontractors' | 'payments' | 'returns' | 'import'

export default function ContractorDetail() {
  const { contractorId } = useParams<{ contractorId: string }>()
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [tab, setTab] = useState<Tab>('subcontractors')

  useEffect(() => {
    if (!contractorId) return
    supabase
      .from('cis_contractors')
      .select('*')
      .eq('id', contractorId)
      .single()
      .then(({ data }) => setContractor(data as Contractor))
  }, [contractorId])

  if (!contractorId) return null

  return (
    <div>
      <Link to="/" className="text-xs text-slate-400 hover:text-slate-600">
        ← All contractors
      </Link>
      <h1 className="text-lg font-semibold text-slate-900 mt-1 mb-4">
        {contractor?.name ?? 'Loading…'}
      </h1>

      <div className="flex gap-4 border-b border-slate-200 mb-4">
        <button
          onClick={() => setTab('subcontractors')}
          className={`text-sm pb-2 border-b-2 -mb-px ${
            tab === 'subcontractors'
              ? 'border-slate-900 text-slate-900 font-medium'
              : 'border-transparent text-slate-500'
          }`}
        >
          Subcontractors
        </button>
        <button
          onClick={() => setTab('payments')}
          className={`text-sm pb-2 border-b-2 -mb-px ${
            tab === 'payments'
              ? 'border-slate-900 text-slate-900 font-medium'
              : 'border-transparent text-slate-500'
          }`}
        >
          Payments
        </button>
        <button
          onClick={() => setTab('returns')}
          className={`text-sm pb-2 border-b-2 -mb-px ${
            tab === 'returns'
              ? 'border-slate-900 text-slate-900 font-medium'
              : 'border-transparent text-slate-500'
          }`}
        >
          Returns
        </button>
        <button
          onClick={() => setTab('import')}
          className={`text-sm pb-2 border-b-2 -mb-px ${
            tab === 'import'
              ? 'border-slate-900 text-slate-900 font-medium'
              : 'border-transparent text-slate-500'
          }`}
        >
          Import from HMRC
        </button>
      </div>

      {tab === 'subcontractors' && <SubcontractorsTab contractorId={contractorId} />}
      {tab === 'payments' && <PaymentsTab contractorId={contractorId} />}
      {tab === 'returns' && <ReturnsTab contractorId={contractorId} />}
      {tab === 'import' && <ImportXmlTab contractorId={contractorId} contractor={contractor} />}
    </div>
  )
}
