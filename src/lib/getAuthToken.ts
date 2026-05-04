import { getIdToken } from 'firebase/auth'
import { auth } from './firebase'

export async function getAuthHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('לא מחובר')
  const token = await getIdToken(user, /* forceRefresh= */ true)
  return `Bearer ${token}`
}
