'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useBusinessRosterStore } from '@/stores/businessRosterStore'
import { addBusiness, duplicateBusiness, removeBusiness } from '@/lib/businessProfiles'

/**
 * The businesses bar — shown identically at the top of both business tabs.
 * Picking a business here switches BOTH tabs, because the roster is shared.
 *
 * Used when a household runs more than one business (e.g. both spouses are
 * עצמאים): שכפל copies the whole budget of the current business into a new one.
 *
 * Live for every client since 2026-08-04 (was lab-gated for one release while
 * Ori tested it). A household that never adds a second business sees a single
 * name and the buttons, and nothing else about the tabs changes.
 */
export function BusinessSwitcher() {
  const list = useBusinessRosterStore(s => s.list)
  const activeId = useBusinessRosterStore(s => s.activeId)
  const setActive = useBusinessRosterStore(s => s.setActive)
  const rename = useBusinessRosterStore(s => s.rename)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const active = list.find(p => p.id === activeId) ?? list[0]
  const single = list.length <= 1

  function startRename() {
    setDraft(active?.name ?? '')
    setEditing(true)
  }

  function commitRename() {
    const name = draft.trim()
    if (name && active && name !== active.name) {
      rename(active.id, name)
      toast.success(`השם עודכן ל"${name}"`)
    }
    setEditing(false)
  }

  function onDuplicate() {
    if (!active) return
    const id = duplicateBusiness(active.id)
    const created = useBusinessRosterStore.getState().list.find(p => p.id === id)
    toast.success(`נוצר עותק: "${created?.name}". אפשר לשנות את השם ואת הסכומים.`)
    startRenameFor(created?.name ?? '')
  }

  function onAdd() {
    const id = addBusiness()
    const created = useBusinessRosterStore.getState().list.find(p => p.id === id)
    toast.success(`נוסף עסק חדש: "${created?.name}"`)
    startRenameFor(created?.name ?? '')
  }

  function startRenameFor(name: string) {
    setDraft(name)
    setEditing(true)
  }

  function onRemove() {
    if (!active || single) return
    if (!confirm(`למחוק את "${active.name}"? כל הנתונים שלו בטאב החודשי ובטאב השנתי יימחקו.`)) return
    const name = active.name
    if (removeBusiness(active.id)) toast.success(`"${name}" נמחק`)
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-txt">
          🏢 העסקים במשק הבית
          {!single && <span className="text-[10px] font-normal text-muted-txt/70 ms-1.5">({list.length})</span>}
        </span>
        <span className="text-[10px] text-muted-txt/70">הבחירה חלה גם על התקציב החודשי וגם על השנתי</span>
      </div>

      {/* Business pills */}
      {!single && (
        <div className="flex flex-wrap gap-1.5">
          {list.map(p => (
            <button
              key={p.id}
              onClick={() => { setEditing(false); setActive(p.id) }}
              className={`px-3 py-2 min-h-[44px] flex items-center rounded-lg text-xs font-medium border transition-colors ${
                p.id === activeId
                  ? 'bg-gold/20 border-gold/60 text-gold'
                  : 'bg-surface2 border-line text-muted-txt hover:text-txt hover:border-gold/40'
              }`}
            >{p.name}</button>
          ))}
        </div>
      )}

      {/* Name + actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {editing ? (
          <>
            <input
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder="שם העסק"
              className="flex-1 min-w-[8rem] rounded-lg border border-gold/60 bg-surface2 px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none"
            />
            <button
              onClick={commitRename}
              className="px-3 py-2 min-h-[44px] rounded-lg border border-gold/40 bg-gold/15 text-gold text-xs font-bold hover:bg-gold/25 transition-colors"
            >שמור</button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 min-h-[44px] rounded-lg border border-line bg-surface2 text-muted-txt text-xs hover:text-txt transition-colors"
            >ביטול</button>
          </>
        ) : (
          <>
            <span className="text-sm font-bold text-gold flex-1 min-w-[6rem] truncate">{active?.name}</span>
            <button
              onClick={startRename}
              title="שנה שם"
              className="px-3 py-2 min-h-[44px] rounded-lg border border-line bg-surface2 text-muted-txt text-xs hover:text-gold hover:border-gold/40 transition-colors"
            >✎ שם</button>
            <button
              onClick={onDuplicate}
              title="צור עותק של העסק הזה, כולל כל השורות והסכומים"
              className="px-3 py-2 min-h-[44px] rounded-lg border border-gold/40 bg-gold/10 text-gold text-xs font-semibold hover:bg-gold/20 transition-colors"
            >⧉ שכפל עסק</button>
            <button
              onClick={onAdd}
              title="פתח עסק חדש וריק"
              className="px-3 py-2 min-h-[44px] rounded-lg border border-line bg-surface2 text-muted-txt text-xs hover:text-gold hover:border-gold/40 transition-colors"
            >+ עסק חדש</button>
            {!single && (
              <button
                onClick={onRemove}
                title="מחק את העסק הנוכחי"
                className="px-3 py-2 min-h-[44px] rounded-lg border border-line bg-surface2 text-muted-txt text-xs hover:text-expense hover:border-expense/40 transition-colors"
              >🗑</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
