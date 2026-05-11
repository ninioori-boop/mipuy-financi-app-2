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
}

export type GoalHorizon = 'short' | 'medium' | 'long'

interface GoalsState {
  short:  GoalRow[]
  medium: GoalRow[]
  long:   GoalRow[]

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
