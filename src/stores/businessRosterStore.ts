'use client'

import { create } from 'zustand'

/**
 * The roster of businesses a household runs — shared by BOTH business tabs
 * (monthly תקציב עסקי and שנתי עסקי). Holds identity only (id + name); the
 * numbers live in businessStore / businessAnnualStore, each keyed by the same
 * id. Nothing is shared by reference between those stores — only the id string.
 *
 * Why a separate store: two spouses can each own a business, and the person
 * expects "העסק של רותי" picked in the monthly tab to still be the selected
 * business when they move to the annual tab.
 *
 * Never mutate the roster directly from a page — go through
 * `@/lib/businessProfiles`, which keeps the two data stores in step.
 */

export const PRIMARY_BUSINESS_ID = 'primary'
export const DEFAULT_BUSINESS_NAME = 'העסק שלי'

export interface BizProfile {
  id: string
  name: string
}

function uid() { return 'biz_' + Math.random().toString(36).slice(2, 10) }

/** Make `base` unique against the existing names by suffixing 2, 3, … */
export function uniqueName(base: string, taken: string[]): string {
  const trimmed = base.trim() || DEFAULT_BUSINESS_NAME
  if (!taken.includes(trimmed)) return trimmed
  let n = 2
  while (taken.includes(`${trimmed} ${n}`)) n++
  return `${trimmed} ${n}`
}

interface RosterState {
  list: BizProfile[]
  activeId: string

  setActive: (id: string) => void
  rename: (id: string, name: string) => void

  /** Append an empty profile, make it active, return its id. */
  add: (name?: string) => string
  /** Append a copy of `sourceId`'s identity, make it active, return its id. */
  duplicate: (sourceId: string) => string
  /** Remove a profile. The last remaining one can never be removed. */
  remove: (id: string) => void
}

export const DEFAULT_ROSTER: BizProfile[] = [
  { id: PRIMARY_BUSINESS_ID, name: DEFAULT_BUSINESS_NAME },
]

export const useBusinessRosterStore = create<RosterState>((set, get) => ({
  list: [...DEFAULT_ROSTER],
  activeId: PRIMARY_BUSINESS_ID,

  setActive: (id) => {
    if (!get().list.some(p => p.id === id)) return
    set({ activeId: id })
  },

  rename: (id, name) => set({
    list: get().list.map(p => p.id === id ? { ...p, name: name.trim() || p.name } : p),
  }),

  add: (name) => {
    const list = get().list
    const id = uid()
    const finalName = uniqueName(name || 'עסק נוסף', list.map(p => p.name))
    set({ list: [...list, { id, name: finalName }], activeId: id })
    return id
  },

  duplicate: (sourceId) => {
    const list = get().list
    const src = list.find(p => p.id === sourceId)
    const id = uid()
    // no em-dash in client-facing Hebrew copy
    const finalName = uniqueName(src ? `עותק של ${src.name}` : 'עסק נוסף', list.map(p => p.name))
    set({ list: [...list, { id, name: finalName }], activeId: id })
    return id
  },

  remove: (id) => {
    const list = get().list
    if (list.length <= 1) return          // always keep at least one business
    const next = list.filter(p => p.id !== id)
    if (next.length === list.length) return
    set({
      list: next,
      activeId: get().activeId === id ? next[0].id : get().activeId,
    })
  },
}))
