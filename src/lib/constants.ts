import type { MonthId, MonthMeta, MonthSection } from '@/types/budget'

export const MONTHS_LIST: MonthMeta[] = [
  { id: 'jan', name: 'ינואר' },
  { id: 'feb', name: 'פברואר' },
  { id: 'mar', name: 'מרץ' },
  { id: 'apr', name: 'אפריל' },
  { id: 'may', name: 'מאי' },
  { id: 'jun', name: 'יוני' },
  { id: 'jul', name: 'יולי' },
  { id: 'aug', name: 'אוגוסט' },
  { id: 'sep', name: 'ספטמבר' },
  { id: 'oct', name: 'אוקטובר' },
  { id: 'nov', name: 'נובמבר' },
  { id: 'dec', name: 'דצמבר' },
]

export const MONTH_IDS: MonthId[] = MONTHS_LIST.map(m => m.id)

// ⚠️ These names must NOT be the canonical category names. The mapping sync
// skips any category whose name already exists in the month, so a default row
// called "מזון לבית" would silently swallow the mapping plan for מזון לבית and
// the client's mapped budget would never reach their month. Tried on
// 2026-08-13; four existing tests caught it. The vocabulary gap is bridged by
// LEGACY_DEFAULT_ALIASES below instead.
export const MONTH_DEFAULT_ROWS: Record<MonthSection, string[]> = {
  income:   ['שכר עבודה (נטו)', 'קצבת ילדים', 'הכנסה נוספת'],
  fixed:    ['שכירות / משכנתא', 'ארנונה', 'ועד בית', 'חשמל', 'מים וגז'],
  variable: ['מזון וסופר', 'דלק ורכב', 'בריאות', 'ילדים וחינוך', 'פנאי ובילויים', 'הלבשה', 'מסעדות'],
  sub:      ['טלפון', 'אינטרנט', 'סטרימינג'],
  ins:      ['ביטוח חיים', 'ביטוח בריאות', 'ביטוח רכב'],
}

// The month's placeholder lines speak an older, human vocabulary; the annual
// plan, the mapping tab and the imported reports speak the canonical categories.
// Without a bridge, a plan for "מזון לבית" lands beside the empty "מזון וסופר"
// placeholder and the client sees two lines for one expense. The annual sync
// RENAMES such a placeholder into its canonical twin instead — only while the
// row is genuinely untouched and empty (see syncFromAnnual). The mapping sync is
// deliberately left out of this: it treats default rows as the client's own setup
// and adds its own line, which is long-standing, tested behaviour.
// Deliberately absent: 'שכירות / משכנתא' and 'מים וגז', each of which covers two
// canonical categories. There is no way to tell which one the client meant, and
// guessing would put a number on the wrong line.
export const LEGACY_DEFAULT_ALIASES: Record<string, string> = {
  'מזון וסופר':    'מזון לבית',
  'פנאי ובילויים': 'אוכל בחוץ ובילויים',
  'מסעדות':        'אוכל בחוץ ובילויים',
  'דלק ורכב':      'דלק וחניה',
  'ילדים וחינוך':  'חינוך וקייטנות',
  'הלבשה':         'ביגוד והנעלה',
  'ביגוד ושונות':  'ביגוד והנעלה',
  'טלפון':         'מנויים',
  'אינטרנט':       'מנויים',
  'סטרימינג':      'מנויים',
}

export const ALL_CATEGORIES: string[] = [
  'מזון לבית', 'אוכל בחוץ ובילויים', 'פארם', 'דלק וחניה', 'מתנות', 'ביגוד והנעלה',
  'תחבצ', 'כבישי אגרה', 'תספורת וקוסמטיקה', 'תחביבים', 'חופשה וטיול', 'תיקוני רכב',
  'בריאות', 'בעלי חיים', 'חינוך וקייטנות', 'שונות', 'ביט ללא מעקב', 'מזומן ללא מעקב',
  'ביטוח', 'תקשורת', 'מנויים', 'הוצאות בית', 'מיסים', 'עמלות בנק ואשראי', 'העברות ואשראי',
  'ביטוח לאומי', 'קופת חולים', 'תרומות', 'החזר הלוואות', 'ריהוט והבית', 'חדר כושר',
  'משכנתא', 'שכר דירה', 'ארנונה', 'דמי ניהול בניין', 'עוזרת בית', 'סיגריות',
  'צעצועים', 'כלי בית', 'חסכונות', 'הכנסות', 'השקעות', 'ציוד עסקי/משרדי', 'חומרי בניין',
]

export const CATEGORY_ICONS: Record<string, string> = {
  'מזון לבית': '🛒', 'אוכל בחוץ ובילויים': '🍽️', 'פארם': '💊',
  'דלק וחניה': '⛽', 'מתנות': '🎁', 'ביגוד והנעלה': '👔',
  'תחבצ': '🚌', 'כבישי אגרה': '🛣️', 'תספורת וקוסמטיקה': '💇',
  'תחביבים': '🎨', 'חופשה וטיול': '✈️', 'תיקוני רכב': '🔧',
  'בריאות': '🏥', 'בעלי חיים': '🐾', 'חינוך וקייטנות': '📚',
  'שונות': '📦', 'ביט ללא מעקב': '📱', 'מזומן ללא מעקב': '💵',
  'ביטוח': '🛡️', 'תקשורת': '📡', 'מנויים': '🎬', 'הוצאות בית': '🏠',
  'מיסים': '🏛️', 'עמלות בנק ואשראי': '🏦', 'העברות ואשראי': '💳',
  'ביטוח לאומי': '🛡️', 'קופת חולים': '🏥', 'תרומות': '❤️',
  'החזר הלוואות': '💳', 'ריהוט והבית': '🛋️', 'חדר כושר': '💪',
  'משכנתא': '🏠', 'שכר דירה': '🏠', 'ארנונה': '🏛️',
  'דמי ניהול בניין': '🏢', 'עוזרת בית': '🧹', 'סיגריות': '🚬',
  'צעצועים': '🧸', 'כלי בית': '🛠️', 'חסכונות': '🏦', 'הכנסות': '💰',
  'השקעות': '📈', 'ציוד עסקי/משרדי': '🖥️', 'חומרי בניין': '🧱',
}

// ── Category → mapping section classification (ported from v1 credit.js) ──

export const VAR_CATEGORIES = new Set([
  'מזון לבית', 'אוכל בחוץ ובילויים', 'פארם', 'דלק וחניה', 'ביגוד והנעלה',
  'תחבצ', 'כבישי אגרה', 'תספורת וקוסמטיקה', 'תחביבים',
  'תיקוני רכב', 'בריאות', 'בעלי חיים', 'חינוך וקייטנות', 'שונות',
  'ביט ללא מעקב', 'מזומן ללא מעקב', 'מתנות', 'עוזרת בית', 'סיגריות',
  'צעצועים', 'כלי בית', 'ריהוט והבית', 'תרומות',
  'ציוד עסקי/משרדי', 'חומרי בניין',
  'תקשורת',  // moved from SUB — covers iTunes / Google Play / variable digital purchases;
             // true monthly telcos (Cellcom, Bezeq) can still be carved out via SmartPatterns
])

export const ANNUAL_CATEGORIES = new Set([
  'חופשה וטיול',
])

export const FIXED_CATEGORIES = new Set([
  'קופת חולים', 'משכנתא', 'שכר דירה',
  'ארנונה', 'דמי ניהול בניין', 'החזר הלוואות', 'הוצאות בית', 'מיסים',
  'חשמל', 'גז', 'מים', 'ועד בית', 'ביוב', 'אינטרנט קווי',
  'עמלות בנק ואשראי',  // recurring monthly card/account fees — fixed cost, not a subscription
])

export const INSURANCE_CATEGORIES = new Set([
  'ביטוח', 'ביטוח לאומי', 'ביטוח רכב', 'ביטוח חיים', 'ביטוח בריאות', 'ביטוח רכוש',
])

export const SUB_CATEGORIES = new Set([
  'חדר כושר',
  'מנויים',  // new catch-all for streaming / telcos / SaaS / digital subs — populated by BUSINESS_DB
  'נטפליקס', 'ספוטיפיי', 'אפל', 'גוגל',  // legacy brand categories kept for back-compat with old saved snapshots
])

export const SKIP_CATEGORIES = new Set([
  'הכנסות', 'חסכונות', 'השקעות', 'העברות ואשראי',
])
