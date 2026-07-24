'use client'

import { createPortal } from 'react-dom'
import type { DismissReason } from '@/stores/subscriptionPrefsStore'

// Bottom sheet with the two actions on a detected subscription. Mirrors
// EditEntrySheet's portal+backdrop so it feels native on a phone.

interface Props {
  name:      string
  onChoose:  (reason: DismissReason) => void
  onClose:   () => void
}

export function SubscriptionActionSheet({ name, onChoose, onClose }: Props) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[55] flex flex-col justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative rounded-t-2xl border-t border-line bg-surface2 shadow-xl shadow-black/50 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="min-w-0 flex-1 text-sm font-semibold text-txt truncate">{name}</span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-txt hover:text-txt text-lg leading-none w-11 h-11 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          <button
            onClick={() => onChoose('cancelled')}
            className="w-full text-start rounded-xl border border-line bg-surface px-4 py-3 min-h-[52px] hover:border-gold/50 hover:bg-surface3 transition-colors"
          >
            <span className="block text-base font-semibold text-txt">✅ ביטלתי את המנוי</span>
            <span className="block text-sm text-muted-txt">להסיר מהרשימה. כבר לא משלם עליו.</span>
          </button>

          <button
            onClick={() => onChoose('not-sub')}
            className="w-full text-start rounded-xl border border-line bg-surface px-4 py-3 min-h-[52px] hover:border-gold/50 hover:bg-surface3 transition-colors"
          >
            <span className="block text-base font-semibold text-txt">🚫 זה לא מנוי</span>
            <span className="block text-sm text-muted-txt">להסיר, ולא לזהות את העסק הזה כמנוי שוב.</span>
          </button>

          <button
            onClick={onClose}
            className="w-full rounded-xl border border-line bg-transparent px-4 py-3 min-h-[44px] text-sm text-muted-txt hover:text-txt transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
