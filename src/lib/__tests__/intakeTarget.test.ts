import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reported from production 2026-08-11: an advisor inside a client's account
// opened the intake screen and saw HIS OWN phone, name and uploaded documents.
// Every function in intake.ts resolved auth.currentUser.uid, so the advisor
// could never see whether the client had uploaded anything — while the banner
// promised "השינויים נשמרים אצל הלקוח".
//
// These tests pin the two halves of the fix: reads follow the client, writes
// never leave the owner (both rule files reserve intake writes for the owner).

const docMock = vi.fn(() => ({}))
const collectionMock = vi.fn(() => ({}))

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'ADVISOR_UID', email: 'ori@x.com', displayName: 'Ori' } },
  db: {},
  storage: {},
}))
vi.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => docMock(...(a.slice(1) as [])),
  collection: (...a: unknown[]) => collectionMock(...(a.slice(1) as [])),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'ts'),
  query: vi.fn((x: unknown) => x),
  orderBy: vi.fn(),
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn(),
}))

import {
  loadMyAnswers, listMyIntake, saveAnswers, uploadIntakeFile, deleteIntakeFile,
  isActingAsClient, type IntakeFile,
} from '@/lib/intake'
import { useImpersonationStore } from '@/stores/impersonationStore'

const CLIENT = { uid: 'CLIENT_UID', name: 'לקוחה', email: 'c@x.com' }
const actAsClient = () => useImpersonationStore.getState().start(CLIENT, 'edit')

beforeEach(() => {
  useImpersonationStore.getState().clearOnIdentityTeardown()
  docMock.mockClear()
  collectionMock.mockClear()
})

describe('whose intake is loaded', () => {
  it('reads the signed-in account when nobody is being impersonated', async () => {
    await loadMyAnswers()
    expect(docMock).toHaveBeenCalledWith('intake', 'ADVISOR_UID')
  })

  it('reads the CLIENT when an advisor is acting as one', async () => {
    actAsClient()
    await loadMyAnswers()
    expect(docMock).toHaveBeenCalledWith('intake', 'CLIENT_UID')
    expect(docMock).not.toHaveBeenCalledWith('intake', 'ADVISOR_UID')
  })

  it('lists the CLIENT files, not the advisor own folder', async () => {
    actAsClient()
    await listMyIntake()
    expect(collectionMock).toHaveBeenCalledWith('intake', 'CLIENT_UID', 'files')
  })

  it('lists the advisor own files again once the session ends', async () => {
    actAsClient()
    useImpersonationStore.getState().clearOnIdentityTeardown()
    await listMyIntake()
    expect(collectionMock).toHaveBeenCalledWith('intake', 'ADVISOR_UID', 'files')
  })
})

describe('writes never leave the owner', () => {
  const file = { id: 'f1', name: 'a.pdf', type: 'application/pdf', size: 1, path: 'intake/x/a.pdf', uploadedAt: 0 } as IntakeFile

  it('refuses to save answers while acting as a client', async () => {
    actAsClient()
    await expect(saveAnswers({ phone: '050' })).rejects.toThrow(/לצפייה בלבד/)
  })

  it('refuses to upload while acting as a client', async () => {
    actAsClient()
    await expect(uploadIntakeFile(new File(['x'], 'a.pdf'))).rejects.toThrow(/לצפייה בלבד/)
  })

  it('refuses to delete while acting as a client', async () => {
    actAsClient()
    await expect(deleteIntakeFile(file)).rejects.toThrow(/לצפייה בלבד/)
  })

  it('still lets a real client write in their own account', async () => {
    await expect(saveAnswers({ phone: '050' })).resolves.toBeUndefined()
    expect(docMock).toHaveBeenCalledWith('intake', 'ADVISOR_UID')
  })
})

describe('isActingAsClient', () => {
  it('tracks the impersonation session', () => {
    expect(isActingAsClient()).toBe(false)
    actAsClient()
    expect(isActingAsClient()).toBe(true)
  })
})
