import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { sanitizePracticeBrand } from '@/lib/brand'

// firebase-admin needs the Node runtime.
export const runtime = 'nodejs'

// Resolves the caller's practice branding ("directions" strategy): an advisor
// belongs to the practice on their role doc; a client belongs to the practice
// of the advisor who invited them (clientLinks/{uid}). Served through the admin
// SDK on purpose — clients can't read practices/* directly and no security-rule
// change is needed. Returns { brand: null } for users with no practice brand,
// which means "use the deployment default".
export async function GET(req: NextRequest) {
  const db = getAdminDb()
  if (!db) {
    return NextResponse.json({ error: 'admin not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  // Public branch: brand by practiceId, for the pre-login page reached from a
  // branded invite link (?b=practiceId). Brand data (name + colors) is public
  // by nature — it is shown to anyone the firm invites.
  const pid = req.nextUrl.searchParams.get('practiceId')
  if (!token && pid) {
    // Strict id shape: blocks path tricks (practices/a/b/c), log injection,
    // and junk traffic before it costs a Firestore read.
    if (!/^p_[A-Za-z0-9_-]{1,64}$/.test(pid)) {
      return NextResponse.json({ error: 'bad id' }, { status: 400 })
    }
    try {
      const snap = await db.collection('practices').doc(pid).get()
      const brand = sanitizePracticeBrand(snap.exists ? snap.data()?.brand : null)
      // Public data — let the CDN absorb repeat traffic (the authed branch
      // below stays per-user and uncached).
      return NextResponse.json({ practiceId: pid, brand }, {
        headers: { 'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800' },
      })
    } catch (err) {
      console.error(`[brand] public pid=${pid}`, err)
      return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
    }
  }

  if (!token) {
    return NextResponse.json({ error: 'missing token' }, { status: 401 })
  }

  let uid: string
  let email: string | undefined
  try {
    const v = await verifyFirebaseToken(token)
    uid = v.uid
    email = v.email?.toLowerCase()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // Advisor first (their own practice), then client (inviter's practice),
    // then a PENDING invite (pre-consent — so the consent screen itself is
    // already in the inviting firm's brand).
    let practiceId: string | null = null
    const advisorSnap = await db.collection('advisors').doc(uid).get()
    if (advisorSnap.exists) {
      practiceId = (advisorSnap.data()?.practiceId as string) || null
    } else {
      const linkSnap = await db.collection('clientLinks').doc(uid).get()
      if (linkSnap.exists) {
        const link = linkSnap.data() as { practiceId?: string; status?: string }
        if (link.status === 'active') practiceId = link.practiceId || null
      }
      if (!practiceId && email) {
        const pendingSnap = await db.collection('clientLinks').doc(`pending_${email}`).get()
        if (pendingSnap.exists) {
          const p = pendingSnap.data() as { practiceId?: string; status?: string }
          if (p.status === 'pending') practiceId = p.practiceId || null
        }
      }
    }

    if (!practiceId) {
      return NextResponse.json({ practiceId: null, brand: null })
    }

    const practiceSnap = await db.collection('practices').doc(practiceId).get()
    const data = practiceSnap.exists ? practiceSnap.data() : null
    const brand = sanitizePracticeBrand(data?.brand)

    return NextResponse.json({
      practiceId,
      practiceName: (data?.name as string) || null,
      brand,
    })
  } catch (err) {
    console.error(`[brand] uid=${uid}`, err)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
}
