import { create } from 'zustand'
import type { User } from 'firebase/auth'

interface AuthState {
  user: User | null
  loading: boolean
  hasExistingData: boolean
  /**
   * Does advisors/{uid} exist for the signed-in user? `null` = not resolved yet.
   * Written once per sign-in by the app layout (which already performs that read)
   * and consumed via useLabAccess(). The tri-state matters: a redirect guard that
   * treats "not yet known" as "not an advisor" would bounce a real advisor off a
   * lab page before their role loads.
   */
  advisorRole: boolean | null
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setHasExistingData: (has: boolean) => void
  setAdvisorRole: (isAdvisor: boolean | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  hasExistingData: false,
  advisorRole: null,
  // Clear the cached role ONLY when the identity actually changes — otherwise
  // the next account would inherit the previous user's advisor privileges.
  // Compared by uid, NOT by reference: AuthProvider re-subscribes to
  // onAuthStateChanged on every client-side navigation (pathname is in its
  // deps), and Firebase replays the CURRENT user to each new subscriber with a
  // stable object. Resetting on every such replay would null the role while the
  // layout's publishing effect (keyed on the unchanged `user` reference) never
  // re-runs — leaving every advisor permanently locked out of the lab pages
  // after their first navigation.
  setUser: (user) =>
    set(s => (s.user?.uid === user?.uid ? { user } : { user, advisorRole: null })),
  setLoading: (loading) => set({ loading }),
  setHasExistingData: (has) => set({ hasExistingData: has }),
  setAdvisorRole: (isAdvisor) => set({ advisorRole: isAdvisor }),
}))
