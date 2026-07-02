// Public account + data deletion page (required by Google Play's data-deletion
// policy). No auth — must be reachable by anyone.
export const metadata = {
  title: 'מחיקת חשבון ונתונים — הכלכלן של הבית',
  description: 'איך למחוק את החשבון והנתונים באפליקציית מעקב הוצאות — הכלכלן של הבית.',
}

export default function DeleteAccountPage() {
  return (
    <div dir="rtl" className="min-h-screen bg-surface text-txt flex justify-center px-5 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gold">מחיקת חשבון ונתונים</h1>
          <p className="text-muted-txt text-sm">אפליקציית „מעקב הוצאות — הכלכלן של הבית” · com.orimipuy.tracker</p>
        </header>

        <section className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <h2 className="font-semibold text-txt">איך לבקש מחיקה</h2>
          <p className="text-sm text-muted-txt leading-relaxed">
            כדי למחוק את חשבונך ואת כל הנתונים הקשורים אליו, שלח/י אימייל לכתובת{' '}
            <a href="mailto:ninioori@gmail.com?subject=בקשת מחיקת חשבון" className="text-gold hover:underline">ninioori@gmail.com</a>{' '}
            עם הנושא „בקשת מחיקת חשבון”, מכתובת האימייל שאיתה נרשמת. הבקשה תטופל תוך 30 יום, ותקבל/י אישור במייל.
          </p>
        </section>

        <section className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <h2 className="font-semibold text-txt">מה נמחק</h2>
          <ul className="text-sm text-muted-txt leading-relaxed list-disc pe-5 space-y-1">
            <li>חשבון המשתמש (כתובת האימייל וההרשאה).</li>
            <li>כל הנתונים הפיננסיים שלך: הוצאות, תקציבים, יעדים, מיפוי ותכנון — לצמיתות.</li>
            <li>טוקן המכשיר המשמש לקליטת עסקאות אוטומטית.</li>
          </ul>
          <p className="text-xs text-muted-txt">
            הנתונים נמחקים באופן מלא ואינם ניתנים לשחזור. לא נשמרים נתונים לאחר המחיקה.
          </p>
        </section>

        <footer className="text-xs text-muted-txt pt-2">
          לשאלות: <a href="mailto:ninioori@gmail.com" className="text-gold hover:underline">ninioori@gmail.com</a>
        </footer>
      </div>
    </div>
  )
}
