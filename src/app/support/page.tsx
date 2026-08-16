import { BrandContactEmail } from '@/components/layout/BrandProvider'

// Public support page. Apple and Google both require a Support URL on the store
// listing and both OPEN it during review, so this has to answer a stuck user's
// real questions — not market the product. The order below is the order the
// questions actually arrive in: install, then "nothing was recorded", then
// "it asks me to type", then account deletion.
export default function SupportPage() {
  return (
    <div className="min-h-screen bg-surface py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">

        <div className="text-center">
          <h1 className="text-3xl font-bold text-gold">תמיכה ועזרה</h1>
          <p className="text-muted-txt text-sm mt-2">
            לא מצאתם כאן תשובה? כתבו לנו ונחזור אליכם: <BrandContactEmail />
          </p>
        </div>

        <Section title="התקנה והגדרה ראשונה באייפון">
          <p>אחרי ההתקנה יש שתי פעולות חד פעמיות, ואחריהן הכול קורה לבד.</p>
          <ul>
            <li><strong>התחברות:</strong> הקישו על הכפתור במסך הפתיחה. ההתחברות נפתחת בספארי, ובסיומה חוזרים לאפליקציה לבד.</li>
            <li><strong>יצירת האוטומציה:</strong> במסך שמופיע אחרי ההתחברות הקישו על „הוסף את הקיצור”, ואז פתחו את „קיצורי דרך” ← „פעולות אוטומטיות” ← ＋ ← „ארנק” ← סמנו את הכרטיסים שלכם ← „הפעל מיד” ← ובחרו את הקיצור „תיעוד הוצאה”.</li>
          </ul>
          <p>
            יש <a href="/ios-setup.mp4" className="text-gold hover:underline">סרטון של 25 שניות</a> שמראה את כל התהליך על מכשיר אמיתי.
            אותו מדריך זמין גם בתוך האפליקציה.
          </p>
          <p className="text-muted-txt text-sm">
            בקיצור עצמו אין מה לערוך. אם הוא נראה לכם ריק או מוזר בעריכה, זה תקין. הוא מתמלא ברגע התשלום.
          </p>
        </Section>

        <Section title="באנדרואיד: גישה להתראות">
          <p>
            באנדרואיד הרישום נעשה דרך התראות התשלום של המכשיר, ולכן צריך לאשר לאפליקציה „גישה להתראות” פעם אחת,
            במסך ההגדרות שלה. בלי האישור הזה לא ייקלט שום חיוב.
          </p>
          <p>
            אנדרואיד מכבה לפעמים את ההרשאה הזאת מיוזמתו אחרי עדכון מערכת, בלי להודיע. לכן יש בהגדרות האפליקציה
            כפתור <strong>„בדוק שהמעקב פעיל”</strong>. אם הוא מדווח שהמעקב מנותק, כבו והדליקו את הגישה להתראות.
          </p>
        </Section>

        <Section title="הוצאה לא נרשמה. מה עושים?">
          <ul>
            <li><strong>באייפון, אם הטלפון פתח מקלדת וביקש להקליד:</strong> האוטומציה נוצרה בלי הקיצור המוכן. מחקו אותה, ובנו אותה מחדש לפי המדריך כשאתם בוחרים את הקיצור „תיעוד הוצאה”.</li>
            <li><strong>אם התקנתם מחדש את האפליקציה:</strong> אוטומציות קיימות מפסיקות לעבוד ומציגות „פעולה לא ידועה”. צריך למחוק ולבנות מחדש.</li>
            <li><strong>אם כל חיוב נרשם פעמיים:</strong> יש שתי אוטומציות פעילות על אותו כרטיס, בדרך כלל אחת ישנה מלפני המעבר לאפליקציה. כבו את הישנה בקיצורי דרך.</li>
            <li><strong>תשלום שאינו Apple Pay</strong> (מזומן, העברה, חיוב ישיר) לא נרשם אוטומטית מעצם טבעו. אפשר להוסיף אותו ידנית בכפתור „רשום הוצאה”.</li>
          </ul>
        </Section>

        <Section title="הסיווג לקטגוריה שגוי">
          <p>
            אפשר לשנות קטגוריה של כל רישום במסך תיעוד ההוצאות. השינוי נשמר, והמערכת לומדת ממנו לפעמים הבאות
            שאותו בית עסק יופיע.
          </p>
        </Section>

        <Section title="בעיות התחברות">
          <ul>
            <li>השתמשו באותה כתובת מייל שאיתה נפתח החשבון. כניסה במייל אחר תיראה בדיוק כמו חשבון חסום.</li>
            <li>אם אין לכם סיסמה, או שכחתם אותה, הקישו „שכחתי סיסמה / אין לי סיסמה” במסך ההתחברות. זה עובד גם לחשבון שנפתח במקור עם Google.</li>
            <li>הגישה למערכת היא בהזמנה. אם התחברתם והמסכים ריקים, ייתכן שהכתובת שלכם עדיין לא אושרה. כתבו לנו.</li>
          </ul>
        </Section>

        <Section title="מחיקת חשבון וייצוא נתונים">
          <p>
            המחיקה עצמאית ומלאה, ואפשר לבצע אותה מתוך האפליקציה: תפריט ← „החשבון שלי”. שם אפשר גם לייצא את
            הנתונים לפני המחיקה.
          </p>
          <p className="text-muted-txt text-sm">
            המחיקה מסירה את התיק הפיננסי, ההוצאות והיעדים. פירוט מלא של מה נשמר ומה נמחק נמצא ב
            <a href="/privacy" className="text-gold hover:underline">מדיניות הפרטיות</a>.
          </p>
        </Section>

        <Section title="פרטיות">
          <p>
            האפליקציה אינה קוראת התראות באייפון ואין לה גישה לארנק. האוטומציה שאתם יוצרים בעצמכם היא זו שמעבירה
            לה את פרטי החיוב, ומחיקה שלה מפסיקה את הרישום מיידית. המידע אינו נמכר ואינו מועבר לפרסום.
          </p>
          <p>
            <a href="/privacy" className="text-gold hover:underline">מדיניות הפרטיות המלאה ←</a>
          </p>
        </Section>

        <div className="text-center pt-4 border-t border-line">
          <a href="/app/guide" className="text-sm text-gold hover:underline">← חזרה לאפליקציה</a>
        </div>

      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface2 p-6 space-y-3">
      <h2 className="text-lg font-semibold text-gold">{title}</h2>
      <div className="text-sm text-txt space-y-2 leading-relaxed [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:mr-5 [&_strong]:text-txt">
        {children}
      </div>
    </div>
  )
}
