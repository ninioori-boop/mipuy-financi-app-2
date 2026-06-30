'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { hasLabAccess } from '@/lib/labAccess'
import { SaveStatusBar } from '@/components/layout/SaveStatusBar'

// Curated client-mobile tab set (shown in the in-app WebView's bottom nav).
// Business tabs are appended only when the client has a business. Annual is
// intentionally excluded until its mobile pass is done.
const CLIENT_TABS = [
  { href: '/app/expenses',    emoji: '🧾', label: 'הוצאות' },
  { href: '/app/monthly/jan', emoji: '📅', label: 'חודשי' },
  { href: '/app/trends',      emoji: '📊', label: 'מגמות' },
  { href: '/app/goals',       emoji: '🎯', label: 'יעדים' },
  { href: '/app/meetings',    emoji: '📝', label: 'פגישות' },
]
const BUSINESS_TAB = { href: '/app/business', emoji: '🏢', label: 'עסק' }

type TabItem  = { href: string; emoji: string; label: string; advisorOnly?: boolean }
type TabGroup = { title: string; items: TabItem[] }

const groups: TabGroup[] = [
  {
    title: '',
    items: [
      { href: '/app/guide',        emoji: '📖', label: 'מדריך' },
      { href: '/app/upload-guide', emoji: '📋', label: 'משימות למיפוי' },
      { href: '/app/intake',       emoji: '📤', label: 'העלאת מסמכים' },
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
      { href: '/app/expenses', emoji: '🧾', label: 'תיעוד הוצאות' },
      { href: '/app/checking', emoji: '💧', label: 'התנהלות עו"ש' },
      { href: '/app/goals',    emoji: '🎯', label: 'יעדים' },
      { href: '/app/loans',    emoji: '💰', label: 'הלוואות' },
      { href: '/app/compound', emoji: '📈', label: 'ריבית' },
    ],
  },
  {
    title: 'עסק',
    items: [
      { href: '/app/business',        emoji: '🏢', label: 'תקציב עסקי' },
      { href: '/app/business/annual', emoji: '📆', label: 'שנתי עסקי' },
    ],
  },
  {
    title: 'ליווי',
    items: [
      { href: '/app/meetings', emoji: '📝', label: 'פגישות' },
    ],
  },
  {
    title: 'מעבדה',
    items: [
      { href: '/app/automap',          emoji: '🧪', label: 'מיפוי AI',   advisorOnly: true },
      { href: '/app/transaction-test', emoji: '💳', label: 'קליטת עסקה', advisorOnly: true },
    ],
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Embed mode: set by the Android in-app WebView (/connect/expenses bootstrap).
  // Hides all app chrome so only the tab content shows — a clean "expenses only"
  // view, 1:1 with the web. Normal web users never set this flag → no change.
  const [embed, setEmbed] = useState(false)
  useEffect(() => {
    try { setEmbed(sessionStorage.getItem('embedMode') === '1') } catch {}
  }, [])

  // Client-mode profile (gates the business tabs) + hydration flag, so we only
  // ask the "has business?" question once the real saved value has loaded.
  const hasBusiness = useClientProfileStore(s => s.hasBusiness)
  const setHasBusiness = useClientProfileStore(s => s.setHasBusiness)
  const hydrated = useSyncStore(s => s.hydrated)

  async function handleSignOut() {
    await signOut(auth)
  }

  function isActive(href: string) {
    if (href === '/app/monthly/jan') return pathname.startsWith('/app/monthly')
    if (href === '/app/business')    return pathname.startsWith('/app/business')
    return pathname === href
  }

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const isAdvisor = hasLabAccess(user?.email)
  const visibleGroups = groups
    .map(g => ({ ...g, items: g.items.filter(item => !item.advisorOnly || isAdvisor) }))
    .filter(g => g.items.length > 0)

  const navList = (
    <nav className="flex flex-col gap-0.5 p-3">
      {visibleGroups.map((g, gi) => (
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

  // Embed (in-app WebView) = client mode: no header/drawer, a slim bottom nav of
  // the curated client tabs. Business tabs appear only if the client has one.
  if (embed) {
    // Wait for the saved profile to load before deciding what to show — avoids
    // flashing the "has business?" question to a client who already answered.
    if (!hydrated) {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      )
    }

    // One-time question — gates the business tabs.
    if (hasBusiness === null) {
      return (
        <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-5 p-6 text-center">
          <div className="text-5xl">🏢</div>
          <h1 className="text-xl font-bold text-gold">יש לך עסק?</h1>
          <p className="text-muted-txt text-sm max-w-xs">
            כדי שנציג לך גם תקציב עסקי ותכנון שנתי עסקי. אפשר לשנות בהמשך.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setHasBusiness(true)}
              className="bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-xl px-6 py-3 font-semibold transition-colors min-h-[44px]"
            >
              כן, יש לי עסק
            </button>
            <button
              onClick={() => setHasBusiness(false)}
              className="bg-surface2 hover:bg-surface3 text-txt border border-line rounded-xl px-6 py-3 font-semibold transition-colors min-h-[44px]"
            >
              לא
            </button>
          </div>
        </div>
      )
    }

    const clientTabs = hasBusiness ? [...CLIENT_TABS, BUSINESS_TAB] : CLIENT_TABS
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-1 p-3 sm:p-6 pb-24">{children}</main>
        <nav className="fixed bottom-0 inset-x-0 bg-surface2/95 backdrop-blur border-t border-line flex items-stretch z-40">
          {clientTabs.map(t => {
            const active = isActive(t.href)
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[58px] text-[10px] transition-colors ${
                  active ? 'text-gold' : 'text-muted-txt hover:text-txt'
                }`}
              >
                <span className="text-lg leading-none">{t.emoji}</span>
                <span>{t.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    )
  }

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
