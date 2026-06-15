import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

// Server-side Firestore (admin SDK). Used ONLY by API routes to deliver
// externally-pushed transactions into a user's private inbox. The service
// account bypasses Security Rules, so it never runs in the browser and the key
// is read from a server-only env var (NEVER NEXT_PUBLIC_).
//
// Returns null when the service account isn't configured yet, so callers can
// fail gracefully (503) — this lets the code deploy before the backend is set up
// without breaking anything.
let cached: Firestore | null = null

export function getAdminDb(): Firestore | null {
  if (cached) return cached

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null

  let sa: { project_id?: string; client_email?: string; private_key?: string }
  try {
    sa = JSON.parse(raw)
  } catch {
    return null
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) return null

  const app: App = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          // Env vars often store the PEM with literal "\n" — restore real newlines.
          privateKey: sa.private_key.replace(/\\n/g, '\n'),
        }),
      })

  cached = getFirestore(app)
  return cached
}
