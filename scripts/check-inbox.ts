// Diagnostic: did the iPhone Shortcut's transaction reach the backend?
// Looks up Ori's uid by email, then prints recent transactionInbox items
// (waiting to be drained) and the newest expense-log entries from the saved
// snapshot. Read-only; prints merchant/amount/timestamps only.
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEY = join(__dirname, '..', 'service-account-key.json')
const EMAIL = 'ninioori@gmail.com'

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
  console.log(`uid for ${EMAIL} (ninioori): ${uid}`)

  const db = getFirestore()

  // TEMP: the diagnostic capture of the last raw /api/transaction payload —
  // shows the EXACT text the iOS Shortcut sent at runtime + which uid it used.
  const dbg = await db.collection('debug').doc('lastTx').get()
  if (dbg.exists) {
    const d = dbg.data()!
    let who = d.uid === uid ? 'ninioori ✓' : `OTHER account: ${d.uid}`
    if (d.uid !== uid) {
      try {
        const other = await getAuth().getUser(d.uid)
        who += ` → email: ${other.email ?? '(none)'} · name: ${other.displayName ?? '(none)'}`
      } catch { who += ' → (could not resolve email)' }
    }
    console.log(`\n─── debug/lastTx (last transaction the server received) ───`)
    console.log(`account:  ${who}`)
    console.log(`merchant: [${d.merchantType}] "${d.merchantValue}"`)
    console.log(`amount:   [${d.amountType}] ${JSON.stringify(d.amountValue)}`)
    console.log(`keys:     ${JSON.stringify(d.bodyKeys)}`)
    console.log(`at:       ${d.at?.toDate?.()?.toISOString?.() ?? '?'}`)
  } else {
    console.log(`\n─── debug/lastTx: (none yet — no transaction has hit the server since the trap was deployed) ───`)
  }

  // 1. Pending inbox items (arrived from a device, not yet drained by the web app)
  const inbox = await db.collection('transactionInbox').doc(uid).collection('items')
    .orderBy('createdAt', 'desc').limit(10).get()
  console.log(`\n─── transactionInbox pending items: ${inbox.size} ───`)
  for (const d of inbox.docs) {
    const x = d.data()
    console.log(`• ${x.date} | ${x.merchant} | ₪${x.amount} | cat=${x.category} | created=${x.createdAt?.toDate?.()?.toISOString?.() ?? '?'}`)
  }

  // 2. Newest entries already in the expense log (drained + saved)
  await dumpAccount(db, uid, 'ninioori')

  // 3. If the iPhone posted to a DIFFERENT account, dump that one too — the real
  //    transactions may have landed there all along.
  const dbgUid = dbg.exists ? (dbg.data()!.uid as string) : null
  if (dbgUid && dbgUid !== uid) {
    console.log(`\n═══ the OTHER account the iPhone is connected to (${dbgUid}) ═══`)
    await dumpAccount(db, dbgUid, 'iPhone account')
  }
}

async function dumpAccount(db: FirebaseFirestore.Firestore, uid: string, label: string) {
  const inbox = await db.collection('transactionInbox').doc(uid).collection('items')
    .orderBy('createdAt', 'desc').limit(10).get()
  console.log(`\n─── [${label}] transactionInbox pending: ${inbox.size} ───`)
  for (const d of inbox.docs) {
    const x = d.data()
    console.log(`• ${x.date} | ${x.merchant} | ₪${x.amount} | cat=${x.category}`)
  }
  const snap = await db.collection('users').doc(uid).get()
  const data = snap.exists ? (snap.data()?.data as { expenseLog?: { entries?: Array<{ date: string; amount: number; category: string; note: string; createdAt: number }> } } | undefined) : undefined
  const entries = data?.expenseLog?.entries ?? []
  const newest = [...entries].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 6)
  console.log(`─── [${label}] expenseLog: ${entries.length} entries; newest ───`)
  for (const e of newest) {
    console.log(`• ${e.date} | ${e.note} | ₪${e.amount} | cat=${e.category} | ${new Date(e.createdAt).toISOString()}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
