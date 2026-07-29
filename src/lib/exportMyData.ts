import { collectSnapshot } from './dataSync'
import { listMyIntake, getFileUrl, loadMyAnswers } from './intake'

/**
 * "Download a copy of my data" — offered before irreversible deletion.
 *
 * The raw snapshot alone is a developer artifact (English keys, internal row
 * ids); on its own it is not a meaningful copy for a coaching client, and it
 * omits the one thing that cannot be reconstructed: the documents they
 * uploaded. So this produces three files.
 */

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke late — Safari needs the object alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

/** Everything the app stores about the user, machine-readable. */
export function downloadSnapshotJson() {
  const payload = { exportedAt: new Date().toISOString(), data: collectSnapshot() }
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `הנתונים-שלי-${stamp()}.json`)
}

/** The human-readable copy: the same annual workbook the annual tab exports. */
export async function downloadAnnualXlsx(input: Parameters<typeof import('./exportAnnualXlsx')['exportAnnualXlsx']>[0]) {
  const { exportAnnualXlsx } = await import('./exportAnnualXlsx')
  exportAnnualXlsx(input)
}

/**
 * An index of the uploaded documents with working download links, plus the
 * intake answers. Links are signed URLs, so the page is only useful while the
 * account still exists — which is exactly why it is offered BEFORE deletion.
 */
export async function downloadDocumentsIndex(): Promise<number> {
  const files = await listMyIntake()
  const answers = await loadMyAnswers().catch(() => ({} as Record<string, string>))
  const rows = await Promise.all(files.map(async f => {
    let url = ''
    try { url = await getFileUrl(f.path) } catch { /* keep the row, drop the link */ }
    return { name: f.name, size: f.size, url }
  }))

  const esc = (s: string) => s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ))
  const html = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8">
<title>המסמכים והתשובות שלי</title>
<body style="font-family:Arial,Helvetica,sans-serif;direction:rtl;max-width:760px;margin:40px auto;padding:0 16px;">
<h1>המסמכים שהעליתי</h1>
<p style="color:#666">הקישורים פעילים כל עוד החשבון קיים. מומלץ להוריד את הקבצים עכשיו ולשמור אותם אצלך.</p>
${rows.length ? `<ul>${rows.map(r => `<li><a href="${esc(r.url)}">${esc(r.name)}</a> ${Math.round(r.size / 1024)}KB</li>`).join('')}</ul>`
    : '<p>לא הועלו מסמכים.</p>'}
<h1>תשובות שאלון הקליטה</h1>
${Object.keys(answers).length
    ? `<dl>${Object.entries(answers).map(([k, v]) => `<dt style="font-weight:bold;margin-top:12px">${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>`
    : '<p>לא מולא שאלון.</p>'}
</body></html>`

  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `המסמכים-שלי-${stamp()}.html`)
  return rows.length
}
