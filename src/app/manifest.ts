import type { MetadataRoute } from 'next'

// PWA manifest — lets iPhone (and Android) clients "install" the system from
// the browser: Safari → Share → Add to Home Screen. Opens standalone (no
// browser chrome); the app layout detects standalone display and switches to
// the curated client-tab experience, same as the Android app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'מעקב הוצאות — הכלכלן של הבית',
    short_name: 'מעקב הוצאות',
    description: 'רישום הוצאות אוטומטי, תקציב, יעדים ומגמות — ניהול פיננסי במקום אחד.',
    start_url: '/app/home',
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: '#0F0F0F',
    theme_color: '#0F0F0F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
