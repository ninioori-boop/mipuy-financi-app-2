'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { INTAKE_QUESTIONS, INTAKE_TITLE, INTAKE_INTRO, type IntakeQuestion } from '@/lib/intakeForm'
import {
  uploadIntakeFile, listMyIntake, deleteIntakeFile, saveAnswers, loadMyAnswers, getFileUrl,
  type IntakeFile,
} from '@/lib/intake'
import { useImpersonationStore } from '@/stores/impersonationStore'

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
  // An advisor inside a client's account sees the CLIENT's questionnaire, and
  // only ever reads it: both rule files reserve intake writes for the owner.
  const client = useImpersonationStore(s => s.client)
  const readOnly = !!client
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [files, setFiles]     = useState<IntakeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busyQ, setBusyQ]     = useState<string | null>(null)
  const [dragQ, setDragQ]     = useState<string | null>(null)  // question being dragged over
  const [saved, setSaved]     = useState(false)
  // A save that FAILED (revoked mid-session, offline) must flip the footer:
  // "הכול נשמר אוטומטית" while nothing is being saved is a false claim, and
  // the client would close the tab and lose their answers.
  const [saveFailed, setSaveFailed] = useState(false)
  // A READ that failed must never be painted as "the client filled in nothing".
  // An advisor whose link was revoked mid-session, or a Firestore blip, gets
  // permission-denied on both reads — and an empty form that confidently says
  // "לא נענה" would send him to ask a client to re-upload documents they
  // already sent. Empty and invisible are different facts; say which one it is.
  const [loadFailed, setLoadFailed] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reloadFiles = useCallback(async () => {
    try { setFiles(await listMyIntake()) } catch { /* not ready */ }
  }, [])

  // Keyed on the account in view: entering or leaving act-as-client must refetch,
  // never leave the previous person's answers and files on screen. (Entry is
  // normally a full navigation, but an empty dep list would make a same-mount
  // identity change display the wrong portfolio — the failure this screen was
  // just fixed for.)
  const viewedUid = client?.uid ?? null
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setAnswers({}); setFiles([])
    ;(async () => {
      try {
        const [a, f] = await Promise.all([loadMyAnswers(), listMyIntake()])
        if (!cancelled) { setAnswers(a); setFiles(f) }
      } catch { if (!cancelled) setLoadFailed(true) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => {
      cancelled = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [viewedUid])

  const setAnswer = useCallback((id: string, val: string) => {
    // Belt and braces: the fields are already read-only for an advisor, but a
    // stray edit must never schedule a save — the old code would have written
    // the client's answer into the ADVISOR's own intake document.
    if (useImpersonationStore.getState().client) return
    setAnswers(prev => {
      const next = { ...prev, [id]: val }
      setSaved(false)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try { await saveAnswers(next); setSaved(true); setSaveFailed(false) }
        catch { setSaveFailed(true) }
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

  async function openFile(f: IntakeFile) {
    try { window.open(await getFileUrl(f.path), '_blank', 'noopener') }
    catch (e) { toast.error('שגיאה בפתיחת הקובץ: ' + (e as Error).message) }
  }

  const fileRow = (f: IntakeFile) => (
    <div key={f.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs">
      <span className="shrink-0">{fileIcon(f.type, f.name)}</span>
      <span className="flex-1 min-w-0 truncate text-txt">{f.name}</span>
      <span className="text-muted-txt shrink-0">{fmtSize(f.size)}</span>
      <button onClick={() => openFile(f)} className="border border-line rounded px-2 py-0.5 text-muted-txt hover:text-gold hover:border-gold/60 transition-colors shrink-0" title="פתח / הורד">פתח</button>
      {!readOnly && (
        <button onClick={() => removeFile(f)} className="border border-line rounded px-2 py-0.5 text-muted-txt hover:text-expense hover:border-expense/50 transition-colors shrink-0" title="מחק קובץ">מחק</button>
      )}
    </div>
  )

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
        {saved && !readOnly && <p className="text-xs text-income mt-2">✓ נשמר אוטומטית</p>}
      </div>

      {/* Whose questionnaire this is. Until 2026-08-11 this screen silently
          showed the ADVISOR their own answers and their own files while they
          were inside a client's account, so "the client uploaded nothing" and
          "I am looking at my own folder" were indistinguishable. */}
      {readOnly && (
        <div className="rounded-xl border border-gold/40 bg-surface2 p-4 text-sm text-txt leading-relaxed">
          👤 השאלון של <strong className="text-gold">{client?.name || client?.email || 'הלקוח'}</strong>, לצפייה בלבד.
          <span className="block text-xs text-muted-txt mt-1">
            העלאה, עריכה ומחיקה של מסמכים נעשות מהחשבון של הלקוח בלבד. אפשר לפתוח ולהוריד כל קובץ שהועלה.
          </span>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt text-sm">טוען…</div>
      ) : readOnly && loadFailed ? (
        // Never render the questionnaire here: an empty form in this state says
        // "לא נענה" and "לא הועלו מסמכים" about data we simply could not read.
        <div className="rounded-xl border border-expense/40 bg-expense/10 p-5 text-sm text-txt leading-relaxed">
          ⚠️ לא הצלחנו לטעון את השאלון של הלקוח.
          <span className="block text-muted-txt text-xs mt-2">
            אל תסיק מכאן שהלקוח לא מילא כלום, פשוט לא הצלחנו לקרוא. שתי הסיבות השכיחות: הלקוח ביטל את
            ההרשאה תוך כדי הצפייה, או תקלת רשת זמנית. כדאי לצאת מהחשבון של הלקוח ולהיכנס שוב.
          </span>
        </div>
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
                  readOnly={readOnly}
                  placeholder={readOnly ? 'לא נענה' : q.type === 'phone' ? '05X-XXXXXXX' : 'התשובה שלכם…'}
                  className={`${inputCls}${readOnly ? ' opacity-70 cursor-default' : ''}`}
                  style={q.type === 'phone' ? { direction: 'ltr', textAlign: 'right' } : undefined}
                />
              )}

              {/* paragraph */}
              {q.type === 'paragraph' && (
                <textarea
                  value={answers[q.id] ?? ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  readOnly={readOnly}
                  rows={3}
                  placeholder={readOnly ? 'לא נענה' : 'פירוט…'}
                  className={`${inputCls} leading-relaxed${readOnly ? ' opacity-70 cursor-default' : ''}`}
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
                        disabled={readOnly}
                        className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                          active ? 'bg-gold/20 text-gold border-gold/50' : 'bg-surface text-txt border-line hover:border-gold/40'
                        }${readOnly ? ' opacity-60 cursor-default hover:border-line' : ''}`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* file upload — click OR drag-and-drop */}
              {q.type === 'file' && (
                <div className="space-y-2">
                  {readOnly && qFiles.length === 0 && (
                    <p className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted-txt">
                      לא הועלו מסמכים לשאלה הזאת
                    </p>
                  )}
                  {!readOnly && <label
                    onDragOver={e => { e.preventDefault(); setDragQ(q.id) }}
                    onDragLeave={() => setDragQ(prev => (prev === q.id ? null : prev))}
                    onDrop={e => { e.preventDefault(); setDragQ(null); const fs = Array.from(e.dataTransfer.files); if (fs.length) uploadForQuestion(q, fs) }}
                    className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors text-sm text-muted-txt ${
                      dragQ === q.id ? 'border-gold bg-gold/10 text-gold' : 'border-line bg-surface hover:border-gold/50'
                    }`}
                  >
                    <input
                      type="file"
                      multiple
                      accept=".xlsx,.xls,.csv,.pdf,image/*,.doc,.docx"
                      className="hidden"
                      disabled={busyQ === q.id}
                      onChange={e => { const input = e.currentTarget; const fs = Array.from(input.files ?? []); input.value = ''; if (fs.length) uploadForQuestion(q, fs) }}
                    />
                    <span>{busyQ === q.id ? '⏳ מעלה…' : dragQ === q.id ? '⬇ שחררו כאן' : '📎 בחרו או גררו קבצים לכאן'}</span>
                  </label>}
                  {qFiles.length > 0 && (
                    <div className="space-y-1">{qFiles.map(fileRow)}</div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Files with no questionId were bucketed under '_other' and rendered on
          NO screen — the question loop only walks INTAKE_QUESTIONS. Uploads
          predating the per-question tagging land here, so the footer below was
          claiming "this is everything" while hiding real client documents. */}
      {!loading && !(readOnly && loadFailed) && (filesByQ['_other']?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2.5">
          <p className="text-sm font-semibold text-txt">📎 מסמכים נוספים</p>
          <p className="text-xs text-muted-txt -mt-1">קבצים שהועלו בלי שיוך לשאלה מסוימת.</p>
          <div className="space-y-1">{filesByQ['_other'].map(fileRow)}</div>
        </div>
      )}

      {/* The client-facing "everything is saved automatically" promise is false
          for an advisor, who cannot write here at all. */}
      {!loading && readOnly ? (loadFailed ? null : (
        <div className="rounded-xl border border-line bg-surface2 p-4 text-center text-sm text-muted-txt">
          זהו כל מה שהלקוח מילא והעלה עד עכשיו. כדי להשלים פרטים חסרים, בקש מהלקוח למלא אותם בחשבון שלו.
        </div>
      )) : !loading && (saveFailed ? (
        <div className="rounded-xl border border-expense/40 bg-expense/10 p-4 text-center text-sm text-txt">
          ⚠️ השמירה לא מצליחה כרגע, והתשובות האחרונות עדיין לא נשמרו. כדאי לבדוק את החיבור לאינטרנט או לפנות ליועץ לפני שסוגרים את הדף.
        </div>
      ) : (
        <div className="rounded-xl border border-income/30 bg-income/5 p-4 text-center text-sm text-txt">
          ✓ הכול נשמר אוטומטית. סיימתם? אפשר לסגור — היועץ יראה את מה שמילאתם והעליתם.
        </div>
      ))}
    </div>
  )
}
