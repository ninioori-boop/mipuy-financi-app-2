'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { listAllIntake, getFileUrl, type IntakeClient, type IntakeFile } from '@/lib/intake'
import { setHandoffFiles } from '@/lib/intakeHandoff'
import { INTAKE_QUESTIONS } from '@/lib/intakeForm'

function fmtSize(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`
  if (b >= 1000) return `${Math.round(b / 1000)}KB`
  return `${b}B`
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

export default function IntakeReviewPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const isAdvisor = hasLabAccess(user?.email)

  const [clients, setClients] = useState<IntakeClient[]>([])
  const [loading, setLoading] = useState(true)
  const [openUid, setOpenUid] = useState<string | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)

  useEffect(() => {
    if (user && !hasLabAccess(user.email)) router.replace('/app/credit')
  }, [user, router])

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setClients(await listAllIntake()) }
    catch (e) { toast.error('שגיאה בטעינה: ' + (e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (isAdvisor) refresh() }, [isAdvisor, refresh])

  async function viewFile(f: IntakeFile) {
    try { window.open(await getFileUrl(f.path), '_blank', 'noopener') }
    catch (e) { toast.error('שגיאה בפתיחת הקובץ: ' + (e as Error).message) }
  }

  async function openInLab(c: IntakeClient) {
    setBusyUid(c.uid)
    try {
      const files = await Promise.all(c.files.map(async (f) => {
        const blob = await (await fetch(await getFileUrl(f.path))).blob()
        return new File([blob], f.name, { type: f.type || blob.type })
      }))
      setHandoffFiles(files, c.displayName || c.email)
      toast.success('הקבצים נטענים למעבדה…')
      router.push('/app/automap')
    } catch (e) {
      toast.error('שגיאה בטעינה למעבדה: ' + (e as Error).message)
    } finally {
      setBusyUid(null)
    }
  }

  if (!isAdvisor) return null

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gold mb-1">📥 תיבת קליטה</h1>
          <p className="text-muted-txt text-sm">מסמכים שלקוחות העלו למיפוי. צפה/הורד, או פתח ישירות במעבדת ה‑AI.</p>
        </div>
        <button onClick={refresh} className="text-xs border border-line rounded-lg px-3 py-1.5 text-muted-txt hover:text-gold hover:border-gold/60 transition-colors">↻ רענן</button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt text-sm">טוען…</div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface2/50 p-10 text-center">
          <div className="text-4xl mb-2">📭</div>
          <p className="text-muted-txt text-sm">אף לקוח עדיין לא העלה מסמכים.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(c => {
            const isOpen = openUid === c.uid
            return (
              <div key={c.uid} className={`rounded-xl border bg-surface2 transition-colors ${isOpen ? 'border-gold/60' : 'border-line'}`}>
                <div className="p-4 flex items-center gap-3 flex-wrap">
                  <button onClick={() => setOpenUid(isOpen ? null : c.uid)} className="flex-1 min-w-0 text-right">
                    <div className="font-semibold text-txt truncate">{c.displayName || c.email || c.uid}</div>
                    <div className="text-xs text-muted-txt mt-0.5">{c.email} · {c.files.length} קבצים · עודכן {fmtDate(c.updatedAt)}</div>
                  </button>
                  <button
                    onClick={() => openInLab(c)}
                    disabled={busyUid === c.uid}
                    className="text-sm bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-3 py-1.5 font-semibold transition-colors disabled:opacity-50 shrink-0"
                  >
                    {busyUid === c.uid ? '⏳ טוען…' : '🧪 פתח במעבדה'}
                  </button>
                  <span className="text-gold text-lg w-5 text-center shrink-0">{isOpen ? '−' : '+'}</span>
                </div>

                {isOpen && (
                  <div className="border-t border-line p-4 space-y-4">
                    {/* Text / choice answers, in questionnaire order */}
                    {(() => {
                      const answered = INTAKE_QUESTIONS.filter(q => q.type !== 'file' && (c.answers[q.id] ?? '').trim())
                      return answered.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-muted-txt">תשובות</div>
                          {answered.map(q => (
                            <div key={q.id} className="text-sm bg-surface border border-line rounded-lg px-3 py-1.5">
                              <span className="text-muted-txt">{q.label}: </span>
                              <span className="text-txt whitespace-pre-wrap">{c.answers[q.id]}</span>
                            </div>
                          ))}
                        </div>
                      ) : null
                    })()}

                    {/* Uploaded files */}
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-muted-txt">קבצים ({c.files.length})</div>
                      {c.files.length === 0 ? (
                        <p className="text-xs text-muted-txt">לא הועלו קבצים.</p>
                      ) : c.files.map(f => (
                        <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-line">
                          <span className="text-lg shrink-0">{fileIcon(f.type, f.name)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-txt truncate">{f.name}</div>
                            <div className="text-[11px] text-muted-txt">
                              {f.questionLabel ? <span className="text-gold/80">{f.questionLabel} · </span> : null}
                              {fmtSize(f.size)} · {fmtDate(f.uploadedAt)}
                            </div>
                          </div>
                          <button onClick={() => viewFile(f)} className="text-xs border border-line rounded-lg px-2.5 py-1 text-muted-txt hover:text-gold hover:border-gold/60 transition-colors shrink-0">פתח</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
