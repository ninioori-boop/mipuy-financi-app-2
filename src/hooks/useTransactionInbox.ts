'use client'

import { useEffect } from 'react'
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'

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
      snap => {
        snap.docChanges().forEach(change => {
          if (change.type !== 'added') return
          const id = change.doc.id
          const d  = change.doc.data() as {
            merchant?: unknown; amount?: unknown; date?: unknown; category?: unknown; ref?: unknown
          }

          const merchant = typeof d.merchant === 'string' ? d.merchant.trim() : ''
          const amount   = typeof d.amount === 'number' ? d.amount : NaN

          if (merchant && Number.isFinite(amount) && amount > 0) {
            const ref  = typeof d.ref === 'string' && d.ref ? d.ref : ''
            const note = merchant + (ref ? ` #${ref}` : '')
            const dup  = ref
              && useExpenseLogStore.getState().entries.some(e => e.note.endsWith(` #${ref}`))
            if (!dup) {
              useExpenseLogStore.getState().add({
                date:     typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : today(),
                amount,
                category: typeof d.category === 'string' && d.category ? d.category : 'שונות',
                note,
              })
            }
          }

          // Remove the item once ingested (or if it was malformed) so it isn't reprocessed.
          deleteDoc(doc(db, 'transactionInbox', user.uid, 'items', id)).catch(() => {})
        })
      },
      () => { /* permission denied (rule not published) / offline — silent no-op */ },
    )

    return () => unsub()
  }, [user, hydrated])
}
