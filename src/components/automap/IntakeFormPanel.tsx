'use client'

// The automap lab's INPUT — the questionnaire, not a dropzone.
//
// The lab used to open with a single "drag everything here" box. That made the
// FILE FORMAT the source of truth for what a file means, and the format cannot
// carry that: an .xlsx is an .xlsx whether it holds a bank statement or a credit
// export, which is exactly how a salary deposit came to be counted as an expense.
//
// Here every question is its own slot. A file dropped into "דוח עו\"ש שלושה
// חודשים" is KNOWN to be a bank statement before it is ever parsed.
//
// Three questions are small tables rather than boxes, and each one replaced a
// document upload (2026-08-11). Income is three months per earner; הר הכסף is a
// product, a balance and two fees, repeated; assets are a name and a value,
// repeated. A text box would have flattened each of those into a sentence that
// something downstream then has to parse — which is the step that kept losing
// the number.
//
// Lab-only. The live client form is untouched.

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  groupIntakeQuestions, type LabQuestion, type LabColumn, type IntakeRow,
} from '@/lib/automapIntake'

export interface IntakeFormPanelProps {
  answers:   Record<string, string>
  onAnswer:  (id: string, value: string) => void
  /** Table answers, by question id. */
  rows:      Record<string, IntakeRow[]>
  onRows:    (id: string, rows: IntakeRow[]) => void
  /** Files chosen for one question — the caller tags and parses them. */
  onFiles:   (files: File[], questionId: string) => void
  /** question id → names of the files already attached to it. */
  attached:  Record<string, string[]>
  onRemoveAttached: (questionId: string, name: string) => void
  parseStatus: Record<string, 'parsing' | 'done' | 'failed'>
  disabled?: boolean
}

const inputCls =
  'bg-surface border border-line rounded-lg px-3 py-1.5 text-sm text-txt ' +
  'placeholder:text-muted-txt/50 focus:outline-none focus:border-gold/60 transition-colors'

const cellCls =
  'bg-surface border border-line rounded-md px-2 py-1 text-sm text-txt w-full min-w-0 ' +
  'placeholder:text-muted-txt/40 focus:outline-none focus:border-gold/60 transition-colors'

/** Does this table hold anything at all? Drives the filled dot. */
const hasRowData = (rows: IntakeRow[] = []) =>
  rows.some(r => Object.values(r).some(v => String(v ?? '').trim()))

/**
 * A repeatable entry — one framed box per item, every field carrying its own
 * question above it.
 *
 * It was a bare grid with a single header strip, and Ori's answer to that was
 * "שיופיע מסגרת עם שאלה מה דמי הניהול מההפקדה ומה מהצבירה". He is right: a
 * header abbreviated to fit a 7rem column ("ד.ניהול מצבירה") is not a question,
 * and two adjacent percent boxes with cryptic headers are an invitation to type
 * the number into the wrong one. Whether a fee comes off the balance or off the
 * deposit is the whole point of asking.
 *
 * ⚠️ Every track is minmax(0,…). A grid column defaults to min-content, so a
 * long product name pushes its track past its share and the next one lands on
 * top of it — precisely the "המסגרות אחת על השנייה" from the income panel.
 */
function RowsEditor({
  q, rows, onRows, disabled,
}: { q: LabQuestion; rows: IntakeRow[]; onRows: (rows: IntakeRow[]) => void; disabled?: boolean }) {
  const cols: LabColumn[] = q.columns ?? []
  const inline  = cols.filter(c => c.kind !== 'detail')
  const details = cols.filter(c => c.kind === 'detail')
  // Always one entry to type into, without making the advisor press + first.
  const display = rows.length ? rows : [{}]

  const setCell = (i: number, key: string, v: string) => {
    const next = display.map(r => ({ ...r }))
    next[i] = { ...next[i], [key]: v }
    onRows(next)
  }
  const removeRow = (i: number) => onRows(display.filter((_, j) => j !== i))

  const numeric = (c: LabColumn) => c.kind === 'money' || c.kind === 'percent'
  const track = (c: LabColumn) => (numeric(c) ? 'minmax(0,9rem)' : 'minmax(0,1.4fr)')
  // Stacked on a phone, side by side from sm up. The tracks vary per question,
  // so they arrive as a custom property rather than a Tailwind class.
  const colStyle = { '--cols': inline.map(track).join(' ') } as CSSProperties

  return (
    <div className="space-y-2">
      {display.map((row, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface2/40 p-2 space-y-2">
          <div className="flex items-start gap-2">
            <div className="grid gap-2 grow min-w-0 sm:[grid-template-columns:var(--cols)]" style={colStyle}>
              {inline.map(c => (
                <label key={c.key} className="min-w-0 block">
                  <span className="block text-[11px] text-muted-txt mb-0.5">{c.label}</span>
                  <input
                    type="text"
                    inputMode={c.kind === 'money' ? 'numeric' : c.kind === 'percent' ? 'decimal' : undefined}
                    dir={numeric(c) ? 'ltr' : undefined}
                    value={row[c.key] ?? ''}
                    placeholder={c.placeholder}
                    disabled={disabled}
                    onChange={e => setCell(i, c.key, e.target.value)}
                    className={`${cellCls} ${numeric(c) ? 'text-end tabular-nums' : ''}`}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={disabled || display.length === 1}
              aria-label="הסר שורה"
              className="mt-5 size-6 shrink-0 flex items-center justify-center rounded text-muted-txt hover:text-expense hover:bg-line/40 transition-colors disabled:opacity-25 disabled:hover:text-muted-txt disabled:hover:bg-transparent"
            >×</button>
          </div>

          {details.map(c => (
            <label key={c.key} className="block">
              <span className="block text-[11px] text-muted-txt mb-0.5">{c.label}</span>
              <textarea
                rows={2}
                value={row[c.key] ?? ''}
                placeholder={c.placeholder}
                disabled={disabled}
                onChange={e => setCell(i, c.key, e.target.value)}
                className={`${cellCls} leading-relaxed`}
              />
            </label>
          ))}
        </div>
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onRows([...display, {}])}
        className="rounded-lg border border-dashed border-line px-2.5 py-1 text-xs text-muted-txt hover:border-gold/50 hover:text-gold transition-colors disabled:opacity-50"
      >+ {q.addLabel ?? 'הוסף שורה'}</button>
    </div>
  )
}

/** A single question row: label on one side, its input on the other. */
function QuestionRow({
  q, answers, onAnswer, rows, onRows, onFiles, attached, onRemoveAttached, parseStatus, disabled,
}: IntakeFormPanelProps & { q: LabQuestion }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const value = answers[q.id] ?? ''
  const files = attached[q.id] ?? []
  const filled =
    q.type === 'file' ? files.length > 0
    : q.type === 'rows' ? hasRowData(rows[q.id])
    : value.trim().length > 0

  const label = (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5">
        <span className={`mt-1 size-1.5 shrink-0 rounded-full ${filled ? 'bg-income' : 'bg-line'}`} />
        <label className="text-sm text-txt leading-snug">
          {q.label}
          {q.required && <span className="text-gold/70"> *</span>}
        </label>
      </div>
      {q.hint && <div className="ps-3 text-xs text-muted-txt/70 leading-snug">{q.hint}</div>}
    </div>
  )

  // A table needs the full width; squeezing four columns into the 20rem answer
  // track is how columns end up overlapping.
  if (q.type === 'rows') {
    return (
      <div className="py-2 space-y-2">
        {label}
        <RowsEditor q={q} rows={rows[q.id] ?? []} onRows={r => onRows(q.id, r)} disabled={disabled} />
      </div>
    )
  }

  return (
    <div className="grid gap-1.5 sm:grid-cols-[1fr_minmax(0,20rem)] sm:items-start sm:gap-3 py-2">
      {label}

      <div className="min-w-0">
        {q.type === 'file' ? (
          <div className="space-y-1.5">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,image/*"
              className="hidden"
              onChange={e => {
                const input = e.currentTarget
                const fs = Array.from(input.files ?? [])
                input.value = ''
                if (fs.length) onFiles(fs, q.id)
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-line bg-surface px-3 py-1.5 text-xs text-muted-txt hover:border-gold/50 hover:text-gold transition-colors disabled:opacity-50"
            >
              📎 {files.length ? 'צרף עוד' : 'צרף קובץ'}
            </button>
            {files.map(name => {
              const status = parseStatus[name]
              return (
                <div key={name} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                  <span className="shrink-0">
                    {status === 'parsing'
                      ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-gold border-t-transparent align-middle" />
                      : status === 'failed' ? '✗' : '✓'}
                  </span>
                  <span className={`truncate ${status === 'failed' ? 'text-expense' : 'text-txt'}`}>{name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttached(q.id, name)}
                    aria-label={`הסר ${name}`}
                    className="ms-auto shrink-0 size-5 flex items-center justify-center rounded text-muted-txt hover:text-expense hover:bg-line/40 transition-colors"
                  >×</button>
                </div>
              )
            })}
          </div>
        ) : q.type === 'choice' ? (
          <div className="flex gap-1.5">
            {(q.choices ?? []).map(c => (
              <button
                key={c}
                type="button"
                disabled={disabled}
                onClick={() => onAnswer(q.id, value === c ? '' : c)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  value === c
                    ? 'border-gold/50 bg-gold/15 text-gold font-semibold'
                    : 'border-line bg-surface text-muted-txt hover:text-txt hover:border-gold/40'
                }`}
              >{c}</button>
            ))}
          </div>
        ) : q.type === 'paragraph' ? (
          <textarea
            value={value}
            disabled={disabled}
            rows={2}
            onChange={e => onAnswer(q.id, e.target.value)}
            className={`${inputCls} w-full leading-relaxed`}
          />
        ) : (
          <input
            type={q.type === 'phone' ? 'tel' : 'text'}
            value={value}
            disabled={disabled}
            onChange={e => onAnswer(q.id, e.target.value)}
            className={`${inputCls} w-full`}
          />
        )}
      </div>
    </div>
  )
}

export default function IntakeFormPanel(props: IntakeFormPanelProps) {
  const { answers, attached, rows } = props
  const groups = useMemo(() => groupIntakeQuestions(), [])
  const [open, setOpen] = useState(true)

  // Progress, counted the same way the row dots are lit, so the header and the
  // rows can never disagree.
  const { answered, total, fileCount } = useMemo(() => {
    let answered = 0, total = 0, fileCount = 0
    for (const g of groups) for (const q of g.questions) {
      total++
      if (q.type === 'file') {
        const n = (attached[q.id] ?? []).length
        fileCount += n
        if (n) answered++
      } else if (q.type === 'rows') {
        if (hasRowData(rows[q.id])) answered++
      } else if ((answers[q.id] ?? '').trim()) answered++
    }
    return { answered, total, fileCount }
  }, [groups, answers, attached, rows])

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-surface2/60 transition-colors"
      >
        <span className="text-base">📋</span>
        <span className="text-sm font-semibold text-txt">שאלון הנתונים</span>
        <span className="text-xs text-muted-txt">
          {answered}/{total} מולאו{fileCount > 0 && ` · ${fileCount} קבצים`}
        </span>
        <span className="ms-auto text-xs text-muted-txt">{open ? '▲' : '▼'}</span>
      </button>

      {/* A thin, honest progress bar — how much of the questionnaire is answered,
          which is a far better predictor of mapping quality than file count. */}
      <div className="h-1 bg-line/60">
        <div className="h-full bg-gold/70 transition-all duration-300"
          style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
      </div>

      {open && (
        <div className="px-3 py-2 space-y-4">
          {groups.map(g => (
            <div key={g.title}>
              <div className="text-xs font-semibold text-gold/80 border-b border-line pb-1 mb-1">{g.title}</div>
              <div className="divide-y divide-line/50">
                {g.questions.map(q => <QuestionRow key={q.id} {...props} q={q} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
