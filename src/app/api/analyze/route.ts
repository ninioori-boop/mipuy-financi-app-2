import { NextRequest, NextResponse } from 'next/server'

const rateLimitMap = new Map<string, { count: number; start: number }>()
const RATE_LIMIT = 10
const WINDOW_MS  = 60_000

function isRateLimited(ip: string): boolean {
  const now   = Date.now()
  const entry = rateLimitMap.get(ip) ?? { count: 0, start: now }
  if (now - entry.start > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now })
    return false
  }
  if (entry.count >= RATE_LIMIT) return true
  entry.count++
  rateLimitMap.set(ip, entry)
  return false
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'יותר מדי בקשות — נסו שוב עוד דקה' }, { status: 429 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, { status: 500 })
  }

  const body = await req.json()
  const { system, message } = body

  if (!message) {
    return NextResponse.json({ error: 'חסר message' }, { status: 400 })
  }

  const msgLen = ((system as string) ?? '').length + (message as string).length
  if (msgLen > 60_000) {
    return NextResponse.json({ error: 'הבקשה גדולה מדי' }, { status: 400 })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     system ?? undefined,
      messages:   [{ role: 'user', content: message }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: (err as { error?: { message?: string } }).error?.message ?? `שגיאת API ${res.status}` },
      { status: res.status },
    )
  }

  const data = await res.json()
  const text = (data as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
  return NextResponse.json({ text })
}
