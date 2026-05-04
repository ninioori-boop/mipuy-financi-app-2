import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

/* ── User data ──────────────────────────────────────────────────── */

export async function saveUserData(uid: string, data: unknown): Promise<void> {
  await setDoc(doc(db, 'users', uid), { data, updatedAt: serverTimestamp() }, { merge: true })
}

export async function loadUserData(uid: string): Promise<unknown | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (snap.exists() && snap.data().data) return snap.data().data
  return null
}

export async function saveUserMeta(uid: string, meta: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, 'users', uid), { meta, updatedAt: serverTimestamp() }, { merge: true })
}

export async function getUserProfile(uid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null
}

export async function setUserProfile(uid: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, 'users', uid), data, { merge: true })
}

/* ── Financial maps ─────────────────────────────────────────────── */

export async function saveMap(
  clientUid: string,
  advisorUid: string,
  mapData: unknown,
): Promise<void> {
  await setDoc(
    doc(db, 'maps', clientUid),
    { clientUid, advisorUid, data: mapData, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function loadMap(clientUid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, 'maps', clientUid))
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null
}

/* ── Invite codes ───────────────────────────────────────────────── */

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function createInvite(advisorUid: string, clientName: string): Promise<string> {
  const code = generateInviteCode()
  await setDoc(doc(db, 'invites', code), {
    advisorUid,
    clientName,
    used: false,
    usedBy: null,
    createdAt: serverTimestamp(),
  })
  return code
}

export async function claimInvite(
  code: string,
  clientUid: string,
): Promise<{ advisorUid: string; clientName: string }> {
  const inviteRef = doc(db, 'invites', code)
  const snap = await getDoc(inviteRef)
  if (!snap.exists()) throw new Error('קוד הזמנה לא קיים')
  const invite = snap.data() as { advisorUid: string; clientName: string; used: boolean }
  if (invite.used) throw new Error('קוד הזמנה כבר נוצל')

  const batch = writeBatch(db)
  batch.update(inviteRef, { used: true, usedBy: clientUid })
  batch.set(doc(db, 'maps', clientUid), {
    clientUid,
    advisorUid: invite.advisorUid,
    clientName: invite.clientName,
    data: {},
    updatedAt: serverTimestamp(),
  })
  batch.set(
    doc(db, 'users', clientUid),
    { role: 'client', advisorId: invite.advisorUid, name: invite.clientName },
    { merge: true },
  )
  await batch.commit()
  return invite
}

/* ── Advisor client list ────────────────────────────────────────── */

export async function getAdvisorClients(
  advisorUid: string,
): Promise<Record<string, unknown>[]> {
  const q = query(collection(db, 'maps'), where('advisorUid', '==', advisorUid))
  const snap = await getDocs(q)
  return snap.docs.map((d) => d.data() as Record<string, unknown>)
}
