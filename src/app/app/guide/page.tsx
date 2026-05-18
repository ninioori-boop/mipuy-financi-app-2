export default function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Hero */}
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-8 text-center space-y-3">
        <div className="text-5xl">🏠</div>
        <h1 className="text-3xl font-black text-gold">The Home Economist</h1>
        <p className="text-muted-txt text-lg max-w-xl mx-auto">
          מפת הדרכים שלך לניהול פיננסי חכם — מאפיון ראשוני ועד תכנון לטווח ארוך
        </p>
      </div>

      {/* Workflow */}
      <div>
        <h2 className="text-xl font-bold text-txt mb-4">🗺️ מסלול העבודה המומלץ</h2>
        <div className="space-y-3">
          {([
            {
              step: '1', icon: '💳', tab: 'אשראי',
              title: 'ייבא דוחות כרטיס אשראי',
              desc: 'העלה קבצי Excel מכרטיסי האשראי שלך. המערכת מזהה עסקאות אוטומטית, מסווגת לפי קטגוריות ומאפשרת ניתוח AI לעסקאות לא מזוהות.',
              tip: 'הכי טוב להעלות 3 חודשים לפחות לקבל תמונה מייצגת',
              color: 'border-blue-400/30 bg-blue-400/5', num: 'bg-blue-400/20 text-blue-400',
            },
            {
              step: '2', icon: '🏦', tab: 'עו"ש',
              title: 'נתח דוח עו"ש',
              desc: 'העלה את דוח חשבון הבנק. ראה את כל העסקאות בטבלה, בחר הוצאות קבועות — ביטוחים, שכר דירה, מנויים — ושלח ישירות למיפוי.',
              tip: 'שימושי במיוחד לזיהוי הוראות קבע וחיובים חוזרים',
              color: 'border-cyan-400/30 bg-cyan-400/5', num: 'bg-cyan-400/20 text-cyan-400',
            },
            {
              step: '3', icon: '🗂️', tab: 'מיפוי',
              title: 'סדר את המיפוי הידני',
              desc: 'כאן מתגבשת תמונת ההוצאות שלך. חלק ל-5 קטגוריות: קבועות / משתנות / מנויים / ביטוחים / שנתיות. הנתונים מהאשראי ועו"ש מגיעים אוטומטית.',
              tip: 'שנתיות = תשלומים פעם בשנה (ביטוח רכב, חופשות, אירועים)',
              color: 'border-purple-400/30 bg-purple-400/5', num: 'bg-purple-400/20 text-purple-400',
            },
            {
              step: '4', icon: '📥', tab: 'ייבוא',
              title: 'ייבא ביצוע לתקציב חודשי',
              desc: 'העלה דוח אשראי לחודש ספציפי ושלח את הביצוע ישירות לטאב התקציב. המערכת ממלאת אוטומטית את עמודת "ביצוע בפועל".',
              tip: 'בחר את החודש הנכון לפני השליחה — כל העסקאות בקובץ יעברו לאותו חודש',
              color: 'border-green-400/30 bg-green-400/5', num: 'bg-green-400/20 text-green-400',
            },
            {
              step: '5', icon: '📅', tab: 'חודשי',
              title: 'עקוב אחר התקציב החודשי',
              desc: 'לכל חודש לוח תכנון מול ביצוע: הכנסות, קבועות, משתנות, מנויים, ביטוחים, תשלומים, חובות וחיסכון. תזרים מחושב אוטומטית בתחתית.',
              tip: 'גלול לתחתית הדף — סיכום תזרים מפורט עם תכנון מול ביצוע',
              color: 'border-gold/30 bg-gold/5', num: 'bg-gold/20 text-gold',
            },
            {
              step: '6', icon: '📆', tab: 'שנתי',
              title: 'בנה תכנון שנתי',
              desc: 'תצוגה מצטברת של כל השנה — הכנסות, הוצאות, חיסכון וחובות. הביצוע נשאב אוטומטית מהטאבים החודשיים. תצוגת תכנון / ביצוע / שניהם.',
              tip: 'הכנס כאן הוצאות שנתיות — ביטוח, חופשה, חינוך — לתמונה שלמה',
              color: 'border-orange-400/30 bg-orange-400/5', num: 'bg-orange-400/20 text-orange-400',
            },
            {
              step: '7', icon: '📊', tab: 'מגמות',
              title: 'נתח מגמות לאורך זמן',
              desc: 'גרפים אוטומטיים: הכנסות מול הוצאות / פירוט קטגוריות / תזרים חודשי / חיסכון מצטבר — הכל נגזר מהנתונים שהזנת בטאבים החודשיים.',
              tip: 'ככל שתכניס יותר חודשים, הגרפים יהיו אינפורמטיביים יותר',
              color: 'border-indigo-400/30 bg-indigo-400/5', num: 'bg-indigo-400/20 text-indigo-400',
            },
            {
              step: '8', icon: '💧', tab: 'התנהלות עו"ש',
              title: 'חשב את תקציב החיסכון החודשי',
              desc: 'הכלי שואב אוטומטית את ממוצע ההכנסות וההוצאות מהמיפוי, מחשב את העודף החודשי, ומאפשר להחליט כמה מהעודף נשאר ככרית בעו"ש (Buffer) וכמה עובר לחיסכון. אפשר לעדכן את הסכומים ידנית. 3 תרחישים לבחירה: שמרני, מאוזן, אגרסיבי.',
              tip: 'התקציב לחיסכון שמתקבל כאן זורם אוטומטית לטאב יעדים — אין צורך להזין שוב',
              color: 'border-sky-400/30 bg-sky-400/5', num: 'bg-sky-400/20 text-sky-400',
            },
            {
              step: '9', icon: '🎯', tab: 'יעדים',
              title: 'הגדר יעדים פיננסיים',
              desc: 'מטרות בשלושה טווחים: קצר (עד 3 שנים), בינוני (3–7) וארוך (7+). המערכת מחשבת כמה לחסוך כל חודש לפי הסכום הנדרש ותאריך היעד. בראש העמוד מוצג תקציב החיסכון החודשי מטאב התנהלות עו"ש — סכום כל יעד מתקזז ממנו עד שמוקצה הכל.',
              tip: 'מלא תאריך יעד וסכום נוכחי — ההפרשה החודשית תחושב אוטומטית',
              color: 'border-rose-400/30 bg-rose-400/5', num: 'bg-rose-400/20 text-rose-400',
            },
            {
              step: '10', icon: '📝', tab: 'פגישות',
              title: 'תעד פגישות ליווי',
              desc: 'תיעוד סיכומי הפגישות לאורך תהליך הליווי — 4 סוגי פגישות: מיפוי, תקציב, בקרה, תוכנית כלכלית. כל סיכום כולל: מה היה בפגישה, מסקנות, ומשימות לפגישה הבאה. ייצוא PDF ממותג לכל סיכום.',
              tip: 'כפתור "סיום" סוגר את הסיכום — הכל נשמר אוטומטית בענן בכל הקלדה',
              color: 'border-teal-400/30 bg-teal-400/5', num: 'bg-teal-400/20 text-teal-400',
            },
          ] as const).map(({ step, icon, tab, title, desc, tip, color, num }) => (
            <div key={step} className={`rounded-xl border p-5 ${color}`}>
              <div className="flex items-start gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 mt-0.5 ${num}`}>
                  {step}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-lg">{icon}</span>
                    <span className="font-bold text-txt">{title}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface border border-line text-muted-txt">{tab}</span>
                  </div>
                  <p className="text-sm text-muted-txt leading-relaxed">{desc}</p>
                  <div className="mt-2 flex items-start gap-1.5">
                    <span className="text-xs text-gold mt-0.5">💡</span>
                    <span className="text-xs text-gold/80">{tip}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calculators */}
      <div>
        <h2 className="text-xl font-bold text-txt mb-4">🧮 מחשבונים</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-line bg-surface2 p-5 space-y-2">
            <div className="flex items-center gap-2 font-bold text-txt"><span className="text-xl">💰</span> מחשבון הלוואות</div>
            <p className="text-sm text-muted-txt">תשלום חודשי, סך ריבית ולוח סילוקין מלא. תומך בשפיצר, קרן שווה, הצמדה למדד וחישוב דו-כיווני — לפי סכום הלוואה או לפי החזר חודשי רצוי.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-5 space-y-2">
            <div className="flex items-center gap-2 font-bold text-txt"><span className="text-xl">📈</span> ריבית דריבית + דמי ניהול</div>
            <p className="text-sm text-muted-txt">הדמה צמיחת השקעה עם הפקדה חודשית. כרטיסיית דמי ניהול משווה 4 תרחישים: ללא דמי ניהול / מהצבירה בלבד / מההפקדה בלבד / שניהם.</p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-xl font-bold text-txt mb-4">❓ שאלות נפוצות</h2>
        <div className="space-y-2">
          {([
            {
              q: 'מאיפה מורידים דוחות אשראי?',
              a: 'כל חברות האשראי (ישראכרט, ויזה כאל, מאסטרקארד לאומי) מאפשרות הורדת Excel מהאתר. חפש "ייצוא לאקסל" או "הורד דוח" באזור הדוחות.',
            },
            {
              q: 'האם הנתונים נשמרים?',
              a: 'כרגע הנתונים נשמרים בזיכרון הדפדפן — רענון הדף מוחק אותם. בגרסה הבאה תהיה שמירה מלאה ב-Firebase לכל משתמש לצמיתות.',
            },
            {
              q: 'מה ההבדל בין טאב אשראי לטאב ייבוא?',
              a: 'אשראי = אפיון כללי של ההוצאות. ייבוא = שליחת ביצוע חודשי ספציפי לתקציב, כלומר ממלא עמודת "ביצוע" לחודש שבחרת.',
            },
            {
              q: 'מה ההבדל בין שפיצר לקרן שווה?',
              a: 'שפיצר: תשלום קבוע בכל חודש — קל לתכנון. קרן שווה: קרן קבועה + ריבית יורדת — סה"כ ריבית נמוכה יותר אך תשלום ראשון גבוה יותר.',
            },
            {
              q: 'מה דמי ניהול מהצבירה לעומת מההפקדה?',
              a: 'מהצבירה: % שנתי מכלל הנכסים שלך (נגבה חודשית). מההפקדה: % שמנוכה מכל הפקדה חדשה לפני שנכנסת לחיסכון. בקרנות פנסיה ישראליות — שניהם יחד.',
            },
          ] as const).map(({ q, a }) => (
            <details key={q} className="rounded-xl border border-line bg-surface2 group">
              <summary className="p-4 font-medium text-txt cursor-pointer list-none flex items-center justify-between">
                <span>{q}</span>
                <span className="text-muted-txt text-xl leading-none group-open:rotate-45 transition-transform inline-block">+</span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-txt leading-relaxed border-t border-line pt-3">{a}</div>
            </details>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="rounded-xl border border-line bg-surface2 p-5 text-center text-sm text-muted-txt">
        <span className="text-gold font-semibold">The Home Economist</span> — כלי לניהול פיננסי אישי ועבודה עם יועצים פיננסיים
      </div>

    </div>
  )
}
