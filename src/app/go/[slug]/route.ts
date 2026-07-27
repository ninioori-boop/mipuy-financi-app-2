import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'

// firebase-admin needs the Node runtime.
export const runtime = 'nodejs'

// Short branded links: /go/{slug} → the firm's branded login. The slug lives at
// practices/{id}.brand.slug — human-friendly, un-truncatable in chat apps,
// perfect for manual sharing (the invite emails still carry the full ?b= link).
// Unknown slug → the plain login, never an error page.
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const authUrl = new URL('/auth', req.nextUrl.origin)
  let resolved = false

  if (/^[a-z0-9-]{2,32}$/.test(slug)) {
    try {
      const db = getAdminDb()
      if (db) {
        const hit = await db.collection('practices').where('brand.slug', '==', slug).limit(1).get()
        if (!hit.empty) {
          authUrl.searchParams.set('b', hit.docs[0].id)
          authUrl.searchParams.set('utm_source', 'shortlink')
          resolved = true
        }
      }
    } catch { /* fall through to plain login */ }
  }

  // Cache ONLY successful resolutions — a transient failure must never pin the
  // unsigned fallback into the CDN for everyone.
  return NextResponse.redirect(authUrl, {
    status: 302,
    headers: {
      'Cache-Control': resolved ? 'public, max-age=300, s-maxage=3600' : 'no-store',
    },
  })
}
