'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

export interface GoalRow {
  id:         string
  name:       string
  required:   number
  current:    number
  monthly:    number
  targetDate: string   // 'YYYY-MM' format
  product:    string   // מוצר השקעה
  /** Does this money have to stay reachable, or can it be locked until the target
   *  date? Drives the short-term analysis (see lib/goalsAnalysis.ts). Undefined
   *  on goals created before the field existed — the analysis then asks for it. */
  liquidity?: 'liquid' | 'lockable'
  /** Medium-term risk appetite: how much of this money the client can stomach
   *  losing temporarily in a crisis. Drives the equity/solid tilt. */
  riskLevel?: 'solid' | 'balanced' | 'growth'
  /** Medium-term: managed product vs self-directed portfolio. Drives the
   *  concrete vehicles (provident fund vs DIY / US broker). */
  investorType?: 'managed' | 'diy'
  /** How much of the client's liquid-capital pool (liquidTotal) is earmarked
   *  for this goal. Shrinks the goal's remaining gap, and with it the
   *  auto-computed monthly contribution. Undefined on goals created before
   *  the field existed — treated as 0 everywhere. */
  liquidAllocated?: number
}

export type GoalHorizon = 'short' | 'medium' | 'long'

interface GoalsState {
  short:  GoalRow[]
  medium: GoalRow[]
  long:   GoalRow[]

  /** Client-level fact. US citizens must never be pointed at Israeli funds (PFIC),
   *  so the goals analysis gates on this. Asked once before the first analysis. */
  isUSCitizen: boolean | null
  setIsUSCitizen: (v: boolean) => void

  /** Client-level fact: how much liquid money is available to invest toward
   *  goals right now. The capital picture (savings accumulations + positive
   *  checking balances) is shown from the mapping tab, but the client decides
   *  this number himself — not all capital is liquid or investable. */
  liquidTotal: number
  setLiquidTotal: (v: number) => void

  addGoal:    (horizon: GoalHorizon) => void
  updateGoal: (horizon: GoalHorizon, id: string, field: keyof Omit<GoalRow, 'id'>, value: string | number) => void
  deleteGoal: (horizon: GoalHorizon, id: string) => void
}

function emptyRow(): GoalRow {
  return { id: uid(), name: '', required: 0, current: 0, monthly: 0, targetDate: '', product: '' }
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  short:  [emptyRow()],
  medium: [emptyRow()],
  long:   [emptyRow()],

  isUSCitizen: null,
  setIsUSCitizen: (v) => set({ isUSCitizen: v }),

  liquidTotal: 0,
  setLiquidTotal: (v) => set({ liquidTotal: Math.max(0, v) }),

  addGoal: (horizon) =>
    set(s => ({ [horizon]: [...s[horizon], emptyRow()] })),

  updateGoal: (horizon, id, field, value) =>
    set(s => ({
      [horizon]: (s[horizon] as GoalRow[]).map(r =>
        r.id === id ? { ...r, [field]: value } : r
      ),
    })),

  deleteGoal: (horizon, id) =>
    set(s => ({
      [horizon]: (s[horizon] as GoalRow[]).filter(r => r.id !== id),
    })),
}))
