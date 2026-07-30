'use client'

import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'

/**
 * Who may see the experimental "מעבדה" surfaces (auto-mapping, subscriptions,
 * the WhatsApp home card, smart-budget suggest, advisor-only nav entries).
 *
 * Two sources, OR'd — deliberately ADDITIVE (2026-07-30):
 *  1. LAB_EMAILS — the original hardcoded list, kept so nobody who has access
 *     today can lose it, whatever happens to their role doc.
 *  2. advisors/{uid} exists — the REAL role. This is what makes a new firm's
 *     advisor (Roi, and every future licensee) work with no code edit.
 *
 * This gates VISIBILITY only. Every one of these screens reads data the
 * Firestore rules already protect per-user, so a wrong answer here is a UI
 * annoyance, never an exposure.
 *
 * `ready` exists because the role is resolved asynchronously: a page guard that
 * redirects while `ready === false` would bounce a real advisor off the page
 * before their role arrives. Guards must check `ready` first; purely additive
 * UI (showing an extra card) can ignore it and simply appear a moment later.
 */
export function useLabAccess(): { allowed: boolean; ready: boolean } {
  const email = useAuthStore(s => s.user?.email ?? null)
  const advisorRole = useAuthStore(s => s.advisorRole)

  // An email on the list is decided synchronously — no need to wait on Firestore.
  if (hasLabAccess(email)) return { allowed: true, ready: true }

  return { allowed: advisorRole === true, ready: advisorRole !== null }
}
