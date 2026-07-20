'use client'

import { SharingControl } from '@/components/client/SharingControl'

// A dedicated place for a client to view and change whether they share their
// data with their advisor. Additive route (no existing page touched). Surfacing
// it in the nav / home is a small follow-up.
export default function SharingPage() {
  return (
    <div className="max-w-xl mx-auto py-6 space-y-4">
      <h1 className="text-xl font-bold text-txt px-1">פרטיות ושיתוף</h1>
      <SharingControl
        emptyFallback={
          <div className="rounded-2xl border border-line bg-surface2 p-6 text-center text-muted-txt">
            אין ליועץ גישה לחשבון שלך. אתה עובד באופן עצמאי.
          </div>
        }
      />
    </div>
  )
}
