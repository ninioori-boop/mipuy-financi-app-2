'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading } = useAuthStore()
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)

      if (!user && !pathname.startsWith('/auth')) {
        router.replace('/auth')
      }
      if (user && pathname.startsWith('/auth')) {
        router.replace('/app/guide')
      }
    })
  }, [setUser, setLoading, router, pathname])

  return <>{children}</>
}
