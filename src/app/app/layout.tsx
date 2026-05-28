'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { SaveStatusBar } from '@/components/layout/SaveStatusBar'

type TabItem  = { href: string; emoji: string; label: string }
type TabGroup = { title: string; items: TabItem[] }

const groups: TabGroup[] = [
  {
    title: '',
    items: [
      { href: '/app/guide', emoji: '📖', label: 'מדריך' },
    ],
  },
  {
    title: 'דוחות',
    items: [
      { href: '/app/credit', emoji: '💳', label: 'אשראי' },
      { href: '/app/bank',   emoji: '🏦', label: 'עו"ש' },
      { href: '/app/import', emoji: '📥', label: 'ייבוא' },
    ],
  },
  {
    title: 'תקציב',
    items: [
      { href: '/app/mapping',     emoji: '🗂️', label: 'מיפוי' },
      { href: '/app/monthly/jan', emoji: '📅', label: 'חודשי' },
      { href: '/app/annual',      emoji: '📆', label: 'שנתי' },
      { href: '/app/trends',      emoji: '📊', label: 'מגמות' },
    ],
  },
  {
    title: 'כלים',
    items: [
      { href: '/app/checking', emoji: '💧', label: 'התנהלות עו"ש' },
      { href: '/app/goals',    emoji: '🎯', label: 'יעדים' },
      { href: '/app/loans',    emoji: '💰', label: 'הלוואות' },
      { href: '/app/compound', emoji: '📈', label: 'ריבית' },
    ],
  },
  {
    title: 'עסק',
    items: [
      { href: '/app/business', emoji: '🏢', label: 'תקציב עסקי' },
    ],
  },
  {
    title: 'ליווי',
    items: [
      { href: '/app/meetings', emoji: '📝', label: 'פגישות' },
    ],
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const [drawerOpen, setDrawerOpen] = useState(false)

  async function handleSignOut() {
    await signOut(auth)
  }

  function isActive(href: string) {
    if (href === '/app/monthly/jan') return pathname.startsWith('/app/monthly')
    return pathname === href
  }

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const navList = (
    <nav className="flex flex-col gap-0.5 p-3">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-0.5">
          {g.title && (
            <div className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-muted-txt/70 uppercase tracking-wider">
              {g.title}
            </div>
          )}
          {g.items.map(item => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-gold/15 text-gold font-semibold'
                    : 'text-txt/80 hover:bg-surface3 hover:text-txt',
                ].join(' ')}
              >
                <span className="text-base leading-none">{item.emoji}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex flex-col min-h-screen">

      {/* Header */}
      <header className="border-b border-line bg-surface2 px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-txt text-xl leading-none w-9 h-9 flex items-center justify-center rounded-lg border border-line hover:bg-surface3 hover:border-gold/60 transition-colors"
            aria-label="פתח תפריט"
          >
            ☰
          </button>
          <span className="font-bold text-gold tracking-wide truncate text-base sm:text-xl">
            <span className="hidden sm:inline">The Home Economist</span>
            <span className="sm:hidden">THE</span>
          </span>
          <span className="hidden sm:block"><SaveStatusBar /></span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <span className="sm:hidden"><SaveStatusBar /></span>
          {user && (
            <span className="text-xs text-muted-txt hidden md:block truncate max-w-[160px]">{user.email}</span>
          )}
          <button
            onClick={handleSignOut}
            className="text-xs sm:text-sm text-muted-txt hover:text-txt transition-colors whitespace-nowrap"
          >
            יציאה
          </button>
        </div>
      </header>

      {/* Drawer — opens on click, all screen sizes */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed top-0 bottom-0 right-0 w-72 max-w-[85vw] bg-surface2 border-l border-line z-50 overflow-y-auto flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-3 border-b border-line">
              <span className="font-bold text-gold">תפריט</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-txt text-lg leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface3 transition-colors"
                aria-label="סגור תפריט"
              >
                ✕
              </button>
            </div>
            {navList}
          </aside>
        </>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 p-3 sm:p-6">
        {children}
      </main>

    </div>
  )
}
