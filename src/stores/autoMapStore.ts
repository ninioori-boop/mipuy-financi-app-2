'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedMapping } from '@/lib/autoMap'
import type { AnnualItem } from '@/lib/automapAnnual'

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

  /**
   * Annual expenses the advisor confirmed — the answer to the hole a 3-month
   * upload always has. Two sources that never overlap: `checklist` items are
   * NOT in the uploaded data, `detected` ones ARE (and are therefore dropped
   * from the monthly breakdown so they aren't counted twice).
   */
  annualItems: AnnualItem[]
  /** One-off charges the advisor said are not annual; never offered again. */
  dismissedOneOffs: string[]

  /**
   * The questionnaire, filled in inside the lab — question id → answer. This is
   * the lab's primary input: what a client's documents cannot say (which banks,
   * what balances, whether there are loans at all) and what tags every uploaded
   * file with the question it answers.
   *
   * ⚠️ Client data. It is cleared in dataSync's resetSessionStores() at every
   * identity change, and storeCoverage.test.ts fails if a new field here is not.
   */
  intakeForm: Record<string, string>

  setContextText: (t: string) => void
  setIntakeAnswer: (id: string, value: string) => void
  setIntakeForm: (answers: Record<string, string>) => void
  setReportMonths: (n: number) => void
  setResult: (r: GeneratedMapping | null) => void
  updateResult: (patch: Partial<GeneratedMapping>) => void
  setAnnualItem: (item: AnnualItem) => void
  removeAnnualItem: (key: string) => void
  dismissOneOff: (key: string) => void
  restoreOneOff: (key: string) => void
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

/**
 * localStorage key for the persisted lab session. Exported so dataSync's
 * resetSessionStores() can clear it at an identity change — this store holds the
 * free-text financial context pasted about a specific client, so it must never
 * outlive the person who wrote it on a shared browser.
 */
export const AUTOMAP_STORAGE_KEY = 'automap-lab'

export const useAutoMapStore = create<AutoMapState>()(
  persist(
    (set, get) => ({
      contextText: '',
      reportMonths: 1,
      result: null,
      drafts: [],
      annualItems: [],
      dismissedOneOffs: [],
      intakeForm: {},

      setContextText:  (contextText) => set({ contextText }),
      setIntakeAnswer: (id, value) => set(s => ({ intakeForm: { ...s.intakeForm, [id]: value } })),
      setIntakeForm:   (answers) => set(s => ({ intakeForm: { ...s.intakeForm, ...answers } })),
      setReportMonths: (n) => set({ reportMonths: Math.max(1, Math.min(24, Math.floor(n || 1))) }),
      setResult:       (result) => set({ result }),
      updateResult:    (patch) => set(s => ({ result: s.result ? { ...s.result, ...patch } : s.result })),

      // Upsert by key: re-confirming an item updates its amount rather than
      // adding a second row for the same expense.
      setAnnualItem: (item) => set(s => ({
        annualItems: [...s.annualItems.filter(a => a.key !== item.key), item],
      })),
      removeAnnualItem: (key) => set(s => ({ annualItems: s.annualItems.filter(a => a.key !== key) })),
      dismissOneOff:    (key) => set(s => (s.dismissedOneOffs.includes(key)
        ? s : { dismissedOneOffs: [...s.dismissedOneOffs, key] })),
      restoreOneOff:    (key) => set(s => ({ dismissedOneOffs: s.dismissedOneOffs.filter(k => k !== key) })),

      reset: () => set({
        contextText: '', reportMonths: 1, result: null,
        annualItems: [], dismissedOneOffs: [], intakeForm: {},
      }),

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
    { name: AUTOMAP_STORAGE_KEY },
  ),
)
