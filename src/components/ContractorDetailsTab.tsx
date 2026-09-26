import { useEffect, useRef, useState, FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Contractor } from '../types/cis'

interface Props {
  contractor: Contractor | null
  onSaved: () => void
}

export default function ContractorDetailsTab({ contractor, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '',
    utr: '',
    accounts_office_reference: '',
    employer_paye_reference: '',
    address_line1: '',
    address_line2: '',
    town: '',
    postcode: '',
    contact_name: '',
    contact_email: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!contractor) return
    setForm({
      name: contractor.name ?? '',
      utr: contractor.utr ?? '',
      accounts_office_reference: contractor.accounts_office_reference ?? '',
      employer_paye_reference: contractor.employer_paye_reference ?? '',
      address_line1: contractor.address_line1 ?? '',
      address_line2: contractor.address_line2 ?? '',
      town: contractor.town ?? '',
      postcode: contractor.postcode ?? '',
      contact_name: contractor.contact_name ?? '',
      contact_email: contractor.contact_email ?? '',
    })
  }, [contractor])

  useEffect(() => {
    if (!contractor?.logo_path) {
      setLogoUrl(null)
      return
    }
    supabase.storage
      .from('cis-logos')
      .createSignedUrl(contractor.logo_path, 3600)
      .then(({ data }) => setLogoUrl(data?.signedUrl ?? null))
  }, [contractor?.logo_path])

  if (!contractor) return <div className="text-sm text-slate-400">Loading…</div>

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const { error } = await supabase
      .from('cis_contractors')
      .update({
        name: form.name,
        utr: form.utr || null,
        accounts_office_reference: form.accounts_office_reference || null,
        employer_paye_reference: form.employer_paye_reference || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        town: form.town || null,
        postcode: form.postcode || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
      })
      .eq('id', contractor.id)
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      onSaved()
    } else {
      alert(`Could not save: ${error.message}`)
    }
  }

  const handleLogoSelected = async (file: File) => {
    setLogoError(null)
    setUploadingLogo(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const path = `${contractor.id}/logo.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('cis-logos')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError
      const { error: updateError } = await supabase
        .from('cis_contractors')
        .update({ logo_path: path })
        .eq('id', contractor.id)
      if (updateError) throw updateError
      onSaved()
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Could not upload logo')
    } finally {
      setUploadingLogo(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveLogo = async () => {
    if (!contractor.logo_path) return
    await supabase.storage.from('cis-logos').remove([contractor.logo_path])
    await supabase.from('cis_contractors').update({ logo_path: null }).eq('id', contractor.id)
    onSaved()
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-xs font-medium text-slate-500 mb-3">Logo</div>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={`${contractor.name} logo`} className="h-16 w-16 object-contain rounded border border-slate-200 bg-white" />
          ) : (
            <div className="h-16 w-16 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-300">
              No logo
            </div>
          )}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={(e) => e.target.files?.[0] && handleLogoSelected(e.target.files[0])}
              className="text-sm"
            />
            {logoError && <div className="text-xs text-red-500 mt-1">{logoError}</div>}
            {uploadingLogo && <div className="text-xs text-slate-400 mt-1">Uploading…</div>}
            {contractor.logo_path && !uploadingLogo && (
              <button
                onClick={handleRemoveLogo}
                className="text-xs text-slate-400 hover:text-slate-700 mt-1 block"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div className="col-span-1 sm:col-span-2 text-xs font-medium text-slate-500 -mb-2">
          Contractor details
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Contractor name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Accounts Office reference
          </label>
          <input
            value={form.accounts_office_reference}
            onChange={(e) => setForm({ ...form, accounts_office_reference: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Employer PAYE reference
          </label>
          <input
            value={form.employer_paye_reference}
            onChange={(e) => setForm({ ...form, employer_paye_reference: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Address line 1</label>
          <input
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Address line 2</label>
          <input
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Town / city</label>
          <input
            value={form.town}
            onChange={(e) => setForm({ ...form, town: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Postcode</label>
          <input
            value={form.postcode}
            onChange={(e) => setForm({ ...form, postcode: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Contact name</label>
          <input
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Contact email</label>
          <input
            type="email"
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="col-span-1 sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        </div>
      </form>
    </div>
  )
}
