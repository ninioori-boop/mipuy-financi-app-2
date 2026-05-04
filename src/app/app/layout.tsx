'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { SaveStatusBar } from '@/components/layout/SaveStatusBar'

const tabs = [
  { href: '/app/guide',       label: '📖 מדריך' },
  { href: '/app/credit',      label: '💳 אשראי' },
  { href: '/app/bank',        label: '🏦 עו"ש' },
  { href: '/app/mapping',     label: '🗂️ מיפוי' },
  { href: '/app/monthly/jan', label: '📅 חודשי' },
  { href: '/app/import',      label: '📥 ייבוא' },
  { href: '/app/annual',      label: '📆 שנתי' },
  { href: '/app/trends',      label: '📊 מגמות' },
  { href: '/app/goals',       label: '🎯 יעדים' },
  { href: '/app/loans',       label: '💰 הלוואות' },
  { href: '/app/compound',    label: '📈 ריבית דריבית' },
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
      <header className="border-b border-line bg-surface2 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold text-gold tracking-wide">The Home Economist</span>
          <span className="hidden md:block"><SaveStatusBar /></span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm text-muted-txt hidden sm:block">{user.email}</span>
          )}
          <button
            onClick={handleSignOut}
            className="text-sm text-muted-txt hover:text-txt transition-colors"
          >
            יציאה
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="border-b border-line bg-surface2 overflow-x-auto">
        <div className="flex min-w-max px-2">
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
                  'px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-b-2 border-gold text-gold'
                    : 'text-muted-txt hover:text-txt',
                ].join(' ')}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
