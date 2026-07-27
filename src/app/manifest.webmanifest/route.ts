import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { BRAND, mergeBrand, sanitizePracticeBrand } from '@/lib/brand'

// firebase-admin needs the Node runtime.
export const runtime = 'nodejs'

// PWA manifest, now brand-aware: ?b=<practiceId> serves the firm's name and
// colors so "add to home screen" installs THEIR app, not the default brand.
// BrandProvider rewrites the <link rel="manifest"> href once a practice brand
// resolves; without ?b= (or on any failure) this is byte-equivalent to the old
// static manifest.
export async function GET(req: NextRequest) {
  let brand = BRAND
  const pid = req.nextUrl.searchParams.get('b')
  if (pid && /^p_[A-Za-z0-9_-]{1,64}$/.test(pid)) {
    try {
      const db = getAdminDb()
      if (db) {
        const snap = await db.collection('practices').doc(pid).get()
        brand = mergeBrand(BRAND, sanitizePracticeBrand(snap.exists ? snap.data()?.brand : null))
      }
    } catch { /* default brand */ }
  }

  const manifest = {
    name: brand.nameHe === BRAND.nameHe
      ? `${BRAND.appShortName} — ${BRAND.nameHe}`
      : brand.nameHe,
    short_name: brand.nameHe === BRAND.nameHe ? BRAND.appShortName : brand.nameHe,
    description: brand.manifestDescription,
    start_url: '/app/home',
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: brand.colors.surface,
    theme_color: brand.colors.surface,
    icons: [
      { src: brand.logo.icon192, sizes: '192x192', type: 'image/png' },
      { src: brand.logo.icon512, sizes: '512x512', type: 'image/png' },
    ],
  }

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  })
}
