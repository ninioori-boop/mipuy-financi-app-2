import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAiSuggestion } from '@/lib/aiSuggestions'
import type { Firestore } from 'firebase-admin/firestore'

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }) },
}))

const set = vi.fn().mockResolvedValue(undefined)
const db = { collection: () => ({ doc: () => ({ set }) }) } as unknown as Firestore

beforeEach(() => { set.mockClear(); set.mockResolvedValue(undefined) })

describe('logAiSuggestion — what may enter the review funnel', () => {
  it('logs a real merchant the AI identified', async () => {
    await logAiSuggestion(db, 'קפה נמרוד רוטשילד', 'אוכל בחוץ ובילויים')
    expect(set).toHaveBeenCalledOnce()
    const key = Object.keys((set.mock.calls[0][0] as { sug: object }).sug)[0]
    expect(key).toBe('קפה נמרוד רוטשילד')
  })

  // The prompt instructs the model to answer שונות when it CANNOT identify the
  // business. Promoting that into learnedDB — consulted before BUSINESS_DB, by
  // substring — turns "unknown" into an override for every account.
  it('never logs the unknown sentinel', async () => {
    await logAiSuggestion(db, 'MESHULAM 4471', 'שונות')
    await logAiSuggestion(db, 'Apple Pay', 'שונות')
    expect(set).not.toHaveBeenCalled()
  })

  it('applies the full shared-pool gate, not just the rail check', async () => {
    await logAiSuggestion(db, 'BIT', 'אוכל בחוץ ובילויים')          // payment rail
    await logAiSuggestion(db, 'העברה בביט', 'מתנות')                 // rail, prefixed
    await logAiSuggestion(db, 'paypal *thing', 'תחביבים')            // never-share word
    await logAiSuggestion(db, 'play', 'אוכל בחוץ ובילויים')          // 4 chars — the hijack
    await logAiSuggestion(db, 'חנות ארוכה מספיק', 'ביט ללא מעקב')    // personal category
    expect(set).not.toHaveBeenCalled()
  })

  it('drops free-text descriptors that would fill the document', async () => {
    await logAiSuggestion(db, 'חיוב בכרטיס האשראי שלך בסך 45 שקלים בוצע היום בשעה 14:32 בעסק כלשהו', 'שונות')
    await logAiSuggestion(db, 'א'.repeat(60), 'מזון לבית')
    expect(set).not.toHaveBeenCalled()
  })

  it('never throws, and reports the failure rather than swallowing it silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    set.mockRejectedValueOnce(new Error('document exceeds maximum size'))
    await expect(logAiSuggestion(db, 'שופרסל דיל', 'מזון לבית')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
