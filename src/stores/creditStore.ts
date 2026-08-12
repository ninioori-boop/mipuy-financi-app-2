'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'
import { normalizeForLookup } from '@/lib/normalizeForLookup'
import { saveLearnedEntry } from '@/lib/firestoreService'
import { shareableLearnedEntry, isPaymentRailKey } from '@/lib/learnedSharing'
import { useImpersonationStore } from '@/stores/impersonationStore'

interface CreditState {
  transactions: Transaction[]
  uploadedFileNames: string[]
  learnedDB: Record<string, string>        // this account's own corrections (persisted per-user)
  sharedLearnedDB: Record<string, string>  // global cross-account corrections (loaded each session, NOT persisted per-user)
  isLoading: boolean
  loadingMessage: string
  reportMonths: number  // how many months the uploaded report covers

  setTransactions: (txns: Transaction[], fileNames: string[]) => void
  updateCategory: (idx: number, category: string) => void
  applyAiCategoryById: (id: string, category: string) => void
  learn: (desc: string, category: string) => void
  setSharedLearnedDB: (db: Record<string, string>) => void
  mergedLearnedDB: () => Record<string, string>
  updateDesc: (idx: number, desc: string) => void
  updateAmount: (idx: number, amount: number) => void
  deleteTransaction: (idx: number) => void
  setLoading: (loading: boolean, message?: string) => void
  setReportMonths: (months: number) => void
  reset: () => void
}

export const useCreditStore = create<CreditState>((set, get) => ({
  transactions: [],
  uploadedFileNames: [],
  learnedDB: {},
  sharedLearnedDB: {},
  isLoading: false,
  loadingMessage: '',
  reportMonths: 3,

  setTransactions: (txns, fileNames) =>
    set({ transactions: txns, uploadedFileNames: fileNames }),

  // Lookup order at parse time: account's own corrections override the shared
  // pool. Payment-rail keys are dropped from BOTH dicts here — rails must
  // always resolve to BUSINESS_DB's ביט/מזומן ללא מעקב default, and this read-
  // side filter also neutralizes rail entries learned before the 2026-07-29
  // guard existed, without touching anyone's stored data.
  mergedLearnedDB: () => {
    const merged: Record<string, string> = { ...get().sharedLearnedDB, ...get().learnedDB }
    for (const key of Object.keys(merged)) {
      if (isPaymentRailKey(key)) delete merged[key]
    }
    return merged
  },

  setSharedLearnedDB: (db) => set({ sharedLearnedDB: db }),

  // Record a deliberate human correction: remember it locally, and push to the
  // shared cross-account pool (fire-and-forget) ONLY when the entry has global
  // meaning — personal "untracked" targets and too-short substring-wildcard
  // keys stay in this account alone. Payment rails (Bit/PayBox/cash) are not
  // remembered AT ALL, local included: the same rail carries different payees
  // even within one account, so there is nothing true to remember.
  learn: (desc, category) => {
    const key = normalizeForLookup(desc)
    if (!key || isPaymentRailKey(key)) return
    set({ learnedDB: { ...get().learnedDB, [key]: category } })
    if (shareableLearnedEntry(key, category)) {
      // 🔴 The HOUSEHOLD, not the person at the keyboard. The shared pool now
      // promotes on two distinct households, and while an advisor is acting as
      // a client the signed-in uid is the ADVISOR — so without this, the same
      // correction made here for client A and for client B counted as one voice
      // (harmless), while the same correction made in the automap lab counted
      // as two (not harmless: one household, two identities, quorum reached
      // alone). Both surfaces now name the same household.
      saveLearnedEntry(key, category, useImpersonationStore.getState().client?.uid).catch(() => {})
    }
  },

  // Manual correction from the UI — apply to every row with the same merchant,
  // then learn it (which writes to the shared pool). EXCEPT payment rails
  // (Bit/PayBox/cash): one Bit pays rent and the next buys lunch, so a rail
  // edit is one-time — this row only, nothing learned, and the rest of the
  // rows keep the ביט/מזומן ללא מעקב default.
  updateCategory: (idx, category) => {
    const txns = get().transactions
    const target = txns[idx]
    if (!target) return
    const key = normalizeForLookup(target.desc)
    if (isPaymentRailKey(key)) {
      set({ transactions: txns.map((t, i) => i === idx ? { ...t, category } : t) })
      return
    }
    set({
      transactions: txns.map(t => normalizeForLookup(t.desc) === key ? { ...t, category } : t),
    })
    get().learn(target.desc, category)
  },

  // AI-assigned category — looks up the row by its stable id, so a delete that
  // lands between batch creation and result application can't shift indices and
  // assign a category to the wrong row. Remembered locally so future uploads in
  // THIS account skip re-asking the AI, but AI guesses are never written to the
  // shared pool (avoids propagating a wrong guess to every client). If the row
  // was deleted (id no longer exists), this is a silent no-op.
  applyAiCategoryById: (id, category) => {
    const txns = get().transactions
    const target = txns.find(t => t.id === id)
    if (!target) return
    const key = normalizeForLookup(target.desc)
    // Rails: apply to the row, but never remember — same reason as learn().
    if (isPaymentRailKey(key)) {
      set({ transactions: txns.map(t => t.id === id ? { ...t, category } : t) })
      return
    }
    set({
      // The AI runs on CHARGES only (refunds are filtered before the batch),
      // and refunds net their category — so a same-merchant refund must
      // follow its charge's new category. Without this, an unknown merchant
      // that was charged AND refunded ends up: charge in the AI category
      // (still counted in full — the ₪1,350 complaint), refund stuck in
      // 'שונות' driving it negative and deleting real misc spend. Other
      // same-desc CHARGES are untouched: each got its own AI answer by id.
      transactions: txns.map(t =>
        t.id === id ? { ...t, category }
        : (t.isRefund && normalizeForLookup(t.desc) === key) ? { ...t, category }
        : t),
      learnedDB: { ...get().learnedDB, [key]: category },
    })
  },

  updateDesc: (idx, desc) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    txns[idx] = { ...txns[idx], desc }
    set({ transactions: txns })
  },

  updateAmount: (idx, amount) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    txns[idx] = { ...txns[idx], amount }
    set({ transactions: txns })
  },

  deleteTransaction: (idx) =>
    set({ transactions: get().transactions.filter((_, i) => i !== idx) }),

  setLoading: (loading, message = '') =>
    set({ isLoading: loading, loadingMessage: message }),

  setReportMonths: (months) =>
    set({ reportMonths: Math.max(1, Math.min(24, months)) }),

  reset: () =>
    set({ transactions: [], uploadedFileNames: [], learnedDB: {}, isLoading: false, loadingMessage: '' }),
}))
