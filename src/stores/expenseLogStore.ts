'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

// Standalone, real-time expense journal. Intentionally ISOLATED — it does NOT
// feed mapping/monthly actuals (those come from credit/bank imports), so there
// is zero double-counting. A client logs every expense the moment it happens.
export interface ExpenseEntry {
  id:        string
  date:      string   // YYYY-MM-DD
  amount:    number   // ALWAYS shekels — every total in the app sums this field
  category:  string
  note:      string
  createdAt: number
  // Set only for a charge made in a foreign currency (captured abroad by the
  // phone automation). `amount` above is the converted shekel estimate; these
  // preserve what was actually paid, so the row can show "₪212 (£45)" and can
  // later be reconciled against the card statement. Absent on shekel charges.
  // The code is a plain string, not a union: it is read back from persisted
  // data, where nothing enforces the type (see formatMoneyLoose).
  foreignAmount?:   number
  foreignCurrency?: string
  fxRate?:          number
  // The transactionInbox item id this entry was drained from. THE dedup key
  // for re-drains: most captures carry no ref (route writes ref:null for the
  // iOS shortcut), so without this a tab killed between save-ack and the
  // inbox deleteDoc re-drained the same item next session and the charge
  // appeared twice in the log. Absent on manually-added entries.
  src?: string
}

/**
 * Was this entry produced by a machine rather than typed by a person?
 *
 * It decides how the monthly tab treats the money. A machine-made entry is a
 * card charge (or a standing rule for one), so the same shekels arrive again in
 * the credit/bank report and the report must win. A hand-typed entry is the
 * cash and Bit the report never sees, so it is ADDED on top of the report.
 *
 * Machine-made, three marks:
 *   src        — drained from the phone inbox (Android + iPhone both land here)
 *   note #ref  — captured through the deep link, which tags the merchant
 *   note ⟳     — materialised by a recurring rule (rent, subscriptions). Those
 *                are real charges that the statement reports too, so they count
 *                as machine-made even though a person wrote the rule.
 *
 * Person-made, one mark that has to be checked FIRST:
 *   note #wa:  — the WhatsApp bot, where a client typed "קניתי ב-50 בסופר".
 *                That is a person reporting a purchase, exactly like typing it
 *                into the app. It reaches the log through the same inbox as the
 *                phone automation (clientBot posts to /api/transaction with
 *                ref "wa:<msgId>"), so it carries `src` and a #ref tag and
 *                would otherwise be mistaken for a captured card charge.
 *
 * The blind spot, stated plainly: a card purchase somebody reported by hand —
 * typed in the app or sent to the bot — is indistinguishable from cash, and
 * will be added on top of the report. Nothing in the data can tell them apart.
 */
export function isAutoCaptured(e: Pick<ExpenseEntry, 'note' | 'src'>): boolean {
  if (/ #wa:/.test(e.note)) return false
  if (e.src) return true
  if (/ #\S+$/.test(e.note)) return true
  return e.note.includes('⟳')
}

type NewEntry = {
  date: string; amount: number; category: string; note: string
  foreignAmount?: number; foreignCurrency?: string; fxRate?: number
  src?: string
}

interface ExpenseLogState {
  entries: ExpenseEntry[]
  add:    (e: NewEntry) => void
  update: (id: string, patch: Partial<Omit<ExpenseEntry, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
}

export const useExpenseLogStore = create<ExpenseLogState>((set) => ({
  entries: [],

  add: (e) =>
    set(s => {
      const entry: ExpenseEntry = {
        id: uid(), createdAt: Date.now(),
        date: e.date, amount: e.amount, category: e.category, note: e.note,
      }
      // Assigned only when actually present: an explicit `undefined` value is
      // rejected by the Firestore SDK on save, which would break the whole
      // snapshot write for every entry, not just this one.
      if (e.foreignCurrency && typeof e.foreignAmount === 'number') {
        entry.foreignAmount   = e.foreignAmount
        entry.foreignCurrency = e.foreignCurrency
        if (typeof e.fxRate === 'number') entry.fxRate = e.fxRate
      }
      if (e.src) entry.src = e.src
      return { entries: [entry, ...s.entries] }
    }),

  update: (id, patch) =>
    set(s => ({
      entries: s.entries.map(en => en.id === id ? { ...en, ...patch } : en),
    })),

  remove: (id) =>
    set(s => ({ entries: s.entries.filter(en => en.id !== id) })),
}))
