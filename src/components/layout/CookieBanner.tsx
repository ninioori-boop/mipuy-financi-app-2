'use client'

import { useState, useEffect } from 'react'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('cookie_consent')) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem('cookie_consent', '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4">
      <div className="max-w-3xl mx-auto rounded-xl border border-line bg-surface2 shadow-2xl px-5 py-4 flex items-center gap-4 flex-wrap">
        <p className="flex-1 text-sm text-muted-txt min-w-[200px]">
          אנו משתמשים בעוגיות הכרחיות לצורך התחברות לשירות בלבד.
          אין שימוש בעוגיות פרסום או מעקב.{' '}
          <a href="/privacy" target="_blank" className="text-gold hover:underline">מדיניות פרטיות</a>
        </p>
        <button
          onClick={accept}
          className="shrink-0 px-5 py-2 rounded-lg bg-gold text-surface text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          הבנתי ✓
        </button>
      </div>
    </div>
  )
}
