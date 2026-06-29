import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAuth, type Auth } from 'firebase-admin/auth'

// Server-side Firebase admin SDK. Used ONLY by API routes (deliver pushed
// transactions into a user's inbox; mint an app session from a device token).
// The service account bypasses Security Rules, so it never runs in the browser
// and the key is read from a server-only env var (NEVER NEXT_PUBLIC_).
//
// All getters return null when the service account isn't configured yet, so
// callers can fail gracefully (503) — this lets the code deploy before the
// backend is set up without breaking anything.
let cachedApp: App | null = null
let cachedDb: Firestore | null = null
let cachedAuth: Auth | null = null

function getAdminApp(): App | null {
  if (cachedApp) return cachedApp

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null

  let sa: { project_id?: string; client_email?: string; private_key?: string }
  try {
    sa = JSON.parse(raw)
  } catch {
    return null
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) return null

  cachedApp = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          // Env vars often store the PEM with literal "\n" — restore real newlines.
          privateKey: sa.private_key.replace(/\\n/g, '\n'),
        }),
      })

  return cachedApp
}

export function getAdminDb(): Firestore | null {
  if (cachedDb) return cachedDb
  const app = getAdminApp()
  if (!app) return null
  cachedDb = getFirestore(app)
  return cachedDb
}

export function getAdminAuth(): Auth | null {
  if (cachedAuth) return cachedAuth
  const app = getAdminApp()
  if (!app) return null
  cachedAuth = getAuth(app)
  return cachedAuth
}
