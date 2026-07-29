'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  EmailAuthProvider, GoogleAuthProvider, signOut,
  reauthenticateWithCredential, reauthenticateWithPopup,
} from 'firebase/auth'
import { auth, callable } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useAnnualStore } from '@/stores/annualStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { resetAllStores } from '@/lib/dataSync'
import { downloadSnapshotJson, downloadAnnualXlsx, downloadDocumentsIndex } from '@/lib/exportMyData'
import { useBrand } from '@/components/layout/BrandProvider'

type DeleteResult = { ok: boolean; authDeleted: boolean; leftovers: string[] }

export default function SettingsPage() {
  const user   = useAuthStore(s => s.user)
  // Export reads the live stores — before hydration they hold EMPTY defaults,
  // and an empty "backup" downloaded right before an irreversible deletion is
  // the worst possible outcome. Both actions gate on this.
  const hydrated = useSyncStore(s => s.hydrated)
  const brand  = useBrand()
  const [stage, setStage]       = useState<'idle' | 'confirm'>('idle')
  const [typed, setTyped]       = useState('')
  const [busy, setBusy]         = useState<null | 'export' | 'delete'>(null)
  const email = (user?.email ?? '').toLowerCase()

  async function handleExport() {
    if (!hydrated) { toast.error('הנתונים עוד נטענים, המתן רגע ונסה שוב.'); return }
    setBusy('export')
    try {
      downloadSnapshotJson()
      // Browsers ask permission for multiple downloads — spacing them out
      // gives the prompt a chance to appear instead of dropping files quietly.
      await new Promise(r => setTimeout(r, 400))
      const a = useAnnualStore.getState()
      const months = useMonthlyStore.getState().months
      await downloadAnnualXlsx({
        year: a.year, income: a.income, fixed: a.fixed, variable: a.variable,
        sub: a.sub, savings: a.savings, debt: a.debt, months,
      })
      await new Promise(r => setTimeout(r, 400))
      const files = await downloadDocumentsIndex()
      toast.success(files > 0
        ? `הופעלו שלוש הורדות (נתונים, אקסל, ורשימה של ${files} מסמכים). אם הדפדפן שאל על הורדות מרובות, אשר וודא שכל הקבצים ירדו.`
        : 'הופעלו ההורדות. אם הדפדפן שאל על הורדות מרובות, אשר וודא שהקבצים ירדו.', { duration: 8000 })
    } catch (e) {
      console.error(e)
      toast.error('ההורדה נכשלה, נסה שוב.')
    } finally {
      setBusy(null)
    }
  }

  /** Deletion is irreversible, so a stale session must not be able to trigger it. */
  async function reauthenticate(): Promise<boolean> {
    const u = auth.currentUser
    if (!u) return false
    // A fresh sign-in already satisfies the server's 5-minute auth_time gate —
    // and it is the ONLY path that works in the Android WebView, where both
    // window.prompt and popups are typically blocked.
    const last = Date.parse(u.metadata.lastSignInTime ?? '')
    if (Number.isFinite(last) && Date.now() - last < 4 * 60 * 1000) return true
    // Custom-token session (the phone app's WebView) has no provider to
    // re-authenticate against — the browser is the honest path.
    if (u.providerData.length === 0) {
      toast.error('כדי למחוק את החשבון, פתח את האתר בדפדפן והתחבר עם המייל או עם גוגל.', { duration: 12000 })
      return false
    }
    const isPassword = u.providerData.some(p => p.providerId === 'password')
    try {
      if (isPassword) {
        const pw = window.prompt('לאישור המחיקה, הקלד את הסיסמה של החשבון:')
        if (pw === null || pw === '') {
          // A WebView host that blocks prompt() returns null instantly — a
          // silent dead button would be worse than this message.
          toast.error('לא ניתן להזין סיסמה כאן. התנתק, התחבר מחדש, ונסה שוב מיד.', { duration: 10000 })
          return false
        }
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email ?? '', pw))
      } else {
        await reauthenticateWithPopup(u, new GoogleAuthProvider())
      }
      return true
    } catch {
      toast.error('האימות נכשל. אפשר גם להתנתק, להתחבר מחדש, ולנסות שוב מיד.', { duration: 10000 })
      return false
    }
  }

  async function handleDelete() {
    if (typed.trim().toLowerCase() !== email) {
      toast.error('כתובת המייל שהוקלדה אינה תואמת.')
      return
    }
    setBusy('delete')
    try {
      if (!(await reauthenticate())) { setBusy(null); return }
      const res = await callable<{ confirmEmail: string }, DeleteResult>('deleteMyAccount')({ confirmEmail: email })
      const data = res.data
      const uid = user?.uid
      // Stop this tab from writing anything back, then leave no local copy of
      // the financial file behind on the device. signOut FIRST — the pagehide
      // flush could otherwise re-create the backup key during navigation.
      useSyncStore.getState().setDirty(false)
      resetAllStores()
      await signOut(auth).catch(() => {})
      try {
        if (uid) {
          localStorage.removeItem(`snapshot-backup:${uid}`)
          localStorage.removeItem(`brandCache:${uid}`)
        }
        sessionStorage.clear()
      } catch { /* private mode */ }
      // A surviving Auth user or any data remnant means the deletion was NOT
      // clean — never show plain success over it.
      if (!data?.authDeleted || data?.leftovers?.length) {
        toast.warning('החשבון נמחק חלקית. פנה אלינו ונשלים את המחיקה.', { duration: 15000 })
      }
      window.location.assign('/delete-account?done=1')
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'המחיקה נכשלה.'
      toast.error(msg, { duration: 12000, style: { width: 'min(92vw, 480px)' } })
      setBusy(null)
    }
  }

  if (!user) return null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-txt">החשבון שלי</h1>
        <p className="text-muted-txt text-sm mt-1">{email}</p>
      </header>

      <section className="rounded-2xl border border-line bg-surface2 p-5 space-y-3">
        <h2 className="font-bold text-txt">הורדת עותק של הנתונים שלי</h2>
        <p className="text-sm text-muted-txt leading-relaxed">
          נוריד למכשיר שלך שלושה קבצים: קובץ עם כל הנתונים, קובץ אקסל של התקציב השנתי,
          ורשימה של המסמכים שהעלית עם קישורי הורדה. מומלץ להוריד לפני מחיקה, כי אחריה
          לא נוכל לספק עותק.
        </p>
        <button
          onClick={handleExport}
          disabled={busy !== null || !hydrated}
          className="min-h-[42px] rounded-full bg-gold text-[color:var(--primary-foreground,#0F0F0F)] px-5 font-bold hover:bg-gold-light transition-colors disabled:opacity-60"
        >
          {!hydrated ? 'טוען נתונים…' : busy === 'export' ? 'מוריד…' : 'הורדת עותק של הנתונים שלי'}
        </button>
      </section>

      <section className="rounded-2xl border border-expense/40 bg-expense/5 p-5 space-y-3">
        <h2 className="font-bold text-expense">מחיקת החשבון</h2>

        {stage === 'idle' && (
          <>
            <p className="text-sm text-txt leading-relaxed">
              הפעולה מוחקת את החשבון מיד ולתמיד. אין תקופת התאוששות ואין דרך לשחזר, גם לא על ידינו.
            </p>
            <p className="text-sm text-muted-txt leading-relaxed">
              <b className="text-txt">מה יימחק:</b> המיפוי הפיננסי, התקציב החודשי והשנתי, היעדים,
              תיעוד ההוצאות, ההלוואות והחובות, נתוני העסק, סיכומי הפגישות, היסטוריית הגרסאות,
              המסמכים שהעלית, והקישור ליועץ שלך.
            </p>
            <p className="text-sm text-muted-txt leading-relaxed">
              <b className="text-txt">מה יישאר:</b> רשומת שליחה טכנית ביומן המיילים שלנו, שכתובת
              המייל שלך מוסרת ממנה, מילון כללי של שמות בתי עסק שאין בו שם, סכום, תאריך או כל
              פרט מזהה, ומזהה טכני אנונימי שנשמר כדי למנוע שחזור של החשבון.
            </p>
            <button
              onClick={() => setStage('confirm')}
              disabled={!hydrated}
              className="min-h-[42px] rounded-full border border-expense text-expense px-5 font-bold hover:bg-expense/10 transition-colors disabled:opacity-50"
            >
              מחיקת החשבון
            </button>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <p className="text-sm text-txt leading-relaxed">
              הורדת עותק? אחרי האישור הזה לא תהיה אפשרות נוספת.
            </p>
            <label className="block text-sm text-muted-txt">
              להשלמה, הקלד את כתובת המייל של החשבון:
              <input
                dir="ltr"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={email}
                className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-txt"
              />
            </label>
            <p className="text-sm text-expense font-semibold">⚠️ המחיקה מיידית ובלתי הפיכה.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setStage('idle'); setTyped('') }}
                disabled={busy === 'delete'}
                className="min-h-[42px] rounded-full border border-line px-5 text-txt hover:bg-surface3 transition-colors"
              >
                ביטול
              </button>
              <button
                onClick={handleDelete}
                disabled={busy === 'delete' || typed.trim().toLowerCase() !== email}
                className="min-h-[42px] rounded-full bg-expense text-white px-5 font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {busy === 'delete' ? 'מוחק…' : 'מחק את החשבון לצמיתות'}
              </button>
            </div>
          </>
        )}
      </section>

      <p className="text-xs text-muted-txt">
        <Link href="/privacy" className="text-gold hover:underline">מדיניות הפרטיות</Link>
        {' · '}
        <Link href="/delete-account" className="text-gold hover:underline">על מחיקת חשבון</Link>
        {' · '}
        {brand.contactEmail}
      </p>
    </div>
  )
}
