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
export async function checkAiBudget(opts?: { exempt?: boolean }): Promise<{ stopped: boolean }> {
  if (process.env.AI_KILL_SWITCH === 'true') return { stopped: true }
  if (opts?.exempt) return { stopped: false }

  const raw = process.env.AI_DAILY_LIMIT
  if (!raw) return { stopped: false }
  const limit = Number(raw)
  if (!Number.isFinite(limit) || limit <= 0) return { stopped: false }

  const { allowed } = await checkRateLimit({ key: 'global:ai', limit, windowMs: DAY_MS })
  return { stopped: !allowed }
}
