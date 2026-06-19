'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The advisor review now lives inside the "העלאת מסמכים" tab (role-aware).
// This route is kept only to redirect any old link there.
export default function IntakeReviewRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/app/intake') }, [router])
  return null
}
