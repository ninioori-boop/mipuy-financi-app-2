'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type MeetingType = 'mapping' | 'budget' | 'review' | 'plan'

export const MEETING_LABELS: Record<MeetingType, string> = {
  mapping: 'פגישת מיפוי',
  budget:  'פגישת תקציב',
  review:  'פגישת בקרה',
  plan:    'פגישת תוכנית כלכלית',
}

export const MEETING_TEMPLATES: Record<MeetingType, string> = {
  mapping: '',
  budget:  '',
  review:  '',
  plan:    '',
}

/** A single checkable action item the advisor assigns; the client marks it done.
 *  Counted in the weekly advisor digest ("השלים X מתוך Y משימות"). */
export interface TaskItem {
  id:   string
  text: string
  done: boolean
}

export interface Meeting {
  id: string
  type: MeetingType
  date: string           // YYYY-MM-DD
  title: string
  prepNotes: string      // נקודות לקראת הפגישה — מה שעלה ליועץ מהמיפוי (פגישת מיפוי בלבד)
  summary: string        // מה היה בפגישה
  actionItems: string    // מסקנות מהפגישה
  nextSteps: string      // הערות חופשיות לפגישה הבאה (טקסט; נשמר לצד המשימות המסומנות)
  tasks: TaskItem[]      // משימות עם וי — היועץ מקצה, הלקוח מסמן; נספרות במייל השבועי
  createdAt: number
  updatedAt: number
}

interface MeetingsState {
  meetings: Meeting[]

  add:    (type: MeetingType) => string
  update: (id: string, patch: Partial<Omit<Meeting, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void

  // Task checklist (per meeting)
  addTask:        (meetingId: string, text: string) => void
  toggleTask:     (meetingId: string, taskId: string) => void
  updateTaskText: (meetingId: string, taskId: string, text: string) => void
  deleteTask:     (meetingId: string, taskId: string) => void
}

export const useMeetingsStore = create<MeetingsState>((set) => ({
  meetings: [],

  add: (type) => {
    const id = uid()
    const now = Date.now()
    const m: Meeting = {
      id,
      type,
      date: today(),
      title: `סיכום ${MEETING_LABELS[type]}`,
      prepNotes: '',
      summary: MEETING_TEMPLATES[type],
      actionItems: '',
      nextSteps: '',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    }
    set(s => ({ meetings: [m, ...s.meetings] }))
    return id
  },

  update: (id, patch) =>
    set(s => ({
      meetings: s.meetings.map(m =>
        m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m
      ),
    })),

  remove: (id) =>
    set(s => ({ meetings: s.meetings.filter(m => m.id !== id) })),

  // ── Task checklist ── (m.tasks may be undefined on meetings saved before the
  // field existed — always read it as `m.tasks ?? []`.)
  addTask: (meetingId, text) =>
    set(s => ({
      meetings: s.meetings.map(m =>
        m.id === meetingId
          ? { ...m, tasks: [...(m.tasks ?? []), { id: uid(), text, done: false }], updatedAt: Date.now() }
          : m,
      ),
    })),

  toggleTask: (meetingId, taskId) =>
    set(s => ({
      meetings: s.meetings.map(m =>
        m.id === meetingId
          ? { ...m, tasks: (m.tasks ?? []).map(t => t.id === taskId ? { ...t, done: !t.done } : t), updatedAt: Date.now() }
          : m,
      ),
    })),

  updateTaskText: (meetingId, taskId, text) =>
    set(s => ({
      meetings: s.meetings.map(m =>
        m.id === meetingId
          ? { ...m, tasks: (m.tasks ?? []).map(t => t.id === taskId ? { ...t, text } : t), updatedAt: Date.now() }
          : m,
      ),
    })),

  deleteTask: (meetingId, taskId) =>
    set(s => ({
      meetings: s.meetings.map(m =>
        m.id === meetingId
          ? { ...m, tasks: (m.tasks ?? []).filter(t => t.id !== taskId), updatedAt: Date.now() }
          : m,
      ),
    })),
}))
