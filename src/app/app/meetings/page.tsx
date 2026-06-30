'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useMeetingsStore, MEETING_LABELS, type MeetingType, type Meeting } from '@/stores/meetingsStore'

const TYPES: MeetingType[] = ['mapping', 'budget', 'review', 'plan']

const TYPE_ICON: Record<MeetingType, string> = {
  mapping: '🗂️',
  budget:  '📅',
  review:  '🔍',
  plan:    '📆',
}

const TYPE_COLOR: Record<MeetingType, string> = {
  mapping: 'text-blue-300',
  budget:  'text-emerald-300',
  review:  'text-amber-300',
  plan:    'text-purple-300',
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export default function MeetingsPage() {
  const { meetings, add, update, remove } = useMeetingsStore()
  const [filter, setFilter] = useState<MeetingType | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const list = filter === 'all' ? meetings : meetings.filter(m => m.type === filter)
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
  }, [meetings, filter])

  const opened = openId ? meetings.find(m => m.id === openId) ?? null : null

  function handleAdd(type: MeetingType) {
    const id = add(type)
    setOpenId(id)
  }

  function handleDelete(m: Meeting) {
    if (!confirm(`למחוק את "${m.title}"?`)) return
    if (openId === m.id) setOpenId(null)
    remove(m.id)
    toast.success('הפגישה נמחקה')
  }

  async function handleExport(m: Meeting) {
    try {
      setExportingId(m.id)
      const { exportMeetingPdf } = await import('@/lib/exportMeetingPdf')
      await exportMeetingPdf(m)
      toast.success('PDF הופק')
    } catch (e) {
      console.error(e)
      toast.error('שגיאה בהפקת PDF')
    } finally {
      setExportingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gold">📝 סיכומי פגישות</h1>
            <p className="text-muted-txt text-sm mt-0.5">תיעוד תהליך הליווי — לפי סוג פגישה</p>
          </div>
        </div>

        {/* Create buttons */}
        <div className="flex flex-wrap gap-2">
          {TYPES.map(t => (
            <button
              key={t}
              onClick={() => handleAdd(t)}
              className="text-xs sm:text-sm bg-surface border border-line hover:border-gold/60 hover:text-gold rounded-lg px-3 py-2.5 min-h-[44px] inline-flex items-center text-txt font-medium transition-colors"
            >
              + {TYPE_ICON[t]} {MEETING_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5 items-center pt-2 border-t border-line">
          <span className="text-xs text-muted-txt ms-1">סינון:</span>
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === 'all'
                ? 'bg-gold/20 text-gold border-gold/40'
                : 'bg-surface text-muted-txt border-line hover:text-txt'
            }`}
          >
            הכל ({meetings.length})
          </button>
          {TYPES.map(t => {
            const count = meetings.filter(m => m.type === t).length
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filter === t
                    ? 'bg-gold/20 text-gold border-gold/40'
                    : 'bg-surface text-muted-txt border-line hover:text-txt'
                }`}
              >
                {TYPE_ICON[t]} {MEETING_LABELS[t]} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface2/50 p-10 text-center">
          <div className="text-4xl mb-2">📝</div>
          <p className="text-muted-txt text-sm">
            {meetings.length === 0
              ? 'אין עדיין סיכומי פגישות. בחרי סוג פגישה למעלה כדי להתחיל.'
              : 'אין פגישות מסוג זה.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(m => {
            const isOpen = openId === m.id
            return (
              <div
                key={m.id}
                className={`rounded-xl border bg-surface2 transition-colors ${
                  isOpen ? 'border-gold/60' : 'border-line'
                }`}
              >
                {/* Card header */}
                <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
                  <button
                    onClick={() => setOpenId(isOpen ? null : m.id)}
                    className="flex-1 min-w-0 text-start"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full bg-surface border border-line ${TYPE_COLOR[m.type]}`}>
                        {TYPE_ICON[m.type]} {MEETING_LABELS[m.type]}
                      </span>
                      <span className="text-xs text-muted-txt">{formatDate(m.date)}</span>
                    </div>
                    <h3 className="font-semibold text-txt mt-1.5 truncate">{m.title}</h3>
                    {!isOpen && (
                      <p className="text-xs text-muted-txt mt-1 line-clamp-2 whitespace-pre-line">
                        {m.summary.slice(0, 200) || '—'}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleExport(m)}
                      disabled={exportingId === m.id}
                      className="text-xs bg-surface border border-line hover:border-gold/60 hover:text-gold rounded-lg px-2.5 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-txt transition-colors disabled:opacity-50"
                      title="ייצוא PDF"
                    >
                      {exportingId === m.id ? '⏳' : '📄'}
                    </button>
                    <button
                      onClick={() => handleDelete(m)}
                      className="text-xs bg-surface border border-line hover:border-expense/60 hover:text-expense rounded-lg px-2.5 py-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-txt transition-colors"
                      title="מחיקה"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* Editor */}
                {isOpen && (
                  <div className="border-t border-line p-4 space-y-4">
                    <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
                      <div>
                        <label className="text-xs font-semibold text-muted-txt">כותרת</label>
                        <input
                          value={m.title}
                          onChange={e => update(m.id, { title: e.target.value })}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-txt">תאריך</label>
                        <input
                          type="date"
                          value={m.date}
                          onChange={e => update(m.id, { date: e.target.value })}
                          style={{ direction: 'ltr' }}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 mt-1"
                        />
                      </div>
                    </div>

                    {m.type === 'mapping' && (
                      <div>
                        <label className="text-xs font-semibold text-blue-300">📌 נקודות לקראת הפגישה</label>
                        <textarea
                          value={m.prepNotes ?? ''}
                          onChange={e => update(m.id, { prepNotes: e.target.value })}
                          rows={6}
                          className="w-full rounded-lg border border-blue-300/30 bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-blue-300/60 mt-1 leading-relaxed whitespace-pre-wrap"
                          placeholder="נקודות שעלו מהמיפוי — נושאים לבדוק ולהעלות מול הלקוח בפגישה…"
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-xs font-semibold text-muted-txt">מה היה בפגישה</label>
                      <textarea
                        value={m.summary}
                        onChange={e => update(m.id, { summary: e.target.value })}
                        rows={10}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 mt-1 leading-relaxed whitespace-pre-wrap"
                        placeholder="כתבו כאן מה היה בפגישה…"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-txt">מסקנות מהפגישה</label>
                      <textarea
                        value={m.actionItems}
                        onChange={e => update(m.id, { actionItems: e.target.value })}
                        rows={7}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 mt-1 leading-relaxed whitespace-pre-wrap"
                        placeholder="כתבו כאן את המסקנות מהפגישה…"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-txt">משימות לפגישה הבאה</label>
                      <textarea
                        value={m.nextSteps ?? ''}
                        onChange={e => update(m.id, { nextSteps: e.target.value })}
                        rows={6}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 mt-1 leading-relaxed whitespace-pre-wrap"
                        placeholder="כתבו כאן את המשימות לפגישה הבאה…"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
                      <div className="flex flex-col text-[11px] text-muted-txt leading-tight">
                        <span>נוצר: {new Date(m.createdAt).toLocaleString('he-IL')}</span>
                        <span>עודכן: {new Date(m.updatedAt).toLocaleString('he-IL')}</span>
                      </div>
                      <button
                        onClick={() => {
                          setOpenId(null)
                          toast.success('סיכום הפגישה נשמר')
                        }}
                        className="text-sm bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-5 py-2 font-semibold transition-colors"
                      >
                        ✓ סיום
                      </button>
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
