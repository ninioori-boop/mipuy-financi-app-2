'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, loading } = useAuthStore()
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    getRedirectResult(auth).catch(() => {})

    return onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)

      if (!user && !pathname.startsWith('/auth') && !pathname.startsWith('/privacy')) {
        router.replace('/auth')
      }
      if (user && pathname.startsWith('/auth')) {
        router.replace('/app/guide')
      }
    })
  }, [setUser, setLoading, router, pathname])

  // Prevent content flash while auth state resolves
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}
