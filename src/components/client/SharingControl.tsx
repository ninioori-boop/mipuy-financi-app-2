'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { doc, getDoc } from 'firebase/firestore'
import { db, callable } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

// The client's own control over sharing with their advisor. Reads their own
// clientLinks/{uid} link and lets them grant or revoke at any time — this is the
// reversible half of consent. Renders `emptyFallback` (default: nothing) when the
// user has no advisor link, so it's safe to embed anywhere.

type Status = 'active' | 'declined' | 'revoked'
type Access = 'read' | 'write'
const EDIT_CONSENT_VERSION = 'v2'
interface LinkState {
  status: Status
  consentVersion: string
  access: Access
  requestedAccess?: 'write'
}

export function SharingControl({ emptyFallback = null }: { emptyFallback?: ReactNode }) {
  const { user } = useAuthStore()
  const [link, setLink] = useState<LinkState | null | 'none'>(null) // null = loading
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const snap = await getDoc(doc(db, 'clientLinks', user.uid))
      if (!snap.exists()) { setLink('none'); return }
      const d = snap.data()
      setLink({
        status: d.status,
        consentVersion: d.consentVersion || 'v1',
        access: d.access === 'write' ? 'write' : 'read',
        requestedAccess: d.requestedAccess === 'write' ? 'write' : undefined,
      })
    } catch {
      setLink('none')
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Sharing on/off (view tier). Preserves the current consentVersion.
  async function changeStatus(status: Status) {
    setBusy(true)
    try {
      const cv = link && link !== 'none' ? link.consentVersion : 'v1'
      await callable<{ status: string; consentVersion: string }, { ok: boolean }>('setClientSharing')(
        { status, consentVersion: cv },
      )
      await load()
      toast.success(status === 'active' ? 'השיתוף עם היועץ הופעל.' : 'השיתוף עם היועץ בוטל.')
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'משהו השתבש, נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  // Grant / stop edit access (write tier). Grant echoes consentVersion v2 to
  // satisfy the server's edit-consent check; stop drops back to read.
  async function changeAccess(access: Access) {
    setBusy(true)
    try {
      await callable<{ status: string; access: string; consentVersion: string }, { ok: boolean }>('setClientSharing')(
        { status: 'active', access, consentVersion: access === 'write' ? EDIT_CONSENT_VERSION : (link && link !== 'none' ? link.consentVersion : 'v1') },
      )
      await load()
      toast.success(access === 'write' ? 'אישרת ליועץ לערוך את הנתונים שלך.' : 'הפסקת את הרשאת העריכה של היועץ.')
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'משהו השתבש, נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (link === null) return null            // loading
  if (link === 'none') return <>{emptyFallback}</>

  const sharing     = link.status === 'active'
  const canEdit     = sharing && link.access === 'write'
  const editRequest = sharing && link.access !== 'write' && link.requestedAccess === 'write'

  return (
    <div className="rounded-2xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span aria-hidden>{canEdit ? '✏️' : sharing ? '👁️' : '🔒'}</span>
        <h2 className="font-semibold text-txt">שיתוף עם היועץ</h2>
      </div>
      <p className="text-sm text-muted-txt">
        {!sharing
          ? 'היועץ שלך לא רואה את הנתונים שלך כרגע. אפשר לשתף כדי שילווה אותך.'
          : canEdit
            ? 'היועץ שלך יכול לצפות בנתונים וגם לערוך אותם יחד איתך. כל עריכה נשמרת בהיסטוריה שלך, ואפשר להפסיק בכל עת.'
            : 'היועץ שלך יכול לצפות בתמונת המצב הפיננסית שלך (צפייה בלבד). אפשר להפסיק בכל עת.'}
      </p>

      {/* Edit-request banner — advisor asked for edit access, awaiting consent. */}
      {editRequest && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 space-y-2">
          <p className="text-sm text-txt">
            היועץ שלך ביקש הרשאה <strong>לערוך</strong> את הנתונים איתך (למשל לעדכן מיפוי, תקציב וסיכומי פגישות). אתה יכול לאשר או להשאיר במצב צפייה בלבד.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changeAccess('write')}
              disabled={busy}
              className="min-h-[44px] rounded-full bg-gold px-5 text-sm font-semibold text-surface transition-colors hover:bg-gold-light disabled:opacity-50"
            >
              {busy ? 'רגע…' : 'אפשר עריכה'}
            </button>
            <button
              onClick={() => changeAccess('read')}
              disabled={busy}
              className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-sm font-semibold text-muted-txt transition-colors hover:text-txt disabled:opacity-50"
            >
              השאר צפייה בלבד
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Stop edit access (stays shared, read-only) — only when write is granted. */}
        {canEdit && (
          <button
            onClick={() => changeAccess('read')}
            disabled={busy}
            className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-sm font-semibold text-muted-txt transition-colors hover:text-txt disabled:opacity-50"
          >
            {busy ? 'רגע…' : 'הפסק עריכה'}
          </button>
        )}
        {/* Share on/off toggle. */}
        <button
          onClick={() => changeStatus(sharing ? 'revoked' : 'active')}
          disabled={busy}
          className={`min-h-[44px] rounded-full px-5 text-sm font-semibold transition-colors disabled:opacity-50 ${
            sharing
              ? 'border border-line bg-surface text-muted-txt hover:text-expense hover:border-expense/40'
              : 'bg-gold text-surface hover:bg-gold-light'
          }`}
        >
          {busy ? 'רגע…' : sharing ? 'הפסק שיתוף' : 'שתף עם היועץ'}
        </button>
      </div>
    </div>
  )
}
