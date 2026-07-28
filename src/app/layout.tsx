import type { Metadata } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ConsentGate } from '@/components/layout/ConsentGate'
import { DataSync } from '@/components/layout/DataSync'
import { BrandProvider } from '@/components/layout/BrandProvider'
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner'
import { CookieBanner } from '@/components/layout/CookieBanner'
import { GoogleAnalytics } from '@/components/layout/GoogleAnalytics'
import { Toaster } from '@/components/ui/sonner'
import { BRAND } from '@/lib/brand'
import { BRAND_BOOT_SCRIPT, BRAND_TEXT_SCRIPT } from '@/lib/brandBoot'

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
  // The static manifest.ts became a dynamic route (brand-aware) — link it here.
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} dark`}>
      <head>
        {/* Must sit in <head>: re-applies the device's last brand BEFORE the
            browser's first paint. Inside <body> it ran a beat too late and the
            default theme flashed on every reload. Static string, no user data. */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface text-txt antialiased font-sans">
        <AuthProvider>
          <BrandProvider>
            <ConsentGate>
              <DataSync>
                {children}
              </DataSync>
            </ConsentGate>
          </BrandProvider>
        </AuthProvider>
        {/* Rewrites [data-brand] text from the cached brand while the document
            is still parsing — kills the default-name flash on reload. */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_TEXT_SCRIPT }} />
        <CookieBanner />
        <ImpersonationBanner />
        <Toaster position="bottom-center" />
        <GoogleAnalytics />
      </body>
    </html>
  )
}
