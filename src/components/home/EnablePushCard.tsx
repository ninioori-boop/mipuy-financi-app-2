'use client'

import { useEffect, useState } from 'react'
import { getIdToken } from 'firebase/auth'
import { auth } from '@/lib/firebase'

// One-tap opt-in for branded push notifications. Renders ONLY when it can
// actually work and isn't already done:
//   - VAPID public key is configured (feature-gated: safe to deploy first)
//   - the browser supports Push (on iOS that means the INSTALLED home-screen
//     app, 16.4+ — a plain Safari tab has no PushManager, so the card hides)
//   - permission isn't denied and the device isn't already subscribed
// Once subscribed, capture notifications arrive from the server with the
// app's own name + icon — replacing the Shortcuts-branded one on iPhone.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const DISMISS_KEY = 'pushCardDismissed'

type State = 'hidden' | 'available' | 'busy' | 'done' | 'error'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  const idToken = await getIdToken(user)
  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  return res.ok
}

export function EnablePushCard() {
  const [state, setState] = useState<State>('hidden')

  useEffect(() => {
    let cancelled = false
    async function evaluate() {
      if (
        !VAPID_PUBLIC_KEY ||
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        Notification.permission === 'denied' ||
        localStorage.getItem(DISMISS_KEY)
      ) {
        return
      }
      if (Notification.permission === 'granted') {
        // Already granted: refresh the server record silently and stay hidden.
        try {
          const reg = await navigator.serviceWorker.register('/sw.js')
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            await postSubscription(sub)
            return
          }
        } catch {
          /* fall through to showing the card */
        }
      }
      if (!cancelled) setState('available')
    }
    evaluate()
    return () => {
      cancelled = true
    }
  }, [])

  async function enable() {
    if (!VAPID_PUBLIC_KEY) return
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('hidden')
        return
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }))
      const ok = await postSubscription(sub)
      setState(ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setState('hidden')
  }

  if (state === 'hidden') return null

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-income/40 bg-income/10 p-4 text-center text-sm font-semibold text-income">
        🔔 ההתראות הופעלו! מעכשיו כל תשלום שנקלט יגיע כהתראה של האפליקציה.
      </div>
    )
  }

  return (
    <div className="relative rounded-2xl border border-gold/40 bg-gold/10 p-4">
      <button
        onClick={dismiss}
        aria-label="סגור"
        className="absolute top-1 start-1 flex size-9 items-center justify-center rounded-full text-muted-txt hover:text-txt transition-colors"
      >
        ✕
      </button>
      <p className="text-sm font-semibold text-txt mb-1">🔔 קבל התראה על כל הוצאה שנקלטת</p>
      <p className="text-xs text-muted-txt mb-3">
        כולל כמה נשאר בתקציב — ישירות למסך הנעילה, בלחיצה אחת.
      </p>
      <button
        onClick={enable}
        disabled={state === 'busy'}
        className="w-full min-h-[44px] rounded-xl bg-gold text-surface text-sm font-bold hover:bg-gold-light active:bg-gold-dark transition-colors disabled:opacity-50"
      >
        {state === 'busy' ? 'מפעיל…' : 'הפעל התראות'}
      </button>
      {state === 'error' && (
        <p className="mt-2 text-xs text-expense text-center">ההפעלה נכשלה, נסה שוב מאוחר יותר</p>
      )}
    </div>
  )
}
