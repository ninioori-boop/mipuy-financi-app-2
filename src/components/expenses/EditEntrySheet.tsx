'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CategoryPicker } from '@/components/shared/CategoryPicker'

// Full edit of an existing expense entry — amount / category / date / note — in a
// mobile bottom sheet (the store already supports update(); this was the missing
// UI). Mirrors CategoryPicker's portal+backdrop so it feels native on a phone.

interface Entry {
  id:       string
  amount:   number
  category: string
  date:     string
  note:     string
}

interface Props {
  entry:      Entry
  suggested?: string[]
  onSave:     (patch: { amount: number; category: string; date: string; note: string }) => void
  onClose:    () => void
}

// ' #<ref>' marks an auto-captured charge — the inbox dedup and the review filter
// both key on it. Never let a note edit drop it: edit only the human part and
// re-append the suffix on save.
const REF_SUFFIX = / #\S+$/

export function EditEntrySheet({ entry, suggested, onSave, onClose }: Props) {
  const suffix = entry.note.match(REF_SUFFIX)?.[0] ?? ''
  const body   = suffix ? entry.note.slice(0, entry.note.length - suffix.length) : entry.note

  const [amount, setAmount]     = useState(String(entry.amount))
  const [category, setCategory] = useState(entry.category)
  const [date, setDate]         = useState(entry.date)
  const [note, setNote]         = useState(body)

  function save() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return   // invalid — keep the sheet open
    onSave({ amount: Math.round(amt), category, date, note: (note.trim() + suffix).trim() })
    onClose()
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[55] flex flex-col justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative rounded-t-2xl border-t border-line bg-surface2 shadow-xl shadow-black/50 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="text-sm font-semibold text-txt">עריכת הוצאה</span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-txt hover:text-txt text-lg leading-none w-11 h-11 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">סכום ₪</label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 min-h-[44px] text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">קטגוריה</label>
            <CategoryPicker value={category} onChange={setCategory} suggested={suggested} variant="field" />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 min-h-[44px] text-sm text-txt focus:outline-none focus:border-gold/60"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">הערה</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              placeholder="הערה (לא חובה)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 min-h-[44px] text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            {suffix && <p className="text-[10px] text-muted-txt">🔗 מזהה הקליטה האוטומטית יישמר</p>}
          </div>

          <button
            onClick={save}
            className="w-full bg-gold text-surface font-bold rounded-xl px-5 py-3 min-h-[44px] hover:bg-gold-light transition-colors mt-1"
          >
            שמור
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
