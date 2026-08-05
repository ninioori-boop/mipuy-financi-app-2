// Diagnostic (read-only), authorized by Ori in chat (2026-07-16), PRIVACY-MINIMIZED:
// prints ONLY aggregate answers about eden00076@gmail.com — no expense listings,
// no history dump. Questions: (1) did the notification-flood payment duplicate
// in his expense log? (2) is he registered for branded push? (3) any other
// recent duplicates?
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEY = join(__dirname, '..', 'service-account-key.json')
const EMAIL = 'eden00076@gmail.com'

async function main() {
  const sa = JSON.parse(readFileSync(KEY, 'utf8')) as {
    project_id: string; client_email: string; private_key: string
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
    })
  }
  const uid = (await getAuth().getUserByEmail(EMAIL)).uid
  const db = getFirestore()

  // 1. Branded-push registration?
  const push = await db.collection('pushSubscriptions').doc(uid).get()
  const devices = push.exists ? Object.keys((push.data()?.subs as object) ?? {}).length : 0
  console.log(`push devices registered: ${devices}`)

  // 2. Pending inbox count (not yet drained into the app)
  const inbox = await db.collection('transactionInbox').doc(uid).collection('items').get()
  console.log(`inbox pending items: ${inbox.size}`)

  // 3. Duplicates in the expense log — aggregate only.
  const snap = await db.collection('users').doc(uid).get()
  const data = snap.exists ? (snap.data()?.data as { expenseLog?: { entries?: Array<{ date: string; amount: number; note: string; createdAt: number }> } } | undefined) : undefined
  const entries = data?.expenseLog?.entries ?? []
  console.log(`expenseLog total entries: ${entries.length}`)

  const cityMarket14 = entries.filter(e =>
    /city\s*market/i.test(e.note ?? '') && Math.abs(e.amount - 14) < 0.01).length
  console.log(`"City Market ₪14" occurrences: ${cityMarket14}`)

  const now = Date.now()
  const recent = entries.filter(e => now - (e.createdAt ?? 0) < 48 * 3600_000)
  const counts = new Map<string, number>()
  for (const e of recent) {
    const k = `${(e.note ?? '').replace(/ #.*$/, '')}|${e.amount}|${e.date}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dupGroups = [...counts.values()].filter(n => n > 1)
  console.log(`entries created in last 48h: ${recent.length}`)
  console.log(`duplicate groups in last 48h: ${dupGroups.length}${dupGroups.length ? ` (sizes: ${dupGroups.join(',')})` : ''}`)
}

main().catch(err => { console.error(err); process.exit(1) })
