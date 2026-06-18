'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { INTAKE_QUESTIONS, INTAKE_TITLE, INTAKE_INTRO, type IntakeQuestion } from '@/lib/intakeForm'
import {
  uploadIntakeFile, listMyIntake, deleteIntakeFile, saveAnswers, loadMyAnswers,
  type IntakeFile,
} from '@/lib/intake'

function fmtSize(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`
  if (b >= 1000) return `${Math.round(b / 1000)}KB`
  return `${b}B`
}
const fileIcon = (type: string, name: string) =>
  type.startsWith('image/') ? '🖼️'
  : type === 'application/pdf' || /\.pdf$/i.test(name) ? '📕'
  : /\.(xlsx|xls|csv)$/i.test(name) ? '📊'
  : '📄'

const inputCls = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60'

export default function IntakePage() {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [files, setFiles]     = useState<IntakeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busyQ, setBusyQ]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reloadFiles = useCallback(async () => {
    try { setFiles(await listMyIntake()) } catch { /* not ready */ }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const [a, f] = await Promise.all([loadMyAnswers(), listMyIntake()])
        setAnswers(a); setFiles(f)
      } catch { /* service not ready / not signed in */ }
      finally { setLoading(false) }
    })()
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [])

  const setAnswer = useCallback((id: string, val: string) => {
    setAnswers(prev => {
      const next = { ...prev, [id]: val }
      setSaved(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try { await saveAnswers(next); setSaved(true) } catch { /* ignore */ }
      }, 800)
      return next
    })
  }, [])

  const uploadForQuestion = useCallback(async (q: IntakeQuestion, incoming: File[]) => {
    if (!incoming.length) return
    setBusyQ(q.id)
    let ok = 0
    for (const file of incoming) {
      if (file.size > 25 * 1024 * 1024) { toast.error(`"${file.name}" גדול מ‑25MB — דלג`); continue }
      try { await uploadIntakeFile(file, q.id); ok++ }
      catch (e) { toast.error('שגיאה בהעלאה: ' + (e as Error).message + ' (ייתכן שהשירות בהקמה)'); break }
    }
    if (ok) toast.success(`${ok} קבצים הועלו`)
    await reloadFiles()
    setBusyQ(null)
  }, [reloadFiles])

  async function removeFile(f: IntakeFile) {
    if (!confirm(`למחוק את "${f.name}"?`)) return
    try { await deleteIntakeFile(f); await reloadFiles() }
    catch (e) { toast.error('שגיאה במחיקה: ' + (e as Error).message) }
  }

  const filesByQ = useMemo(() => {
    const map: Record<string, IntakeFile[]> = {}
    for (const f of files) {
      const key = f.questionId ?? '_other'
      ;(map[key] ??= []).push(f)
    }
    return map
  }, [files])

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6">
        <h1 className="text-2xl font-bold text-gold mb-2">📋 {INTAKE_TITLE}</h1>
        <p className="text-muted-txt text-sm leading-relaxed">{INTAKE_INTRO}</p>
        {saved && <p className="text-xs text-income mt-2">✓ נשמר אוטומטית</p>}
      </div>

      {loading ? (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt text-sm">טוען…</div>
      ) : (
        INTAKE_QUESTIONS.map((q, i) => {
          const qFiles = filesByQ[q.id] ?? []
          return (
            <div key={q.id} className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2.5">
              <label className="block text-sm font-semibold text-txt leading-relaxed">
                <span className="text-muted-txt font-normal me-1">{i + 1}.</span>
                {q.label}
                {q.required && <span className="text-expense ms-1">*</span>}
              </label>
              {q.hint && <p className="text-xs text-muted-txt -mt-1">{q.hint}</p>}

              {/* text / phone */}
              {(q.type === 'text' || q.type === 'phone') && (
                <input
                  type={q.type === 'phone' ? 'tel' : 'text'}
                  value={answers[q.id] ?? ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  placeholder={q.type === 'phone' ? '05X-XXXXXXX' : 'התשובה שלכם…'}
                  className={inputCls}
                  style={q.type === 'phone' ? { direction: 'ltr', textAlign: 'right' } : undefined}
                />
              )}

              {/* paragraph */}
              {q.type === 'paragraph' && (
                <textarea
                  value={answers[q.id] ?? ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  rows={3}
                  placeholder="פירוט…"
                  className={`${inputCls} leading-relaxed`}
                />
              )}

              {/* choice (כן/לא) */}
              {q.type === 'choice' && (
                <div className="flex gap-2 flex-wrap">
                  {(q.choices ?? []).map(opt => {
                    const active = answers[q.id] === opt
                    return (
                      <button
                        key={opt}
                        onClick={() => setAnswer(q.id, active ? '' : opt)}
                        className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                          active ? 'bg-gold/20 text-gold border-gold/50' : 'bg-surface text-txt border-line hover:border-gold/40'
                        }`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* file upload */}
              {q.type === 'file' && (
                <div className="space-y-2">
                  <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface hover:border-gold/50 px-4 py-3 cursor-pointer transition-colors text-sm text-muted-txt">
                    <input
                      type="file"
                      multiple
                      accept=".xlsx,.xls,.csv,.pdf,image/*,.doc,.docx"
                      className="hidden"
                      disabled={busyQ === q.id}
                      onChange={e => { const input = e.currentTarget; const fs = Array.from(input.files ?? []); input.value = ''; if (fs.length) uploadForQuestion(q, fs) }}
                    />
                    <span>{busyQ === q.id ? '⏳ מעלה…' : '📎 בחרו / גררו קבצים'}</span>
                  </label>
                  {qFiles.length > 0 && (
                    <div className="space-y-1">
                      {qFiles.map(f => (
                        <div key={f.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs">
                          <span className="shrink-0">{fileIcon(f.type, f.name)}</span>
                          <span className="flex-1 min-w-0 truncate text-txt">{f.name}</span>
                          <span className="text-muted-txt shrink-0">{fmtSize(f.size)}</span>
                          <button onClick={() => removeFile(f)} className="text-muted-txt hover:text-expense opacity-0 group-hover:opacity-100 shrink-0" title="מחק">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {!loading && (
        <div className="rounded-xl border border-income/30 bg-income/5 p-4 text-center text-sm text-txt">
          ✓ הכול נשמר אוטומטית. סיימתם? אפשר לסגור — היועץ יראה את מה שמילאתם והעליתם.
        </div>
      )}
    </div>
  )
}
