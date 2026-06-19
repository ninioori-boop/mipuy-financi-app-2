'use client'

import Link from 'next/link'

const NOTES = [
  'כל מטרת המשימות היא שתביאו אלי את הנתונים. בפגישה ננתח הכול יחד ונבין מה ואיך צריך לעשות, ועכשיו חשוב רק לאסוף את כל הנתונים הרלוונטיים.',
  'אם יש שאלה, או שמשהו בתהליך לא ברור או נראה מוזר, זה ממש בסדר, ואני כאן בדיוק בשביל זה. שלחו הודעה ואני אחזור אליכם בהקדם.',
  'חשוב מאוד להעלות את כל הנתונים והמסמכים בדיוק כפי שכתוב במשימות, לשאלות המתאימות בעמוד "העלאת מסמכים".',
]

type Section = {
  icon: string
  title: string
  note?: string
  steps: string[]
  links?: { label: string; url: string }[]
}

const SECTIONS: Section[] = [
  {
    icon: '💰', title: 'נתוני הכנסות',
    steps: ['צירוף תלושי שכר משלושת החודשים האחרונים.'],
  },
  {
    icon: '🏦', title: 'חשבון בנק',
    note: 'אם יש יותר מחשבון אחד, בצעו את התהליך על כל חשבון בנפרד.',
    steps: [
      'היכנסו לאזור האישי בחשבון הבנק והורידו "תעודת זהות בנקאית".',
      'באזור העו"ש, ייצאו תנועות של שלושת החודשים האחרונים (גם זכות וגם חובה) בפורמט Excel.',
      'בתיק ניירות ערך / תיק מסחר, צלמו מסך של הרכב התיק והעלו את הצילום.',
      'באזור הפיקדונות הבנקאיים, צלמו את המסך.',
    ],
  },
  {
    icon: '💳', title: 'כרטיסי אשראי',
    note: 'אם יש יותר מכרטיס אחד, בצעו את התהליך על כל כרטיס בנפרד.',
    steps: [
      'היכנסו לאזור האישי של חברת האשראי.',
      'היכנסו לדוח ההוצאות החודשי.',
      'הורידו את הדוח בפורמט Excel לטווח של שלושה חודשים אחורה.',
    ],
  },
  {
    icon: '📑', title: 'הלוואות וחובות',
    steps: [
      'רשמו את כל ההלוואות הקיימות בשאלון.',
      'צרו קשר עם כל גוף שממנו נלקחה הלוואה ובקשו לוח סילוקין מלא ועדכני לכל הלוואה.',
      'העלו את לוח הסילוקין של כל הלוואה לשאלון.',
    ],
  },
  {
    icon: '🏛️', title: 'חסכונות, נכסים פיננסיים ומוצרים פנסיוניים',
    steps: [
      'היכנסו לאתר "הר הכסף" ובדקו אילו מוצרים פנסיוניים קיימים על שמכם.',
      'אם יש, היכנסו לאזור האישי בחברה שמנהלת את המוצר והורידו דו"ח מפורט (לדוגמה: קרן פנסיה ב"הראל", אזור אישי, הורדת דו"ח).',
      'העלו את כל הדו"חות לשאלון.',
    ],
    links: [{ label: 'הר הכסף', url: 'https://www.gov.il/he/service/pension_savings_search' }],
  },
  {
    icon: '🛡️', title: 'ביטוחים',
    steps: [
      'היכנסו לאתר "הר הביטוח" והתחברו לאזור האישי.',
      'צלמו את המסך של הביטוחים שברשותכם והעלו את הצילום לשאלון.',
    ],
    links: [{ label: 'הר הביטוח', url: 'https://harb.cma.gov.il/' }],
  },
  {
    icon: '📈', title: 'תיקי השקעות ונכסים נזילים',
    steps: [
      'חשבון מסחר עצמאי: צלמו מסך של הרכב התיק (שיראו את הסכומים) והעלו את הצילום לשאלון.',
      'דירה בבעלותכם: ציינו זאת בשאלון.',
      'מטבעות דיגיטליים: ציינו זאת בשאלון.',
    ],
  },
  {
    icon: '⭐', title: 'דירוג אשראי',
    steps: [
      'היכנסו לאתר "קפטן קרדיט" ובצעו רישום לבדיקת דירוג האשראי שלכם.',
      'צלמו את דירוג האשראי והעלו את התמונה לשאלון.',
    ],
    links: [{ label: 'קפטן קרדיט', url: 'https://captaincredit.co.il/' }],
  },
]

function CtaButton() {
  return (
    <Link
      href="/app/intake"
      className="inline-flex items-center gap-2 bg-gold text-surface font-bold rounded-xl px-5 py-3 hover:bg-gold-light transition-colors"
    >
      📤 לעמוד העלאת המסמכים ←
    </Link>
  )
}

export default function UploadGuidePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6 space-y-3">
        <h1 className="text-2xl font-bold text-gold">📋 משימות לקראת פגישת המיפוי</h1>
        <p className="text-sm text-txt leading-relaxed">
          כדי שנעשה את התהליך בצורה הכי טובה ואפקטיבית, וכדי שנוכל לייצר שינוי אמיתי, אני רוצה לדעת הכול.
          אז תכל&apos;ס, אלה המשימות שלכם כדי שנגיע לפגישה הבאה בצורה הכי טובה שיש:
          נייצא את כל הנתונים מכל מקום שיש או שיכול להיות בו כסף, לפי הסדר הבא.
        </p>
        <CtaButton />
      </div>

      {/* Important notes */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2">
        <h2 className="font-semibold text-txt">⚠️ כמה דגשים חשובים</h2>
        <ul className="space-y-2">
          {NOTES.map((n, i) => (
            <li key={i} className="flex gap-2 text-sm text-muted-txt leading-relaxed">
              <span className="text-gold shrink-0">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Task sections */}
      <div className="space-y-3">
        {SECTIONS.map((s, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2">
            <h2 className="font-semibold text-txt flex items-center gap-2">
              <span className="text-lg">{s.icon}</span>
              {s.title}
            </h2>
            {s.note && <p className="text-xs text-gold/80">{s.note}</p>}
            <ol className="space-y-1.5">
              {s.steps.map((step, j) => (
                <li key={j} className="flex gap-2.5 text-sm text-txt leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gold/15 text-gold text-xs font-bold flex items-center justify-center mt-0.5">{j + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {s.links && s.links.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {s.links.map(l => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/10 transition-colors"
                  >
                    🔗 {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer + CTA */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6 text-center space-y-3">
        <p className="text-sm text-txt font-semibold">עכשיו הגיע הזמן לתת בראש! מחכה לעדכונים 💪</p>
        <div><CtaButton /></div>
      </div>
    </div>
  )
}
