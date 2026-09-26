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
  // Build the date string from local date parts rather than toISOString(),
  // which converts to UTC first — during British Summer Time (UTC+1) that
  // silently shifts a local midnight (e.g. the 6th) back to the previous
  // day (the 5th), corrupting which tax month a payment or return belongs
  // to for roughly half the year.
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function previousTaxMonths(count: number, from: Date = new Date()): Date[] {
  const start = currentTaxMonthStart(from)
  const months: Date[] = []
  for (let i = 0; i < count; i++) {
    months.push(new Date(start.getFullYear(), start.getMonth() - i, 6))
  }
  return months
}

// The CIS/UK tax year runs 6 April to 5 April. Given a tax month's start
// date (the 6th of some month), returns the start of the tax year it falls
// in — 6 April of the same calendar year if the month is April–December,
// or 6 April of the previous calendar year if it's January–March/early April.
export function taxYearStart(taxMonthStart: Date): Date {
  const year = taxMonthStart.getFullYear()
  const month = taxMonthStart.getMonth() // 0-indexed; April = 3
  const taxYearBeginsThisCalendarYear = month >= 3 // Apr(6th)–Dec, or Jan–Mar counts as previous
  return new Date(taxYearBeginsThisCalendarYear ? year : year - 1, 3, 6)
}
