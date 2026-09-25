// CIS tax months run from the 6th of one month to the 5th of the next.
// We store tax_month_start as the date of the 6th that begins the period.

export function currentTaxMonthStart(today: Date = new Date()): Date {
  const day = today.getDate()
  const year = today.getFullYear()
  const month = today.getMonth() // 0-indexed
  if (day >= 6) {
    return new Date(year, month, 6)
  }
  return new Date(year, month - 1, 6)
}

export function taxMonthEnd(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth() + 1, 5)
}

export function taxMonthDueDate(start: Date): Date {
  // Return due by the 19th of the month following the end of the tax month
  return new Date(start.getFullYear(), start.getMonth() + 1, 19)
}

export function formatTaxMonthLabel(start: Date): string {
  const end = taxMonthEnd(start)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function previousTaxMonths(count: number, from: Date = new Date()): Date[] {
  const start = currentTaxMonthStart(from)
  const months: Date[] = []
  for (let i = 0; i < count; i++) {
    months.push(new Date(start.getFullYear(), start.getMonth() - i, 6))
  }
  return months
}
