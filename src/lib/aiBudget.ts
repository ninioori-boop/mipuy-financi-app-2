import { checkRateLimit } from './rateLimit'

// Global daily cost kill-switch for the AI routes. Two operator controls, both
// shipped INERT (no-op unless an env var is set), mirroring the existing
// APP_CHECK_ENFORCE deploy-dark pattern:
//
//   AI_KILL_SWITCH=true   → immediate hard stop for ALL AI calls (panic button).
//   AI_DAILY_LIMIT=<n>     → cap total AI dispatches per UTC day across all users.
//
// Counting is per-call (1 per dispatch, counted before the Anthropic fetch so
// failing-but-billable calls still count). Since each route already fixes
// `max_tokens`, "calls × max-cost-per-call" gives a known daily-$ ceiling to size
// the threshold against. Reuses the same `rateLimits` collection + atomic
// transaction as the per-user limiter, so two instances can't both slip past the
// threshold. Returns `{ stopped:false }` when nothing is configured.

const DAY_MS = 86_400_000

// `exempt` (the advisor) skips the daily cap entirely but is STILL stopped by the
// manual AI_KILL_SWITCH panic flag — so "stop everything" really stops everything.
// The Firestore switch is cached briefly: it is read on every AI call, and a
// minute of latency on a panic button is an acceptable trade for not paying a
// read per request.
//
// `value` is the last state read SUCCESSFULLY. A failed read must never downgrade
// it to false: the switch is flipped during an incident, and an incident is
// exactly when Firestore is most likely to be the thing that broke. Resetting to
// false on error meant a blip silently un-pressed the panic button.
// `everRead` separates "we know it is off" from "we have never managed to look",
// so a cold start during an outage still fails open (no self-inflicted blackout
// on a deploy that has never reached Firestore) while an already-observed ON
// state survives. Both facts go to the log, because a control that degrades in
// silence is the failure mode this whole block exists to prevent.
let killCache = { at: 0, value: false, everRead: false }

async function firestoreKillSwitch(): Promise<boolean> {
  if (Date.now() - killCache.at < 60_000) return killCache.value
  const { getAdminDb } = await import('./firebaseAdmin')
  const db = getAdminDb()
  if (!db) return false
  try {
    const snap = await db.collection('config').doc('ai').get()
    killCache = {
      at: Date.now(),
      value: snap.exists && snap.data()?.killSwitch === true,
      everRead: true,
    }
  } catch {
    // Retain the last known state. `at` is re-stamped so a sustained outage
    // retries once a minute rather than on every single AI call.
    killCache = { ...killCache, at: Date.now() }
    console.warn(
      `[aiBudget] kill-switch read failed; retaining killSwitch=${killCache.value}` +
        (killCache.everRead ? '' : ' (never read successfully — failing open)'),
    )
  }
  return killCache.value
}

export async function checkAiBudget(opts?: { exempt?: boolean }): Promise<{ stopped: boolean }> {
  // Env var stops THIS deployment; the Firestore flag stops every deployment
  // (the Cloud Functions bot cannot see Vercel's env at all).
  if (process.env.AI_KILL_SWITCH === 'true') return { stopped: true }
  if (await firestoreKillSwitch()) return { stopped: true }
  if (opts?.exempt) return { stopped: false }

  const raw = process.env.AI_DAILY_LIMIT
  if (!raw) return { stopped: false }
  const limit = Number(raw)
  if (!Number.isFinite(limit) || limit <= 0) return { stopped: false }

  const { allowed } = await checkRateLimit({ key: 'global:ai', limit, windowMs: DAY_MS })
  return { stopped: !allowed }
}
