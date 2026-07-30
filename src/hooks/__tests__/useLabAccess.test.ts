import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))

import { useLabAccess } from '@/hooks/useLabAccess'
import { useAuthStore } from '@/stores/authStore'
import type { User } from 'firebase/auth'

const asUser = (email: string | null) => ({ email, uid: 'u1' } as User)

beforeEach(() => {
  useAuthStore.setState({ user: null, advisorRole: null })
})

describe('useLabAccess', () => {
  it('grants immediately for a listed email, without waiting on the role', () => {
    useAuthStore.setState({ user: asUser('ninioori@gmail.com'), advisorRole: null })
    const { result } = renderHook(() => useLabAccess())
    expect(result.current).toEqual({ allowed: true, ready: true })
  })

  it('is case-insensitive on the email list', () => {
    useAuthStore.setState({ user: asUser('NinioOri@Gmail.com'), advisorRole: null })
    expect(renderHook(() => useLabAccess()).result.current.allowed).toBe(true)
  })

  it('grants to a real advisor who is NOT on the list (the whole point)', () => {
    useAuthStore.setState({ user: asUser('rgil724@gmail.com'), advisorRole: true })
    expect(renderHook(() => useLabAccess()).result.current).toEqual({ allowed: true, ready: true })
  })

  it('withholds a verdict while the role is unknown — guards must not redirect yet', () => {
    useAuthStore.setState({ user: asUser('client@example.com'), advisorRole: null })
    const { result } = renderHook(() => useLabAccess())
    expect(result.current).toEqual({ allowed: false, ready: false })
  })

  it('denies a plain client once the role has resolved', () => {
    useAuthStore.setState({ user: asUser('client@example.com'), advisorRole: false })
    expect(renderHook(() => useLabAccess()).result.current).toEqual({ allowed: false, ready: true })
  })

  it('setUser clears a cached role when the IDENTITY changes (no inheritance)', () => {
    useAuthStore.setState({ user: { email: 'rgil724@gmail.com', uid: 'advisor1' } as User, advisorRole: true })
    useAuthStore.getState().setUser({ email: 'client@example.com', uid: 'client9' } as User)
    expect(useAuthStore.getState().advisorRole).toBeNull()
    expect(renderHook(() => useLabAccess()).result.current).toEqual({ allowed: false, ready: false })
  })

  // Regression (grill, 2026-07-30): AuthProvider re-subscribes to
  // onAuthStateChanged on every client-side navigation (pathname is in its
  // deps) and Firebase replays the SAME user object to each new subscriber.
  // Clearing the role on those replays left every advisor locked out of the lab
  // pages after their first navigation, because the layout effect that
  // republishes the role is keyed on the unchanged `user` reference.
  it('setUser KEEPS the role when the same uid is re-notified (navigation replay)', () => {
    const sameUser = { email: 'rgil724@gmail.com', uid: 'advisor1' } as User
    useAuthStore.setState({ user: sameUser, advisorRole: true })

    useAuthStore.getState().setUser(sameUser)                                  // same reference
    expect(useAuthStore.getState().advisorRole).toBe(true)

    useAuthStore.getState().setUser({ ...sameUser } as User)                   // new object, same uid
    expect(useAuthStore.getState().advisorRole).toBe(true)
    expect(renderHook(() => useLabAccess()).result.current).toEqual({ allowed: true, ready: true })
  })

  it('sign-out clears the role', () => {
    useAuthStore.setState({ user: { email: 'rgil724@gmail.com', uid: 'advisor1' } as User, advisorRole: true })
    useAuthStore.getState().setUser(null)
    expect(useAuthStore.getState().advisorRole).toBeNull()
  })

  it('signed-out: no email, no role → no access, and not "ready" to redirect on', () => {
    useAuthStore.setState({ user: null, advisorRole: null })
    expect(renderHook(() => useLabAccess()).result.current).toEqual({ allowed: false, ready: false })
  })
})
