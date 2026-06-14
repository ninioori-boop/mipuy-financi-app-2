import * as XLSX from 'xlsx'

// allSheets: concatenate every sheet's rows (with a blank separator row between),
// for statements that split sections across sheets (e.g. Isracard "בארץ"/"בחו"ל").
// Default false keeps single-sheet behavior for callers that don't opt in.
export async function parseExcelFile(
  file: File,
  opts: { allSheets?: boolean } = {},
): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const names = opts.allSheets ? wb.SheetNames : [wb.SheetNames[0]]
        const rows: unknown[][] = []
        names.forEach((name, i) => {
          const ws = wb.Sheets[name]
          if (!ws) return
          if (i > 0) rows.push([])  // separator between sheets
          rows.push(...(XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]))
        })
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'))
    reader.readAsArrayBuffer(file)
  })
}
