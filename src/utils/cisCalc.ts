import type { DeductionRate } from '../types/cis'

// CIS deduction is calculated on the "labour" element of a payment:
// gross amount paid, minus any VAT, minus the cost of materials the
// subcontractor incurred. Deduction rate is 0% (gross status), 20%
// (registered/verified) or 30% (unmatched/unregistered).
export function calculateDeduction(
  grossAmount: number,
  materialsAmount: number,
  deductionRate: DeductionRate,
) {
  const taxableAmount = Math.max(0, grossAmount - materialsAmount)
  const deductionAmount = round2((taxableAmount * deductionRate) / 100)
  const netAmount = round2(grossAmount - deductionAmount)
  return { deductionAmount, netAmount }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
