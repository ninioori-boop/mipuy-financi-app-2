'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()
  const router   = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    setMounted(true)
    getRedirectResult(auth).catch(() => {})

    return onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
      setAuthReady(true)

      if (!user && !pathname.startsWith('/auth') && !pathname.startsWith('/privacy') && !pathname.startsWith('/connect')) {
        router.replace('/auth')
      }
      if (user && pathname.startsWith('/auth')) {
        router.replace('/welcome')
      }
    })
  }, [setUser, setLoading, router, pathname])

  // Show spinner only after mount (client-side only) to avoid hydration mismatch
  if (mounted && !authReady) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}
