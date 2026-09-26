import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Contractor, Subcontractor, Payment } from '../types/cis'
import { formatTaxMonthLabel } from './taxMonth'
import type { LogoAsset } from './logo'

export interface YtdTotals {
  gross: number
  materials: number
  deduction: number
  vat: number
  net: number
}

// Builds a Payment & Deduction Statement PDF for a single subcontractor
// payment, per HMRC's CIS requirement that every subcontractor paid under
// deduction be given a statement showing gross payment, cost of materials,
// and the amount deducted. An optional year-to-date total (accumulated from
// the start of the CIS tax year to and including this payment) is shown
// alongside the this-period figures, matching how payslip-style CIS tools
// present both views.
export async function buildStatementPdf(
  contractor: Contractor,
  subcontractor: Subcontractor,
  payment: Payment,
  ytd?: YtdTotals,
  logo?: LogoAsset | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89]) // A4
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  let y = 792

  if (logo) {
    const embedded = logo.contentType === 'image/png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes)
    const maxW = 130
    const maxH = 55
    const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1)
    const w = embedded.width * scale
    const h = embedded.height * scale
    page.drawImage(embedded, { x: 595.28 - margin - w, y: 841.89 - 40 - h, width: w, height: h })
  }

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

  const taxableAmount = payment.materials_on_top
    ? payment.basic_pay
    : Math.max(0, payment.basic_pay - payment.materials_amount)

  const rows: [string, string][] = [
    ['Basic pay (labour)', formatMoney(payment.basic_pay)],
    [
      payment.materials_on_top ? 'Plus cost of materials' : 'Of which, cost of materials',
      formatMoney(payment.materials_amount),
    ],
    ['Amount liable to deduction', formatMoney(taxableAmount)],
    [`Deduction made (${payment.deduction_rate}%)`, formatMoney(payment.deduction_amount)],
    ['Gross amount paid', formatMoney(payment.gross_amount)],
  ]
  if (subcontractor.vat_registered) {
    rows.push(['VAT', formatMoney(payment.vat_amount)])
  }
  rows.push(['Net amount paid', formatMoney(payment.net_amount)])

  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: 545, y: y + 10 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })

  drawText('This period', 400, 10, bold, rgb(0.4, 0.4, 0.4))
  y -= 4

  for (const [label, value] of rows) {
    y -= 22
    drawText(label, margin, 11)
    drawText(value, 400, 11, label.startsWith('Net') ? bold : font)
  }

  if (ytd) {
    y -= 20
    page.drawLine({
      start: { x: margin, y: y + 10 },
      end: { x: 545, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    })
    y -= 14
    drawText('Year to date', margin, 11, bold)
    y -= 22
    const ytdRows: [string, string][] = [
      ['Gross amount paid', formatMoney(ytd.gross)],
      ['Cost of materials', formatMoney(ytd.materials)],
      ['Deduction made', formatMoney(ytd.deduction)],
    ]
    if (subcontractor.vat_registered) ytdRows.push(['VAT', formatMoney(ytd.vat)])
    ytdRows.push(['Net amount paid', formatMoney(ytd.net)])
    for (const [label, value] of ytdRows) {
      drawText(label, margin, 11)
      drawText(value, 400, 11, label.startsWith('Net') ? bold : font)
      y -= 22
    }
  }

  y -= 20
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
