import { useEffect, useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Contractor } from '../types/cis'

export default function Contractors() {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [utr, setUtr] = useState('')
  const [aoRef, setAoRef] = useState('')
  const [payeRef, setPayeRef] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cis_contractors')
      .select('*')
      .order('name', { ascending: true })
    setContractors((data as Contractor[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('cis_contractors').insert({
      name,
      utr: utr || null,
      accounts_office_reference: aoRef || null,
      employer_paye_reference: payeRef || null,
    })
    setSaving(false)
    if (!error) {
      setName('')
      setUtr('')
      setAoRef('')
      setPayeRef('')
      setShowForm(false)
      load()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Contractor clients</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add contractor'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-slate-200 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Contractor name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">UTR</label>
            <input
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Accounts Office reference
            </label>
            <input
              value={aoRef}
              onChange={(e) => setAoRef(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Employer PAYE reference
            </label>
            <input
              value={payeRef}
              onChange={(e) => setPayeRef(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save contractor'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : contractors.length === 0 ? (
        <div className="text-sm text-slate-400">No contractors yet.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {contractors.map((c) => (
            <Link
              key={c.id}
              to={`/contractors/${c.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <div>
                <div className="text-sm font-medium text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-400">
                  {c.utr ? `UTR ${c.utr}` : 'No UTR set'}
                  {c.employer_paye_reference ? ` · PAYE ${c.employer_paye_reference}` : ''}
                </div>
              </div>
              <span className="text-xs text-slate-400">View →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
