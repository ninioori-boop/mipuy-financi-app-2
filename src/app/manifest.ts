import type { MetadataRoute } from 'next'
import { BRAND } from '@/lib/brand'

// PWA manifest — lets iPhone (and Android) clients "install" the system from
// the browser: Safari → Share → Add to Home Screen. Opens standalone (no
// browser chrome); the app layout detects standalone display and switches to
// the curated client-tab experience, same as the Android app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.appShortName} — ${BRAND.nameHe}`,
    short_name: BRAND.appShortName,
    description: BRAND.manifestDescription,
    start_url: '/app/home',
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: BRAND.colors.surface,
    theme_color: BRAND.colors.surface,
    icons: [
      { src: BRAND.logo.icon192, sizes: '192x192', type: 'image/png' },
      { src: BRAND.logo.icon512, sizes: '512x512', type: 'image/png' },
    ],
  }
}
