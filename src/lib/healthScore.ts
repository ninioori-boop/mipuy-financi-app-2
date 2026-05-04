export interface HealthTip {
  icon: string
  text: string
}

export interface HealthScoreResult {
  score: number
  color: string
  label: string
  tips: HealthTip[]
}

export function buildHealthScore(
  income: number,
  expenses: number,
  subs: number,
  balance: number,
): HealthScoreResult {
  let score = 100
  const ratio = income > 0 ? expenses / income : 1
  if (ratio > 1)       score -= 40
  else if (ratio > .9) score -= 25
  else if (ratio > .7) score -= 10

  const subRatio = income > 0 ? subs / income : 0
  if (subRatio > .15)   score -= 15
  else if (subRatio > .1) score -= 8

  if (balance < 0)                  score -= 20
  else if (balance < income * .1)   score -= 10

  score = Math.max(0, Math.min(100, Math.round(score)))

  const color = score >= 75 ? '#43e97b' : score >= 50 ? '#f7971e' : '#ff6584'
  const label = score >= 75 ? 'מצוין' : score >= 50 ? 'בינוני' : 'דורש שיפור'

  const tips: HealthTip[] = []
  if (ratio > .9)      tips.push({ icon: '⚠️', text: 'ההוצאות גבוהות מאוד ביחס להכנסה' })
  if (subRatio > .1)   tips.push({ icon: '📡', text: 'שקול לצמצם מינויים — מעל 10% מההכנסה' })
  if (balance < 0)     tips.push({ icon: '🔴', text: 'ההוצאות חורגות מההכנסות — יש לאזן' })
  if (balance >= 0 && ratio <= .7) tips.push({ icon: '✅', text: 'חיסכון טוב — שקול להשקיע את העודף' })
  if (tips.length === 0) tips.push({ icon: '💚', text: 'מצב פיננסי תקין — המשך כך!' })

  return { score, color, label, tips }
}
