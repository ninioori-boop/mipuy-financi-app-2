import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from './firebaseAdmin'
import { checkRateLimit } from './rateLimit'

/**
 * Per-practice AI circuit breaker + usage accounting (white-label).
 *
 * The per-user limiter (rateLimit.ts) caps one person; the global switch
 * (aiBudget.ts) caps the whole deployment. Neither can answer "which FIRM is
 * spending my AI budget", which is the question that matters once the product
 * is licensed to more than one practice.
 *
 * Two independent things happen here:
 *   1. ACCOUNTING — always on. Every dispatch is counted per practice per day
 *      (and per route), so real usage is visible BEFORE anyone sets a cap.
 *      Counting never blocks and never throws.
 *   2. A CIRCUIT BREAKER — a deliberately generous daily ceiling per practice
 *      (env `AI_PRACTICE_DAILY_LIMIT`, default below). It exists to stop a
 *      runaway loop or an abusive tenant, NOT to ration normal work, so it sits
 *      far above real usage. A practice can carry its own override, or be
 *      switched off entirely, from Firestore without a deploy:
 *        practices/{id}.aiQuota = { dailyLimit?: number, disabled?: boolean }
 */

const DAY_MS = 86_400_000
// Sized as a runaway guard, not a business quota. A real onboarding weekend can
// legitimately cost hundreds of calls (a first-time client with an empty
// learned DB is ~16 calls, and a firm may migrate dozens at once), so the
// ceiling sits far above that; the per-user limits are the business limits.
const DEFAULT_PRACTICE_DAILY_LIMIT = 2500
// A user who belongs to no practice gets their own daily ceiling — pooling them
// would let one heavy self-serve user lock out every other one.
const DEFAULT_USER_DAILY_LIMIT = 300

export type AiRoute =
  | 'analyze' | 'categorize' | 'automap' | 'bank-statement' | 'credit-statement'
  | 'categorize-one' | 'whatsapp' | 'digest'

export interface AiQuotaResult {
  allowed: boolean
  practiceId: string | null
  /** Set when blocked: 'practice-disabled' | 'practice-limit'. */
  reason?: string
}

/**
 * Which practice does this user belong to? Same precedence as /api/brand:
 * advisor's own practice → the inviting practice of an active link → a pending
 * invite. Returns null for a user with no practice (the default deployment).
 */
export async function resolvePracticeId(uid: string, email?: string | null): Promise<string | null> {
  const db = getAdminDb()
  if (!db || !uid) return null
  try {
    const advisorSnap = await db.collection('advisors').doc(uid).get()
    if (advisorSnap.exists) return (advisorSnap.data()?.practiceId as string) || null

    const linkSnap = await db.collection('clientLinks').doc(uid).get()
    if (linkSnap.exists) {
      const link = linkSnap.data() as { practiceId?: string; status?: string }
      if (link.status === 'active') return link.practiceId || null
    }
    const mail = email?.toLowerCase().trim()
    if (mail) {
      const pending = await db.collection('clientLinks').doc(`pending_${mail}`).get()
      if (pending.exists) {
        const p = pending.data() as { practiceId?: string; status?: string }
        if (p.status === 'pending') return p.practiceId || null
      }
    }
    return null
  } catch {
    // Tenancy is optional metadata here — never block an AI call because a
    // lookup failed.
    return null
  }
}

async function practiceConfig(practiceId: string): Promise<{ dailyLimit: number; disabled: boolean }> {
  const envLimit = Number(process.env.AI_PRACTICE_DAILY_LIMIT)
  const fallback = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_PRACTICE_DAILY_LIMIT
  const db = getAdminDb()
  if (!db) return { dailyLimit: fallback, disabled: false }
  try {
    const snap = await db.collection('practices').doc(practiceId).get()
    const q = snap.exists ? (snap.data()?.aiQuota as { dailyLimit?: unknown; disabled?: unknown } | undefined) : undefined
    const perPractice = Number(q?.dailyLimit)
    return {
      dailyLimit: Number.isFinite(perPractice) && perPractice > 0 ? perPractice : fallback,
      disabled: q?.disabled === true,
    }
  } catch {
    return { dailyLimit: fallback, disabled: false }
  }
}

/** Daily per-practice, per-route usage rollup. Best effort, never blocks. */
async function recordUsage(practiceId: string, route: AiRoute) {
  const db = getAdminDb()
  if (!db) return
  const day = new Date().toISOString().slice(0, 10)
  try {
    await db.collection('aiUsage').doc(`${practiceId}_${day}`).set({
      practiceId,
      day,
      total: FieldValue.increment(1),
      // A NESTED map, not a dotted key: set({merge:true}) treats 'byRoute.x' as
      // a literal field name, which would make the per-route report read empty.
      byRoute: { [route]: FieldValue.increment(1) },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch { /* accounting must never break a request */ }
}

/**
 * Consume one AI dispatch for this user's practice. Call AFTER auth and the
 * per-user limit, immediately BEFORE the model request (so a failing but
 * billable call still counts). Users with no practice are counted under
 * '_none' and are subject to the same runaway ceiling.
 */
export async function checkAiQuota(opts: {
  uid: string
  email?: string | null
  route: AiRoute
  /** Pass a known practiceId to skip the lookup (WhatsApp/digest have it). */
  practiceId?: string | null
}): Promise<AiQuotaResult> {
  // Without the admin SDK there is no shared counter, only a per-instance one —
  // which would block on infra misconfiguration rather than degrade. A cost
  // guard must never be the reason a paying user is refused.
  if (!getAdminDb()) return { allowed: true, practiceId: null }

  const practiceId = opts.practiceId ?? await resolvePracticeId(opts.uid, opts.email)

  if (practiceId) {
    const { dailyLimit, disabled } = await practiceConfig(practiceId)
    if (disabled) return { allowed: false, practiceId, reason: 'practice-disabled' }
    const { allowed } = await checkRateLimit({
      key: `ai:practice:${practiceId}`, limit: dailyLimit, windowMs: DAY_MS,
    })
    if (!allowed) return { allowed: false, practiceId, reason: 'practice-limit' }
  } else {
    // No practice: the ceiling is PER USER, never a shared pool.
    const envLimit = Number(process.env.AI_USER_DAILY_LIMIT)
    const limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_USER_DAILY_LIMIT
    const { allowed } = await checkRateLimit({ key: `ai:user-day:${opts.uid}`, limit, windowMs: DAY_MS })
    if (!allowed) return { allowed: false, practiceId: null, reason: 'user-limit' }
  }

  await recordUsage(practiceId ?? '_none', opts.route)
  return { allowed: true, practiceId }
}

/**
 * The user-facing reason. "Contact your firm's admin" is only true when a firm
 * was actually switched off — telling a self-serve user that would send them to
 * an administrator who does not exist.
 */
export function aiQuotaMessage(reason?: string): string {
  if (reason === 'practice-disabled') return 'שירות ה-AI מושהה כרגע עבור המשרד שלך. פנה למנהל המערכת.'
  if (reason === 'practice-limit') return 'המשרד שלך הגיע למכסת ה-AI היומית. המכסה מתאפסת מחר.'
  return 'הגעת למכסת ה-AI היומית. המכסה מתאפסת מחר.'
}
