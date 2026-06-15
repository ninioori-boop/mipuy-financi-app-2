'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedMapping } from '@/lib/autoMap'

// A saved AutoMap session. Captures everything needed to reload a past
// generation in full — context + months + the full editable result — so
// the advisor can return to a client weeks later without paying for the
// AI generation again.
export interface AutoMapDraft {
  id:           string
  name:         string
  savedAt:      number              // ms timestamp
  contextText:  string
  reportMonths: number
  result:       GeneratedMapping
}

// ISOLATED sandbox store. Persisted to localStorage ONLY — deliberately NOT
// wired into dataSync / Firestore, so the experimental auto-mapping lab can
// never touch or leak into real client data.
interface AutoMapState {
  contextText: string             // free-text the advisor pastes (income, loans, assets…)
  reportMonths: number            // how many months the uploaded data covers
  result: GeneratedMapping | null // last AI-generated mapping (editable)
  drafts: AutoMapDraft[]          // saved sessions, newest first

  setContextText: (t: string) => void
  setReportMonths: (n: number) => void
  setResult: (r: GeneratedMapping | null) => void
  updateResult: (patch: Partial<GeneratedMapping>) => void
  reset: () => void

  // Drafts — save the current session under a name, restore any saved
  // session into the live editor, rename, or remove. Capped at 50 drafts
  // to keep localStorage well within its 5-10MB envelope.
  saveDraft:    (name: string) => string | null   // returns new draft id, or null if no result
  loadDraft:    (id: string) => boolean           // returns false if id not found
  deleteDraft:  (id: string) => void
  renameDraft:  (id: string, name: string) => void
}

const mkId = () => 'd' + Math.random().toString(36).slice(2, 11)

export const useAutoMapStore = create<AutoMapState>()(
  persist(
    (set, get) => ({
      contextText: '',
      reportMonths: 1,
      result: null,
      drafts: [],

      setContextText:  (contextText) => set({ contextText }),
      setReportMonths: (n) => set({ reportMonths: Math.max(1, Math.min(24, Math.floor(n || 1))) }),
      setResult:       (result) => set({ result }),
      updateResult:    (patch) => set(s => ({ result: s.result ? { ...s.result, ...patch } : s.result })),
      reset:           () => set({ contextText: '', reportMonths: 1, result: null }),

      saveDraft: (name) => {
        const s = get()
        if (!s.result) return null
        const trimmed = name.trim()
        const draft: AutoMapDraft = {
          id:           mkId(),
          name:         trimmed || `טיוטה ${new Date().toLocaleString('he-IL')}`,
          savedAt:      Date.now(),
          contextText:  s.contextText,
          reportMonths: s.reportMonths,
          result:       s.result,
        }
        set({ drafts: [draft, ...s.drafts].slice(0, 50) })
        return draft.id
      },

      loadDraft: (id) => {
        const d = get().drafts.find(x => x.id === id)
        if (!d) return false
        set({ contextText: d.contextText, reportMonths: d.reportMonths, result: d.result })
        return true
      },

      deleteDraft: (id) => set(s => ({ drafts: s.drafts.filter(x => x.id !== id) })),

      renameDraft: (id, name) => set(s => ({
        drafts: s.drafts.map(d => d.id === id ? { ...d, name: name.trim() || d.name } : d),
      })),
    }),
    { name: 'automap-lab' },
  ),
)
