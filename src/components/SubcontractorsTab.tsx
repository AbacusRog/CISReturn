import { useEffect, useState, FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Subcontractor, SubcontractorType } from '../types/cis'

export default function SubcontractorsTab({ contractorId }: { contractorId: string }) {
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [form, setForm] = useState({
    subcontractor_type: 'sole_trader' as SubcontractorType,
    business_name: '',
    utr: '',
    ni_number: '',
    company_reg_number: '',
    email: '',
  })

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cis_subcontractors')
      .select('*')
      .eq('contractor_id', contractorId)
      .order('business_name')
    setSubcontractors((data as Subcontractor[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractorId])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('cis_subcontractors').insert({
      contractor_id: contractorId,
      subcontractor_type: form.subcontractor_type,
      business_name: form.business_name,
      utr: form.utr || null,
      ni_number: form.ni_number || null,
      company_reg_number: form.company_reg_number || null,
      email: form.email || null,
      deduction_rate: 30,
      verification_status: 'unverified',
    })
    if (!error) {
      setForm({
        subcontractor_type: 'sole_trader',
        business_name: '',
        utr: '',
        ni_number: '',
        company_reg_number: '',
        email: '',
      })
      setShowForm(false)
      load()
    }
  }

  // Verification against HMRC's CIS API happens server-side (the Cloudflare
  // Pages Function in functions/api/cis-verify.ts) because it needs the
  // agent's HMRC credentials, which must never reach the browser.
  const handleVerify = async (subcontractor: Subcontractor) => {
    setVerifying(subcontractor.id)
    try {
      const res = await fetch('/api/cis-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcontractorId: subcontractor.id, contractorId }),
      })
      const result = await res.json()
      if (res.ok) {
        await supabase
          .from('cis_subcontractors')
          .update({
            verification_status: result.status,
            verification_number: result.verificationNumber ?? null,
            deduction_rate: result.deductionRate,
            verified_at: new Date().toISOString(),
          })
          .eq('id', subcontractor.id)
        load()
      } else {
        alert(`Verification failed: ${result.error ?? 'unknown error'}`)
      }
    } catch (err) {
      alert('Could not reach the verification service. Is it deployed yet?')
    } finally {
      setVerifying(null)
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add subcontractor'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-2 gap-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <select
              value={form.subcontractor_type}
              onChange={(e) =>
                setForm({ ...form, subcontractor_type: e.target.value as SubcontractorType })
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="sole_trader">Sole trader</option>
              <option value="partnership">Partnership</option>
              <option value="company">Company</option>
              <option value="trust">Trust</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Business / trading name
            </label>
            <input
              required
              value={form.business_name}
              onChange={(e) => setForm({ ...form, business_name: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">UTR</label>
            <input
              value={form.utr}
              onChange={(e) => setForm({ ...form, utr: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">NI number</label>
            <input
              value={form.ni_number}
              onChange={(e) => setForm({ ...form, ni_number: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Company reg. number
            </label>
            <input
              value={form.company_reg_number}
              onChange={(e) => setForm({ ...form, company_reg_number: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800"
            >
              Save subcontractor
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : subcontractors.length === 0 ? (
        <div className="text-sm text-slate-400">No subcontractors yet.</div>
      ) : (
        <table className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">UTR / NI</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Verification</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subcontractors.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-900">{s.business_name}</div>
                  <div className="text-xs text-slate-400">{s.subcontractor_type}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{s.utr || s.ni_number || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{s.deduction_rate}%</td>
                <td className="px-4 py-2">
                  <StatusBadge status={s.verification_status} />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleVerify(s)}
                    disabled={verifying === s.id}
                    className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                  >
                    {verifying === s.id ? 'Verifying…' : 'Verify with HMRC'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: Subcontractor['verification_status'] }) {
  const styles: Record<string, string> = {
    unverified: 'bg-slate-100 text-slate-500',
    verified: 'bg-green-50 text-green-700',
    matched_higher_rate: 'bg-amber-50 text-amber-700',
    not_matched: 'bg-red-50 text-red-700',
  }
  const labels: Record<string, string> = {
    unverified: 'Not verified',
    verified: 'Verified',
    matched_higher_rate: 'Matched (higher rate)',
    not_matched: 'Not matched',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>{labels[status]}</span>
  )
}
