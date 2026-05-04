import { create } from 'zustand'
import type { User } from 'firebase/auth'

interface AuthState {
  user: User | null
  loading: boolean
  hasExistingData: boolean
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  setHasExistingData: (has: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  hasExistingData: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setHasExistingData: (has) => set({ hasExistingData: has }),
}))
