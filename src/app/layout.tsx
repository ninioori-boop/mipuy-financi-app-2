import type { Metadata } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { DataSync } from '@/components/layout/DataSync'
import { CookieBanner } from '@/components/layout/CookieBanner'
import { Toaster } from '@/components/ui/sonner'

const rubik = Rubik({
  subsets: ['latin', 'hebrew'],
  variable: '--font-rubik',
})

export const metadata: Metadata = {
  title: 'The Home Economist',
  description: 'מיפוי פיננסי חכם',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} dark`}>
      <body className="min-h-screen bg-surface text-txt antialiased font-sans">
        <AuthProvider>
          <DataSync>
            {children}
          </DataSync>
        </AuthProvider>
        <CookieBanner />
        <Toaster position="bottom-center" />
      </body>
    </html>
  )
}
