import { getIdToken } from 'firebase/auth'
import { auth, getAppCheckToken } from './firebase'

export async function getAuthHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('לא מחובר')
  const token = await getIdToken(user, /* forceRefresh= */ true)
  return `Bearer ${token}`
}

/**
 * Headers for the AI API calls: JSON + Firebase auth, plus an App Check token
 * when available (attached as X-Firebase-AppCheck; omitted if App Check isn't set
 * up yet, so this is safe before reCAPTCHA registration).
 */
export async function aiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': await getAuthHeader(),
  }
  const appCheckToken = await getAppCheckToken()
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken
  return headers
}
