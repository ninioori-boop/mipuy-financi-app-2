'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ALL_CATEGORIES, CATEGORY_ICONS } from '@/lib/constants'

// Searchable category picker.
//
// The list is 40+ entries, so raw scrolling is slow. Three accelerators:
//  1. `suggested` chips at the top — the caller's most-likely categories (the
//     user's most-used, or a merchant's learned category) are ONE TAP away, no
//     typing. This is the fast path for the common case.
//  2. On phones we open a bottom SHEET with big touch targets instead of a tiny
//     anchored popover — far easier to tap with a thumb.
//  3. On phones we DON'T auto-focus the search box, so the soft keyboard doesn't
//     jump up for what is usually a single chip tap (search stays opt-in).
// Desktop keeps the compact anchored popover with the search auto-focused.
//
// Positioning (desktop): the popover is portaled to <body> with position:fixed
// because many hosts (tables, accordion panels) are inside overflow-y-auto
// containers that would clip a normally-positioned dropdown.

interface Props {
  value:        string
  onChange:     (category: string) => void
  /**
   * Visual style of the trigger:
   *  - 'chip'  — small inline pill (table rows)
   *  - 'badge' — slightly larger pill (matches CategoryBadge)
   *  - 'field' — full-width form input style
   *  - 'plain' — minimal trigger (used when wrapped by parent button look)
   */
  variant?:     'chip' | 'badge' | 'field' | 'plain'
  placeholder?: string
  className?:   string
  /** Open the popover immediately on mount (used by inline "edit" flows). */
  autoOpen?:    boolean
  onClose?:     () => void
  /**
   * One-tap chips shown ABOVE the list — the caller's most-likely categories
   * (most-used overall, and/or the merchant's learned category first). Invalid
   * or duplicate entries and the current value are filtered out; capped at 8.
   */
  suggested?:   string[]
}

const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'

// Hebrew-friendly substring matcher — strips spaces/punctuation so "ביטוח לאומי"
// matches when the user types "ביטוחלאומי" or "ביטוח" or "לאומי".
function normalize(s: string) {
  return s.toLowerCase().replace(/[\s\-_'"()/\\]/g, '')
}

export function CategoryPicker({
  value, onChange, variant = 'chip', placeholder = 'בחר קטגוריה…',
  className = '', autoOpen = false, onClose, suggested,
}: Props) {
  const [open, setOpen]           = useState(autoOpen)
  const [search, setSearch]       = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos]             = useState<{ top: number; right: number; width: number } | null>(null)
  const [isMobile, setIsMobile]   = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef     = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  // Parent can flip autoOpen from false→true to programmatically open.
  useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])

  // De-duped, valid suggested categories (drop the current value + unknowns), cap 8.
  const chips = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of suggested ?? []) {
      if (!c || c === value || seen.has(c) || !ALL_CATEGORIES.includes(c)) continue
      seen.add(c)
      out.push(c)
      if (out.length >= 8) break
    }
    return out
  }, [suggested, value])

  const filtered = useMemo(() => {
    const q = normalize(search.trim())
    if (!q) return ALL_CATEGORIES
    return ALL_CATEGORIES.filter(c => normalize(c).includes(q))
  }, [search])

  // Detect phone + (desktop only) compute the popover position — BEFORE paint so
  // there's no flash of the wrong layout. RTL-aware: anchor by the trigger's
  // right edge so the popover extends leftward (natural for Hebrew). Clamped to
  // the viewport (12px gutter so it doesn't kiss the edge on 320-360px phones).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
    setIsMobile(mobile)
    if (mobile) return
    const r = triggerRef.current.getBoundingClientRect()
    const M     = 12
    const POP_W = Math.min(280, window.innerWidth - M * 2)
    const POP_H = 320
    // visualViewport.height shrinks with the soft keyboard; keep the popover visible.
    const vh = window.visualViewport?.height ?? window.innerHeight
    let right = window.innerWidth - r.right
    if (right + POP_W > window.innerWidth - M) right = window.innerWidth - M - POP_W
    right = Math.max(M, right)
    let top = r.bottom + 4
    if (top + POP_H > vh - M) {
      const above = r.top - POP_H - 4
      if (above > M) top = above
    }
    setPos({ top, right, width: POP_W })
  }, [open])

  // Outside-tap + Esc close. Desktop also closes on scroll/resize (the popover is
  // anchored to the trigger and would otherwise detach). Mobile does NOT — the
  // sheet is bottom-fixed, and the search keyboard fires a visualViewport resize
  // we must ignore. Mobile outside-tap is handled by the backdrop's onClick.
  useEffect(() => {
    if (!open) return
    setSearch('')
    setHighlight(0)
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
    if (!mobile) requestAnimationFrame(() => inputRef.current?.focus())

    function onDocDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popRef.current?.contains(target)) return
      close()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    function onScroll(e: Event) {
      const target = e.target as Node | null
      if (target && popRef.current?.contains(target)) return
      close()
    }
    function onResize() { close() }

    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown',   onKey)
    if (!mobile) {
      document.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)
      window.visualViewport?.addEventListener('resize', onResize)
    }
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown',   onKey)
      document.removeEventListener('scroll',    onScroll, true)
      window.removeEventListener  ('resize',    onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setOpen(false)
    onClose?.()
  }

  function pick(cat: string) {
    onChange(cat)
    close()
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, Math.max(0, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cat = filtered[highlight]
      if (cat) pick(cat)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const triggerLabel = value
    ? <><span className="shrink-0">{icon(value)}</span><span className="truncate min-w-0">{value}</span></>
    : <span className="text-muted-txt truncate min-w-0">{placeholder}</span>

  const triggerClass = (() => {
    switch (variant) {
      case 'field':
        return `w-full flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt hover:border-gold/40 focus:outline-none focus:border-gold/60 ${className}`
      case 'badge':
        return `inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-txt hover:border-gold/50 transition-colors ${className}`
      case 'plain':
        return `inline-flex items-center gap-1 min-w-0 max-w-full bg-transparent text-sm text-txt hover:text-gold transition-colors ${className}`
      case 'chip':
      default:
        return `inline-flex items-center gap-1 rounded border border-line bg-surface2 px-1.5 py-0.5 text-xs text-muted-txt hover:border-gold/50 hover:text-txt transition-colors whitespace-nowrap ${className}`
    }
  })()

  // Shared inner content. `big` = larger touch targets for the mobile sheet.
  // A plain function (not a component) so the search input never remounts mid-typing.
  function panel(big: boolean) {
    return (
      <>
        {chips.length > 0 && (
          <div className="p-2 border-b border-line flex flex-wrap gap-1.5">
            {chips.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => pick(c)}
                className={`inline-flex items-center gap-1.5 rounded-full border transition-colors ${
                  big ? 'px-3.5 py-3 text-sm' : 'px-2.5 py-1 text-xs'
                } ${
                  c === value
                    ? 'border-gold bg-gold/15 text-gold'
                    : 'border-line bg-surface3 text-txt hover:border-gold/50'
                }`}
              >
                <span>{icon(c)}</span>
                <span>{c}</span>
              </button>
            ))}
          </div>
        )}
        <div className="p-2 border-b border-line">
          <input
            ref={inputRef}
            value={search}
            onChange={e => { setSearch(e.target.value); setHighlight(0) }}
            onKeyDown={onInputKey}
            placeholder="חיפוש קטגוריה…"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
          />
        </div>
        <div className={`overflow-y-auto py-1 ${big ? 'flex-1' : 'max-h-64'}`}>
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-txt">אין תוצאות</div>
          ) : (
            filtered.map((c, i) => {
              const isCurrent = c === value
              const isHi      = i === highlight
              return (
                <button
                  key={c}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(c)}
                  className={[
                    `w-full flex items-center gap-2 px-3 text-start ${big ? 'py-3 text-[15px]' : 'py-2.5 text-sm'}`,
                    isHi      ? 'bg-gold/15'               : 'hover:bg-surface3',
                    isCurrent ? 'text-gold font-semibold' : 'text-txt',
                  ].join(' ')}
                >
                  <span className="text-base shrink-0">{icon(c)}</span>
                  <span className="flex-1 truncate">{c}</span>
                  {isCurrent && <span className="text-gold text-xs">✓</span>}
                </button>
              )
            })
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={triggerClass}
      >
        {variant === 'field' ? (
          <>
            <span className="flex-1 min-w-0 truncate text-start flex items-center gap-2">{triggerLabel}</span>
            <span className="shrink-0 text-muted-txt text-xs">▼</span>
          </>
        ) : (
          <>
            {triggerLabel}
            <span className="shrink-0 text-muted-txt text-[10px] ms-0.5">▼</span>
          </>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        isMobile ? (
          <div className="fixed inset-0 z-[60] flex flex-col justify-end" dir="rtl">
            <div className="absolute inset-0 bg-black/50" onClick={close} />
            <div
              ref={popRef}
              className="relative rounded-t-2xl border-t border-line bg-surface2 shadow-xl shadow-black/50 max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
                <span className="text-sm font-semibold text-txt">בחירת קטגוריה</span>
                <button
                  type="button"
                  onClick={close}
                  className="text-muted-txt hover:text-txt text-lg leading-none w-11 h-11 flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
              {panel(true)}
            </div>
          </div>
        ) : (
          pos && (
            <div
              ref={popRef}
              dir="rtl"
              style={{ position: 'fixed', top: pos.top, right: pos.right, width: pos.width }}
              className="z-[60] rounded-lg border border-line bg-surface2 shadow-xl shadow-black/50 overflow-hidden"
            >
              {panel(false)}
            </div>
          )
        ),
        document.body,
      )}
    </>
  )
}
