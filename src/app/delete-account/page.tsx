// Public account + data deletion page (required by Google Play's data-deletion
// policy). No auth — must be reachable by anyone.
import { BRAND } from '@/lib/brand'
import { BrandContactEmail } from '@/components/layout/BrandProvider'

export const metadata = {
  title: `מחיקת חשבון ונתונים — ${BRAND.nameHe}`,
  description: `איך למחוק את החשבון והנתונים באפליקציית ${BRAND.appShortName} — ${BRAND.nameHe}.`,
}

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const done = (await searchParams)?.done === '1'
  return (
    <div dir="rtl" className="min-h-screen bg-surface text-txt flex justify-center px-5 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gold">מחיקת חשבון ונתונים</h1>
          <p className="text-muted-txt text-sm">אפליקציית „{BRAND.appShortName} — {BRAND.nameHe}” · {BRAND.androidPackage}</p>
        </header>

        {done && (
          <section className="rounded-xl border border-gold/40 bg-gold/10 p-5 space-y-2">
            <h2 className="font-semibold text-gold">החשבון נמחק</h2>
            <p className="text-sm text-txt leading-relaxed">
              הנתונים שלך הוסרו מהמערכת ושלחנו אישור לכתובת המייל שלך.
              אם התקנת בטלפון את אפליקציית מעקב ההוצאות, יש להסיר אותה מהמכשיר.
            </p>
          </section>
        )}

        <section className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <h2 className="font-semibold text-txt">איך למחוק את החשבון</h2>
          <p className="text-sm text-muted-txt leading-relaxed">
            אפשר למחוק את החשבון בעצמך, מיד ובלי לפנות אלינו: היכנס/י למערכת, לתפריט,
            אל „החשבון שלי”, ושם „מחיקת החשבון”. המחיקה מתבצעת מיד וללא אפשרות שחזור,
            ותקבל/י אישור במייל. לפני המחיקה אפשר להוריד עותק של כל הנתונים שלך.
          </p>
          <p className="text-sm text-muted-txt leading-relaxed">
            אם איבדת גישה לחשבון ואינך יכול/ה להיכנס, שלח/י אלינו אימייל לכתובת{' '}
            <BrandContactEmail subject="בקשת מחיקת חשבון" />{' '}
            מכתובת האימייל שאיתה נרשמת, עם הנושא „בקשת מחיקת חשבון”. נטפל בבקשה תוך 14 יום ונשלח אישור.
          </p>
        </section>

        <section className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <h2 className="font-semibold text-txt">מה נמחק</h2>
          <ul className="text-sm text-muted-txt leading-relaxed list-disc pe-5 space-y-1">
            <li>חשבון המשתמש (כתובת האימייל וההרשאה).</li>
            <li>כל הנתונים הפיננסיים שלך: מיפוי, תקציב חודשי ושנתי, הוצאות, יעדים, הלוואות, נתוני עסק, סיכומי פגישות והיסטוריית הגרסאות. לצמיתות.</li>
            <li>המסמכים שהעלית למערכת, והתשובות שמילאת בשאלון הקליטה.</li>
            <li>הקישור ליועץ הפיננסי שלך, אם קיים. היועץ מקבל הודעה שהחשבון הוסר, בלי נתונים פיננסיים.</li>
            <li>החיבור של אפליקציית מעקב ההוצאות בטלפון מנותק, והשרת מפסיק לקבל ממנה נתונים. את האפליקציה עצמה יש להסיר מהמכשיר ידנית.</li>
          </ul>
          <p className="text-xs text-muted-txt leading-relaxed">
            הנתונים נמחקים לצמיתות ואינם ניתנים לשחזור, גם לא על ידינו. שלוש חריגות: ביומן
            המיילים שלנו נשארת רשומת שליחה טכנית שכתובת המייל שלך מוסרת ממנה, מילון כללי
            של שמות בתי עסק שאין בו שם, סכום, תאריך או כל פרט מזהה, ומזהה טכני אנונימי
            שנשמר כדי למנוע שחזור של החשבון. אם הורדת עותק של הנתונים
            למכשיר שלך, העותק הזה נשאר אצלך ובאחריותך.
          </p>
        </section>

        <footer className="text-xs text-muted-txt pt-2">
          לשאלות: <BrandContactEmail />
        </footer>
      </div>
    </div>
  )
}
