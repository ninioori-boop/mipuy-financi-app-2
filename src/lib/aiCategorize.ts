import { ALL_CATEGORIES } from './constants'

const CATEGORY_SET = new Set(ALL_CATEGORIES)

// Single-merchant variant of the /api/categorize prompt. Same categories + rules,
// tuned for one business name (often English / a registered company name from
// Google Wallet) → one category.
const SYSTEM_PROMPT =
  'אתה מומחה לניתוח הוצאות פיננסיות בישראל.\n' +
  'קבל שם של בית עסק אחד (לפעמים באנגלית או שם חברה רשום) וסווג אותו לקטגוריה אחת.\n\n' +
  'קטגוריות אפשריות בלבד:\n' + ALL_CATEGORIES.join(', ') + '\n\n' +
  'כללים:\n' +
  '- בע"מ / ltd / llc — התעלם מסיומות משפטיות\n' +
  '- שם עיר — חלק ממיקום, לא מהשם\n' +
  '- אם לא בטוח — השתמש ב"שונות"\n' +
  '- אל תמציא קטגוריות חדשות\n\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף:\n' +
  '{"category":"שם הקטגוריה"}'

/**
 * Categorizes a single merchant via Claude — a fallback for when the rule-based
 * BUSINESS_DB doesn't recognize the merchant. Returns a valid category from
 * ALL_CATEGORIES, or null on any failure / invalid output (the caller then keeps
 * "שונות"). Never throws.
 */
export async function aiCategorizeOne(merchant: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !merchant.trim()) return null

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: merchant.trim().slice(0, 200) }],
      }),
    })
    if (!res.ok) return null

    const data = await res.json()
    const text = (data as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
    const match = text.match(/"category"\s*:\s*"([^"]+)"/)
    const category = match?.[1]?.trim()
    return category && CATEGORY_SET.has(category) ? category : null
  } catch {
    return null
  }
}
