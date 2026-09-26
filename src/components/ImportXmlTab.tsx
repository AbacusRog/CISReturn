import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Contractor, DeductionRate, Subcontractor } from '../types/cis'
import {
  inferDeductionRate,
  parseCis300Xml,
  type ParsedCis300Return,
} from '../utils/parseCis300Xml'
import { extractXmlFromPdf } from '../utils/extractXmlFromPdf'
import { formatTaxMonthLabel } from '../utils/taxMonth'

interface FileResult {
  fileName: string
  parsed?: ParsedCis300Return
  error?: string
  alreadyImported?: boolean
}

export default function ImportXmlTab({
  contractorId,
  contractor,
}: {
  contractorId: string
  contractor: Contractor | null
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [results, setResults] = useState<FileResult[]>([])
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const handleFilesSelected = async (files: FileList) => {
    setDone(null)
    setChecking(true)
    const parsedResults: FileResult[] = []
    for (const file of Array.from(files)) {
      try {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        const text = isPdf ? await extractXmlFromPdf(file) : await file.text()
        const parsed = parseCis300Xml(text)
        parsedResults.push({ fileName: file.name, parsed })
      } catch (err) {
        parsedResults.push({
          fileName: file.name,
          error: err instanceof Error ? err.message : 'Could not parse this file',
        })
      }
    }

    // Flag months that already have a monthly return for this contractor,
    // so re-uploading the same file (or a whole folder of them) is safe.
    const months = parsedResults.filter((r) => r.parsed).map((r) => r.parsed!.taxMonthStart)
    if (months.length > 0) {
      const { data: existing } = await supabase
        .from('cis_monthly_returns')
        .select('tax_month_start')
        .eq('contractor_id', contractorId)
        .in('tax_month_start', months)
      const existingMonths = new Set((existing ?? []).map((r: { tax_month_start: string }) => r.tax_month_start))
      for (const r of parsedResults) {
        if (r.parsed && existingMonths.has(r.parsed.taxMonthStart)) r.alreadyImported = true
      }
    }

    setResults(parsedResults)
    setChecking(false)
  }

  const importableResults = results.filter((r) => r.parsed && !r.error && !r.alreadyImported)

  const handleImport = async () => {
    setImporting(true)
    let subcontractorsCreated = 0
    let paymentsCreated = 0
    let returnsCreated = 0

    // Load existing subcontractors once, so repeated files in the same
    // batch (and existing records) are matched rather than duplicated.
    const { data: existingSubs } = await supabase
      .from('cis_subcontractors')
      .select('*')
      .eq('contractor_id', contractorId)
    const subs = ((existingSubs as Subcontractor[]) ?? []).slice()

    const findOrCreateSubcontractor = async (
      parsedSub: ParsedCis300Return['subcontractors'][number],
    ): Promise<Subcontractor> => {
      const match = subs.find(
        (s) =>
          (parsedSub.utr && s.utr === parsedSub.utr) ||
          (parsedSub.nino && s.ni_number === parsedSub.nino) ||
          (parsedSub.crn && s.company_reg_number === parsedSub.crn),
      )
      if (match) return match

      const rate = inferDeductionRate(parsedSub)
      const { data: created, error } = await supabase
        .from('cis_subcontractors')
        .insert({
          contractor_id: contractorId,
          subcontractor_type: parsedSub.crn ? 'company' : 'sole_trader',
          business_name: parsedSub.name,
          utr: parsedSub.utr,
          ni_number: parsedSub.nino,
          company_reg_number: parsedSub.crn,
          deduction_rate: rate as DeductionRate,
          verification_number: parsedSub.verificationNumber,
          verification_status: parsedSub.verificationNumber ? 'verified' : 'unverified',
          verified_at: parsedSub.verificationNumber ? new Date().toISOString() : null,
          active: true,
        })
        .select()
        .single()
      if (error) throw error
      subcontractorsCreated++
      subs.push(created as Subcontractor)
      return created as Subcontractor
    }

    try {
      for (const result of importableResults) {
        const parsed = result.parsed!
        const { data: newReturn, error: returnError } = await supabase
          .from('cis_monthly_returns')
          .insert({
            contractor_id: contractorId,
            tax_month_start: parsed.taxMonthStart,
            nil_return: parsed.subcontractors.every((s) => s.totalPayments === 0),
            status: 'submitted',
            submitted_at: parsed.submittedAt ?? null,
            is_sandbox: false,
          })
          .select()
          .single()
        if (returnError) throw returnError
        returnsCreated++

        for (const parsedSub of parsed.subcontractors) {
          const subcontractor = await findOrCreateSubcontractor(parsedSub)
          const rate = inferDeductionRate(parsedSub)
          const basicPay = Math.max(0, parsedSub.totalPayments - parsedSub.costOfMaterials)
          const netAmount = parsedSub.totalPayments - parsedSub.totalDeducted

          const { data: payment, error: paymentError } = await supabase
            .from('cis_payments')
            .insert({
              contractor_id: contractorId,
              subcontractor_id: subcontractor.id,
              tax_month_start: parsed.taxMonthStart,
              basic_pay: basicPay,
              materials_amount: parsedSub.costOfMaterials,
              materials_on_top: false,
              vat_amount: 0,
              gross_amount: parsedSub.totalPayments,
              deduction_rate: rate as DeductionRate,
              deduction_amount: parsedSub.totalDeducted,
              net_amount: netAmount,
              finalised: true,
              finalised_at: parsed.submittedAt ?? new Date().toISOString(),
            })
            .select()
            .single()
          if (paymentError) throw paymentError
          paymentsCreated++

          await supabase.from('cis_return_lines').insert({
            monthly_return_id: newReturn.id,
            payment_id: payment.id,
            subcontractor_id: subcontractor.id,
            business_name: subcontractor.business_name,
            utr: subcontractor.utr,
            ni_number: subcontractor.ni_number,
            verification_number: subcontractor.verification_number,
            gross_amount: parsedSub.totalPayments,
            materials_amount: parsedSub.costOfMaterials,
            deduction_rate: rate as DeductionRate,
            deduction_amount: parsedSub.totalDeducted,
          })
        }
      }
      setDone(
        `Imported ${returnsCreated} month(s): ${paymentsCreated} payment(s), ${subcontractorsCreated} new subcontractor(s).`,
      )
      setResults([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      alert(`Import failed partway through: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  const mismatchedAOref = results.some(
    (r) =>
      r.parsed?.contractorAOref &&
      contractor?.accounts_office_reference &&
      r.parsed.contractorAOref !== contractor.accounts_office_reference,
  )

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="text-xs font-medium text-slate-500 mb-2">
          Import previously submitted CIS300 monthly returns
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Upload the GovTalk XML file(s) that were submitted to HMRC for earlier months (e.g.
          exported from your previous CIS software) — either the raw <code>.xml</code> file, or a
          PDF printout of the submission that contains the full XML text (both work). Each file
          creates a finalised monthly return and its payments here, matching subcontractors by
          UTR, NI number, or company number, and adding any that don't already exist.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,text/xml,application/xml,.pdf,application/pdf"
          multiple
          onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
          className="text-sm"
        />
      </div>

      {checking && <div className="text-sm text-slate-400">Reading files…</div>}

      {done && <div className="text-sm text-green-600 mb-4">{done}</div>}

      {mismatchedAOref && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          One or more files show a different Accounts Office reference to this contractor — double
          check you're importing into the right client before continuing.
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Tax month</th>
                <th className="px-3 py-2">Subcontractors</th>
                <th className="px-3 py-2">Total gross</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{r.fileName}</td>
                  <td className="px-3 py-2">
                    {r.parsed ? formatTaxMonthLabel(new Date(r.parsed.taxMonthStart)) : '—'}
                  </td>
                  <td className="px-3 py-2">{r.parsed?.subcontractors.length ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.parsed
                      ? `£${r.parsed.subcontractors
                          .reduce((sum, s) => sum + s.totalPayments, 0)
                          .toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-red-600">{r.error}</span>
                    ) : r.alreadyImported ? (
                      <span className="text-slate-400">Already imported — skipped</span>
                    ) : (
                      <span className="text-green-600">Ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-3 border-t border-slate-100">
            <div className="text-xs text-slate-400">
              {importableResults.length} of {results.length} file(s) ready to import
            </div>
            <button
              onClick={handleImport}
              disabled={importing || importableResults.length === 0}
              className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${importableResults.length} month(s)`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
