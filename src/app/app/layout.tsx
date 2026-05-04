'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { SaveStatusBar } from '@/components/layout/SaveStatusBar'

const tabs = [
  { href: '/app/guide',       emoji: '📖', label: 'מדריך' },
  { href: '/app/credit',      emoji: '💳', label: 'אשראי' },
  { href: '/app/bank',        emoji: '🏦', label: 'עו"ש' },
  { href: '/app/mapping',     emoji: '🗂️', label: 'מיפוי' },
  { href: '/app/monthly/jan', emoji: '📅', label: 'חודשי' },
  { href: '/app/import',      emoji: '📥', label: 'ייבוא' },
  { href: '/app/annual',      emoji: '📆', label: 'שנתי' },
  { href: '/app/trends',      emoji: '📊', label: 'מגמות' },
  { href: '/app/goals',       emoji: '🎯', label: 'יעדים' },
  { href: '/app/loans',       emoji: '💰', label: 'הלוואות' },
  { href: '/app/compound',    emoji: '📈', label: 'ריבית' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuthStore()

  async function handleSignOut() {
    await signOut(auth)
  }

  return (
    <div className="flex min-h-screen flex-col">

      {/* Header */}
      <header className="border-b border-line bg-surface2 px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
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

      {/* Tab bar */}
      <nav className="border-b border-line bg-surface2 overflow-x-auto scrollbar-none">
        <div className="flex min-w-max px-1">
          {tabs.map((tab) => {
            const isActive =
              tab.href === '/app/monthly/jan'
                ? pathname.startsWith('/app/monthly')
                : pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={[
                  'flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5',
                  'px-2.5 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-b-2 border-gold text-gold'
                    : 'text-muted-txt hover:text-txt',
                ].join(' ')}
              >
                <span className="text-base leading-none">{tab.emoji}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden text-[10px] leading-none">{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1 p-3 sm:p-6">{children}</main>
    </div>
  )
}
