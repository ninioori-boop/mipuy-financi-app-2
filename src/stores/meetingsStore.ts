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
  mapping:
`מצב פיננסי כיום:
-

הוצאות שזוהו:
-

מקורות הכנסה:
-

חובות והלוואות:
-

נושאים שעלו:
- `,
  budget:
`תקציב חודשי מוסכם:
-

חלוקה לקטגוריות:
-

שינויים מהמיפוי:
-

אתגרי יישום:
- `,
  review:
`ביצוע מול תכנון:
-

חריגות:
-

שיפורים מהפעם הקודמת:
-

הזדמנויות:
- `,
  plan:
`יעדים לטווח קצר (עד שנה):
-

יעדים לטווח בינוני (1-5 שנים):
-

יעדים לטווח ארוך (5+ שנים):
-

אסטרטגיית חיסכון/השקעה:
-

ניהול חוב:
-

אבני דרך:
- `,
}

export interface Meeting {
  id: string
  type: MeetingType
  date: string           // YYYY-MM-DD
  title: string
  summary: string
  actionItems: string
  createdAt: number
  updatedAt: number
}

interface MeetingsState {
  meetings: Meeting[]

  add:    (type: MeetingType) => string
  update: (id: string, patch: Partial<Omit<Meeting, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
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
      summary: MEETING_TEMPLATES[type],
      actionItems: '',
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
}))
