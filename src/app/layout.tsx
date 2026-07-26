import type { Metadata } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ConsentGate } from '@/components/layout/ConsentGate'
import { DataSync } from '@/components/layout/DataSync'
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner'
import { CookieBanner } from '@/components/layout/CookieBanner'
import { GoogleAnalytics } from '@/components/layout/GoogleAnalytics'
import { Toaster } from '@/components/ui/sonner'
import { BRAND } from '@/lib/brand'

const rubik = Rubik({
  subsets: ['latin', 'hebrew'],
  variable: '--font-rubik',
})

export const metadata: Metadata = {
  title: BRAND.nameEn,
  description: BRAND.tagline,
  // iPhone "Add to Home Screen" — installs like an app, opens full-screen.
  appleWebApp: {
    capable: true,
    title: BRAND.appShortName,
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: BRAND.logo.appleTouch,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} dark`}>
      <body className="min-h-screen bg-surface text-txt antialiased font-sans">
        <AuthProvider>
          <ConsentGate>
            <DataSync>
              {children}
            </DataSync>
          </ConsentGate>
        </AuthProvider>
        <CookieBanner />
        <ImpersonationBanner />
        <Toaster position="bottom-center" />
        <GoogleAnalytics />
      </body>
    </html>
  )
}
