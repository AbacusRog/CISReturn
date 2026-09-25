import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Contractor, Subcontractor, Payment } from '../types/cis'
import { formatTaxMonthLabel } from './taxMonth'

// Builds a Payment & Deduction Statement PDF for a single subcontractor
// payment, per HMRC's CIS requirement that every subcontractor paid under
// deduction be given a statement showing gross payment, cost of materials,
// and the amount deducted.
export async function buildStatementPdf(
  contractor: Contractor,
  subcontractor: Subcontractor,
  payment: Payment,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89]) // A4
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  let y = 792

  const drawText = (
    text: string,
    x: number,
    size = 11,
    useFont = font,
    color = rgb(0.1, 0.1, 0.1),
  ) => {
    page.drawText(text, { x, y, size, font: useFont, color })
  }

  drawText('Payment and Deduction Statement', margin, 18, bold)
  y -= 28
  drawText('Construction Industry Scheme', margin, 11, font, rgb(0.4, 0.4, 0.4))
  y -= 30

  drawText('Contractor', margin, 10, bold, rgb(0.4, 0.4, 0.4))
  y -= 16
  drawText(contractor.name, margin, 12)
  if (contractor.utr) {
    y -= 16
    drawText(`UTR: ${contractor.utr}`, margin, 10, font, rgb(0.35, 0.35, 0.35))
  }
  y -= 30

  drawText('Subcontractor', margin, 10, bold, rgb(0.4, 0.4, 0.4))
  y -= 16
  drawText(subcontractor.business_name, margin, 12)
  y -= 16
  if (subcontractor.utr) {
    drawText(`UTR: ${subcontractor.utr}`, margin, 10, font, rgb(0.35, 0.35, 0.35))
    y -= 16
  } else if (subcontractor.ni_number) {
    drawText(`NI number: ${subcontractor.ni_number}`, margin, 10, font, rgb(0.35, 0.35, 0.35))
    y -= 16
  }
  y -= 14

  drawText(
    `Tax month: ${formatTaxMonthLabel(new Date(payment.tax_month_start))}`,
    margin,
    11,
    bold,
  )
  y -= 34

  const rows: [string, string][] = [
    ['Gross amount paid', formatMoney(payment.gross_amount)],
    ['Less cost of materials', formatMoney(payment.materials_amount)],
    ['Amount liable to deduction', formatMoney(payment.gross_amount - payment.materials_amount)],
    [`Deduction made (${payment.deduction_rate}%)`, formatMoney(payment.deduction_amount)],
    ['Net amount paid', formatMoney(payment.net_amount)],
  ]

  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: 545, y: y + 10 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })

  for (const [label, value] of rows) {
    y -= 22
    drawText(label, margin, 11)
    drawText(value, 400, 11, label.startsWith('Net') ? bold : font)
  }

  y -= 40
  drawText(
    'This statement is issued in accordance with the Construction Industry Scheme.',
    margin,
    9,
    font,
    rgb(0.5, 0.5, 0.5),
  )

  return doc.save()
}

function formatMoney(amount: number): string {
  return `£${amount.toFixed(2)}`
}
