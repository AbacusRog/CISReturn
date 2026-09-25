// Minimal RFC4180-ish CSV parser — good enough for subcontractor import
// templates without pulling in an extra dependency. Handles quoted fields,
// escaped quotes (""), commas and newlines inside quotes, and CRLF/LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      pushField()
    } else if (char === '\n') {
      pushRow()
    } else if (char === '\r') {
      // skip; \n (if present) handles the row break
    } else {
      field += char
    }
  }
  // Final field/row, if the file doesn't end with a newline
  if (field.length > 0 || row.length > 0) pushRow()

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const needsQuoting = /[",\n]/.test(cell)
          const escaped = cell.replace(/"/g, '""')
          return needsQuoting ? `"${escaped}"` : escaped
        })
        .join(','),
    )
    .join('\r\n')
}
