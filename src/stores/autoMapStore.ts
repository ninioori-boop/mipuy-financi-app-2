'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedMapping } from '@/lib/autoMap'
import type { AnnualItem } from '@/lib/automapAnnual'
import type { BankRow } from '@/lib/automapBank'
import type { IntakeRow } from '@/lib/automapQuestions'
import type { Transaction } from '@/types/transaction'

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

  /**
   * The questionnaire's table answers — question id → rows. Three questions use
   * them: the three months of income per earner, the הר הכסף products, and the
   * investment portfolios and assets. Each of those replaced a document upload,
   * and each is a repeating shape a single text box would have flattened into a
   * sentence somebody then has to parse.
   *
   * ⚠️ Client data, exactly like intakeForm — cleared in resetSessionStores().
   */
  intakeRows: Record<string, IntakeRow[]>

  // ── the parsed upload ──
  //
  // These used to live in the page's own useState, so a refresh kept the
  // generated mapping and threw away everything it was built from: the פירוט
  // went blank, the drill-downs emptied, and every manual re-categorisation was
  // gone. The result outliving its own evidence is the worst of both.
  //
  // ⚠️ This is the most identifying data the lab has ever held — one person's
  // entire transaction history. resetSessionStores() clears all of it at an
  // identity change, and storeCoverage.test.ts fails if a new field here is not
  // listed there.
  txns:       Transaction[]        // credit-report rows
  bankRows:   BankRow[]            // עו"ש rows, with the source file stamped on
  fileNames:  string[]             // Excel files whose transactions are loaded
  attachedByQ: Record<string, string[]>   // question id → attached file names
  txnOverrides: Record<string, string>    // txn key → the category the advisor set
  /**
   * Files that became PDFs/images for the model. Only the NAMES are kept: the
   * content is base64 up to 4MB and would blow the localStorage quota, so after
   * a refresh these have to be attached again — and the UI says so by name
   * rather than letting the advisor generate without them.
   */
  docNames:   string[]

  setContextText: (t: string) => void
  setIntakeAnswer: (id: string, value: string) => void
  setIntakeForm: (answers: Record<string, string>) => void
  /** Replace the rows of one table question. */
  setIntakeRows: (id: string, rows: IntakeRow[]) => void
  /** Set one upload field, by value or by updater (mirrors useState). */
  setLab: <K extends LabDataKey>(
    key: K,
    value: AutoMapState[K] | ((prev: AutoMapState[K]) => AutoMapState[K]),
  ) => void
  /** Drop the upload but keep the questionnaire and the generated result. */
  clearLabData: () => void
  setReportMonths: (n: number) => void
  setResult: (r: GeneratedMapping | null) => void
  /**
   * Patch the result. Accepts an updater because panels fire two writes in one
   * tick — DebtPanel saves the balance and then recomputes the payment — and a
   * plain object patch built from a stale `result` loses the first one. That is
   * exactly why typing a loan balance in the lab did nothing while the same
   * panel worked in the mapping tab, where the target is a Zustand store.
   */
  updateResult: (patch: Partial<GeneratedMapping> | ((prev: GeneratedMapping) => Partial<GeneratedMapping>)) => void
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

/** The upload fields — the ones setLab can write and clearLabData empties. */
type LabDataKey = 'txns' | 'bankRows' | 'fileNames' | 'attachedByQ' | 'txnOverrides' | 'docNames'

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
      intakeRows: {},
      txns: [],
      bankRows: [],
      fileNames: [],
      attachedByQ: {},
      txnOverrides: {},
      docNames: [],

      setContextText:  (contextText) => set({ contextText }),
      setIntakeAnswer: (id, value) => set(s => ({ intakeForm: { ...s.intakeForm, [id]: value } })),
      setIntakeForm:   (answers) => set(s => ({ intakeForm: { ...s.intakeForm, ...answers } })),
      setIntakeRows:   (id, rows) => set(s => ({ intakeRows: { ...s.intakeRows, [id]: rows } })),
      setLab: (key, value) => set(s => ({
        [key]: typeof value === 'function'
          ? (value as (prev: AutoMapState[typeof key]) => AutoMapState[typeof key])(s[key])
          : value,
      } as Pick<AutoMapState, typeof key>)),
      clearLabData: () => set({
        txns: [], bankRows: [], fileNames: [], attachedByQ: {}, txnOverrides: {}, docNames: [],
      }),
      setReportMonths: (n) => set({ reportMonths: Math.max(1, Math.min(24, Math.floor(n || 1))) }),
      setResult:       (result) => set({ result }),
      updateResult:    (patch) => set(s => ({
        result: s.result
          ? { ...s.result, ...(typeof patch === 'function' ? patch(s.result) : patch) }
          : s.result,
      })),

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
        annualItems: [], dismissedOneOffs: [], intakeForm: {}, intakeRows: {},
        txns: [], bankRows: [], fileNames: [], attachedByQ: {}, txnOverrides: {}, docNames: [],
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
    {
      name: AUTOMAP_STORAGE_KEY,
      /**
       * localStorage is a few megabytes for the whole origin, and the drafts
       * archive already lives in here. A routine 3-month upload is a few hundred
       * rows (~50KB); an unusual one could be thousands. Past the cap the rows
       * are simply not persisted — a refresh then behaves exactly as it did
       * before, which is far better than a quota error that loses the drafts
       * archive along with them.
       */
      partialize: (s) => {
        const rows = s.txns.length + s.bankRows.length
        return rows > MAX_PERSISTED_ROWS ? { ...s, txns: [], bankRows: [] } : s
      },
    },
  ),
)

/** ~900KB of JSON at ~150 bytes a row — comfortably inside the quota. */
const MAX_PERSISTED_ROWS = 6000
