import webpush from 'web-push'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'

// Branded Web-Push delivery — sends the capture/budget notification to the
// user's installed apps (iOS 16.4+ home-screen PWA, Android/desktop browsers),
// where it renders with the app's own name + icon (unlike the iOS Shortcut
// notification, which is stuck with the Shortcuts branding).
//
// Server-only. Inert until BOTH VAPID env keys are set, so it can deploy ahead
// of configuration without changing any behavior:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — public, also inlined into the client
//   VAPID_PRIVATE_KEY             — secret, server-only
//
// Subscriptions live in pushSubscriptions/{uid}.subs.{id} — written ONLY via
// the admin SDK (/api/push-subscribe), never by browser clients, so no
// Firestore-rules change is needed.

export type PushSubscriptionRecord = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

let configured: boolean | null = null

function ensureConfigured(): boolean {
  if (configured !== null) return configured
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    configured = false
    return false
  }
  webpush.setVapidDetails('mailto:ninioori@gmail.com', pub, priv)
  configured = true
  return true
}

export function isPushConfigured(): boolean {
  return ensureConfigured()
}

/**
 * Sends `payload` to every subscription the user has. Best-effort by design:
 * swallows every error (a failed notification must never fail the ingest that
 * triggered it) and prunes subscriptions the push service reports as gone
 * (404/410 — uninstalled PWA, revoked permission).
 */
export async function sendPushToUser(
  db: Firestore,
  uid: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  if (!ensureConfigured()) return
  try {
    const snap = await db.collection('pushSubscriptions').doc(uid).get()
    const subs = snap.exists ? (snap.data()?.subs as Record<string, PushSubscriptionRecord> | undefined) : undefined
    if (!subs || typeof subs !== 'object') return

    const dead: string[] = []
    await Promise.all(
      Object.entries(subs).map(async ([id, sub]) => {
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
          dead.push(id)
          return
        }
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 })
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) dead.push(id)
          // other statuses (429/5xx/network) — transient, keep the subscription
        }
      }),
    )

    if (dead.length) {
      const updates: Record<string, FieldValue> = {}
      for (const id of dead) updates[`subs.${id}`] = FieldValue.delete()
      await db.collection('pushSubscriptions').doc(uid).update(updates)
    }
  } catch {
    /* best-effort — never surfaces to the caller */
  }
}
