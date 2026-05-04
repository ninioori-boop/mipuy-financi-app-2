'use client'

import { useState, useEffect } from 'react'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('cookie_consent')) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem('cookie_consent', 'accepted')
    setVisible(false)
  }

  function decline() {
    localStorage.setItem('cookie_consent', 'declined')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4">
      <div className="max-w-3xl mx-auto rounded-xl border border-line bg-surface2 shadow-2xl px-5 py-4 flex items-center gap-4 flex-wrap">
        <p className="flex-1 text-sm text-muted-txt min-w-[200px]">
          אנו משתמשים באחסון מקומי (Cookies ו-localStorage) לצורך התחברות לשירות בלבד.
          אין שימוש בעוגיות פרסום או מעקב.{' '}
          <a href="/privacy" target="_blank" className="text-gold hover:underline">מדיניות פרטיות</a>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={decline}
            className="px-4 py-2 rounded-lg border border-line text-muted-txt text-sm hover:text-txt hover:border-gold/40 transition-colors"
          >
            דחייה
          </button>
          <button
            onClick={accept}
            className="px-5 py-2 rounded-lg bg-gold text-surface text-sm font-semibold hover:bg-gold-light transition-colors"
          >
            אישור ✓
          </button>
        </div>
      </div>
    </div>
  )
}
