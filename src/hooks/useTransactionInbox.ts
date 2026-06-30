'use client'

import { useEffect } from 'react'
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { saveUserData } from '@/lib/firestoreService'
import { collectSnapshot } from '@/lib/dataSync'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Drains the server-pushed transaction inbox into the expense log.
 *
 * /api/transaction (called by an iOS Shortcut / Android automation) writes each
 * charge to transactionInbox/{uid}/items. This hook listens for new items, adds
 * each to expenseLogStore (which DataSync then persists), and deletes the item.
 *
 * Durability: a newly-added charge's inbox item is deleted ONLY after the
 * snapshot is confirmed saved to Firestore. The inbox doc is the source of truth
 * until then — so if the save fails or the tab closes mid-drain, the charge is
 * NOT lost (it re-drains on the next session). The ref-based dup check keeps a
 * re-drain from double-adding. (Previously the item was deleted immediately after
 * the local add, before the debounced save — a charge could vanish in that gap.)
 *
 * Gated on `hydrated` so the add happens after the Firestore snapshot load (not
 * clobbered by it). Fully graceful: if the inbox rule isn't published yet the
 * snapshot listener just errors silently — a no-op that breaks nothing.
 */
export function useTransactionInbox() {
  const user     = useAuthStore(s => s.user)
  const hydrated = useSyncStore(s => s.hydrated)

  useEffect(() => {
    if (!user || !hydrated) return

    const itemsRef = collection(db, 'transactionInbox', user.uid, 'items')

    const unsub = onSnapshot(
      itemsRef,
      async snap => {
        const added = snap.docChanges().filter(c => c.type === 'added')
        if (added.length === 0) return

        const dropNow: string[] = []        // dup / malformed — nothing to persist, safe to delete
        const dropAfterSave: string[] = []  // newly added — delete ONLY after a confirmed save

        for (const change of added) {
          const id = change.doc.id
          const d  = change.doc.data() as {
            merchant?: unknown; amount?: unknown; date?: unknown; category?: unknown; ref?: unknown
          }

          const merchant = typeof d.merchant === 'string' ? d.merchant.trim() : ''
          const amount   = typeof d.amount === 'number' ? d.amount : NaN

          if (!(merchant && Number.isFinite(amount) && amount > 0)) {
            dropNow.push(id)   // malformed — discard
            continue
          }

          const ref = typeof d.ref === 'string' && d.ref ? d.ref : ''
          const note = merchant + (ref ? ` #${ref}` : '')
          const dup  = !!ref
            && useExpenseLogStore.getState().entries.some(e => e.note.endsWith(` #${ref}`))
          if (dup) {
            dropNow.push(id)   // already logged — safe to drop
            continue
          }

          useExpenseLogStore.getState().add({
            date:     typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : today(),
            amount,
            category: typeof d.category === 'string' && d.category ? d.category : 'שונות',
            note,
          })
          dropAfterSave.push(id)
        }

        // Dup/malformed: delete immediately — there's nothing to persist for them.
        for (const id of dropNow) {
          deleteDoc(doc(db, 'transactionInbox', user.uid, 'items', id)).catch(() => {})
        }

        // Newly-added charges: PERSIST FIRST, then delete. If the save throws or
        // the tab closes before it resolves, the inbox items survive and re-drain
        // next session — a charge can no longer be lost between add and save.
        if (dropAfterSave.length) {
          try {
            await saveUserData(user.uid, collectSnapshot())
          } catch {
            return  // leave the items in the inbox; they'll be retried next session
          }
          for (const id of dropAfterSave) {
            deleteDoc(doc(db, 'transactionInbox', user.uid, 'items', id)).catch(() => {})
          }
        }
      },
      () => { /* permission denied (rule not published) / offline — silent no-op */ },
    )

    return () => unsub()
  }, [user, hydrated])
}
