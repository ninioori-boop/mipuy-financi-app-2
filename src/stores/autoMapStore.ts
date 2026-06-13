'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedMapping } from '@/lib/autoMap'

// ISOLATED sandbox store. Persisted to localStorage ONLY — deliberately NOT
// wired into dataSync / Firestore, so the experimental auto-mapping lab can
// never touch or leak into real client data.
interface AutoMapState {
  contextText: string             // free-text the advisor pastes (income, loans, assets…)
  reportMonths: number            // how many months the uploaded data covers
  result: GeneratedMapping | null // last AI-generated mapping (editable)

  setContextText: (t: string) => void
  setReportMonths: (n: number) => void
  setResult: (r: GeneratedMapping | null) => void
  updateResult: (patch: Partial<GeneratedMapping>) => void
  reset: () => void
}

export const useAutoMapStore = create<AutoMapState>()(
  persist(
    (set) => ({
      contextText: '',
      reportMonths: 1,
      result: null,

      setContextText:  (contextText) => set({ contextText }),
      setReportMonths: (n) => set({ reportMonths: Math.max(1, Math.min(24, Math.floor(n || 1))) }),
      setResult:       (result) => set({ result }),
      updateResult:    (patch) => set(s => ({ result: s.result ? { ...s.result, ...patch } : s.result })),
      reset:           () => set({ contextText: '', reportMonths: 1, result: null }),
    }),
    { name: 'automap-lab' },
  ),
)
