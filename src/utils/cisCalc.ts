import type { DeductionRate } from '../types/cis'

export interface PaymentCalcInput {
  basicPay: number
  materialsAmount: number
  materialsOnTop: boolean
  vatAmount: number
  deductionRate: DeductionRate
}

export interface PaymentCalcResult {
  taxableAmount: number
  totalGross: number
  deductionAmount: number
  netAmount: number
}

// CIS deduction is calculated on the "labour" element of a payment only —
// materials cost and VAT are never subject to deduction.
//
// Two ways materials can be entered, matching how contractors actually
// quote jobs:
//   - materialsOnTop = true: "basicPay" is the labour-only figure, and
//     materials are paid on top of it. Total gross = basicPay + materials.
//   - materialsOnTop = false: "basicPay" is already the total inclusive
//     figure (labour + materials combined), so materials are subtracted
//     back out to find the taxable (labour-only) amount.
//
// VAT, when the subcontractor is VAT registered, is added in full to the
// net payment and never touches the deduction calculation.
export function calculatePayment({
  basicPay,
  materialsAmount,
  materialsOnTop,
  vatAmount,
  deductionRate,
}: PaymentCalcInput): PaymentCalcResult {
  const taxableAmount = Math.max(
    0,
    materialsOnTop ? basicPay : basicPay - materialsAmount,
  )
  const totalGross = materialsOnTop ? basicPay + materialsAmount : basicPay
  const deductionAmount = round2((taxableAmount * deductionRate) / 100)
  const netAmount = round2(totalGross - deductionAmount + vatAmount)
  return { taxableAmount, totalGross, deductionAmount, netAmount }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
