'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { uploadIntakeFile, listMyIntake, deleteIntakeFile, type IntakeFile } from '@/lib/intake'

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1000) return `${Math.round(bytes / 1000)}KB`
  return `${bytes}B`
}
function fmtDate(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const fileIcon = (type: string, name: string) =>
  type.startsWith('image/') ? '🖼️'
  : type === 'application/pdf' || /\.pdf$/i.test(name) ? '📕'
  : /\.(xlsx|xls|csv)$/i.test(name) ? '📊'
  : '📄'

export default function IntakePage() {
  const [files, setFiles]     = useState<IntakeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)

  const refresh = useCallback(async () => {
    try { setFiles(await listMyIntake()) }
    catch { /* not signed in yet / service not ready */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleFiles = useCallback(async (incoming: File[]) => {
    if (!incoming.length) return
    setBusy(true)
    let ok = 0
    for (const file of incoming) {
      if (file.size > 25 * 1024 * 1024) { toast.error(`"${file.name}" גדול מ‑25MB — דלג`); continue }
      try { await uploadIntakeFile(file); ok++ }
      catch (e) {
        toast.error('שגיאה בהעלאה: ' + (e as Error).message + ' (ייתכן שהשירות עדיין בהקמה)')
        break
      }
    }
    if (ok) toast.success(`${ok} קבצים הועלו ונשלחו ליועץ`)
    await refresh()
    setBusy(false)
  }, [refresh])

  async function remove(f: IntakeFile) {
    if (!confirm(`למחוק את "${f.name}"?`)) return
    try { await deleteIntakeFile(f); toast.success('נמחק'); await refresh() }
    catch (e) { toast.error('שגיאה במחיקה: ' + (e as Error).message) }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">📤 העלאת מסמכים</h1>
        <p className="text-muted-txt text-sm">
          העלו כאן את כל מה שצריך למיפוי — דוחות אשראי/בנק (Excel או PDF), צילומי דוחות, תלושי שכר, מסמכי הלוואות.
          הקבצים נשלחים ישירות ליועץ, והם פרטיים — רק אתם והיועץ רואים אותם.
        </p>
      </div>

      {/* Uploader */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <label className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-surface hover:border-gold/50 p-8 cursor-pointer transition-colors text-center">
          <input
            type="file"
            multiple
            accept=".xlsx,.xls,.csv,.pdf,image/*,.doc,.docx"
            className="hidden"
            disabled={busy}
            onChange={e => { const input = e.currentTarget; const fs = Array.from(input.files ?? []); input.value = ''; if (fs.length) handleFiles(fs) }}
          />
          <span className="text-3xl">{busy ? '⏳' : '📎'}</span>
          <span className="text-sm text-txt">{busy ? 'מעלה…' : 'בחרו או גררו קבצים לכאן'}</span>
          <span className="text-xs text-muted-txt/70">Excel · PDF · תמונות · מסמכים — עד 25MB לקובץ</span>
        </label>
      </div>

      {/* My files */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-txt">הקבצים שהעליתי {files.length > 0 && <span className="text-muted-txt font-normal">({files.length})</span>}</h2>
        {loading ? (
          <p className="text-sm text-muted-txt">טוען…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-txt">עדיין לא העלית קבצים.</p>
        ) : (
          <div className="space-y-1.5">
            {files.map(f => (
              <div key={f.id} className="group flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-line">
                <span className="text-lg shrink-0">{fileIcon(f.type, f.name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-txt truncate">{f.name}</div>
                  <div className="text-[11px] text-muted-txt">{fmtSize(f.size)} · {fmtDate(f.uploadedAt)} · ✓ נשלח ליועץ</div>
                </div>
                <button onClick={() => remove(f)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm shrink-0" title="מחק">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
