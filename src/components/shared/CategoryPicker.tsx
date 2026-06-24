'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ALL_CATEGORIES, CATEGORY_ICONS } from '@/lib/constants'

// Searchable category picker.
//
// Why custom (not <select> + datalist): the category list is 40+ entries, the
// advisor often knows the first 2-3 letters, and the native dropdown forces
// scrolling all the way down. We render a popover with a search box on top
// and substring-match against the visible Hebrew name. Open behavior is
// controllable so existing "click chip to edit" flows still work.
//
// Positioning: the popover is portaled to <body> with position:fixed because
// many of the places this lives (transaction tables, accordion panels) are
// inside overflow-y-auto containers that would otherwise clip the dropdown.

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
}

const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'

// Hebrew-friendly substring matcher — strips spaces/punctuation so "ביטוח לאומי"
// matches when the advisor types "ביטוחלאומי" or "ביטוח" or "לאומי".
function normalize(s: string) {
  return s.toLowerCase().replace(/[\s\-_'"()/\\]/g, '')
}

export function CategoryPicker({
  value, onChange, variant = 'chip', placeholder = 'בחר קטגוריה…',
  className = '', autoOpen = false, onClose,
}: Props) {
  const [open, setOpen]           = useState(autoOpen)
  const [search, setSearch]       = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos]             = useState<{ top: number; right: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef     = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  // Parent can flip autoOpen from false→true to programmatically open.
  useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])

  const filtered = useMemo(() => {
    const q = normalize(search.trim())
    if (!q) return ALL_CATEGORIES
    return ALL_CATEGORIES.filter(c => normalize(c).includes(q))
  }, [search])

  // Compute popover screen position relative to the trigger. RTL-aware: we
  // anchor by the trigger's right edge so the popover extends leftward
  // (in the natural text-flow direction for Hebrew). Clamped to viewport.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    // 12px gutter on each side so the picker doesn't kiss the screen edge on
    // narrow phones (320-360px).
    const M     = 12
    const POP_W = Math.min(280, window.innerWidth - M * 2)
    const POP_H = 320
    // Use visualViewport.height when available — when the mobile soft keyboard
    // is up, layout-viewport height stays full-screen but visual-viewport
    // shrinks, and we want the popover to fit in the visible area.
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

  // Outside-click + Esc closes; scroll on any ancestor closes (popover would
  // otherwise visually detach from its trigger as the page scrolls).
  useEffect(() => {
    if (!open) return
    setSearch('')
    setHighlight(0)
    requestAnimationFrame(() => inputRef.current?.focus())

    function onDocDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popRef.current?.contains(target)) return
      close()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    function onScroll() { close() }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown',   onKey)
    document.addEventListener('scroll',    onScroll, true)
    window.addEventListener  ('resize',    onScroll)
    // Mobile soft-keyboard appearing shrinks visualViewport without firing a
    // regular resize. Closing the picker is the conservative choice — the
    // popover would otherwise hide behind the keyboard.
    window.visualViewport?.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown',   onKey)
      document.removeEventListener('scroll',    onScroll, true)
      window.removeEventListener  ('resize',    onScroll)
      window.visualViewport?.removeEventListener('resize', onScroll)
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
    ? <><span>{icon(value)}</span><span className="truncate">{value}</span></>
    : <span className="text-muted-txt truncate">{placeholder}</span>

  const triggerClass = (() => {
    switch (variant) {
      case 'field':
        return `w-full flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt hover:border-gold/40 focus:outline-none focus:border-gold/60 ${className}`
      case 'badge':
        return `inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-txt hover:border-gold/50 transition-colors ${className}`
      case 'plain':
        return `inline-flex items-center gap-1 bg-transparent text-sm text-txt hover:text-gold transition-colors ${className}`
      case 'chip':
      default:
        return `inline-flex items-center gap-1 rounded border border-line bg-surface2 px-1.5 py-0.5 text-xs text-muted-txt hover:border-gold/50 hover:text-txt transition-colors whitespace-nowrap ${className}`
    }
  })()

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
            <span className="flex-1 truncate text-start flex items-center gap-2">{triggerLabel}</span>
            <span className="text-muted-txt text-xs">▼</span>
          </>
        ) : (
          <>
            {triggerLabel}
            <span className="text-muted-txt text-[10px] ms-0.5">▼</span>
          </>
        )}
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          dir="rtl"
          style={{ position: 'fixed', top: pos.top, right: pos.right, width: pos.width }}
          className="z-[60] rounded-lg border border-line bg-surface2 shadow-xl shadow-black/50 overflow-hidden"
        >
          <div className="p-2 border-b border-line">
            <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setHighlight(0) }}
              onKeyDown={onInputKey}
              placeholder="חיפוש קטגוריה…"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
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
                      'w-full flex items-center gap-2 px-3 py-2.5 text-sm text-start',
                      isHi      ? 'bg-gold/15'         : 'hover:bg-surface3',
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
        </div>,
        document.body,
      )}
    </>
  )
}
