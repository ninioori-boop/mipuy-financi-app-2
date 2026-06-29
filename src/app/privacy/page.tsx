export default function PrivacyPage() {
  const updated = '29 ביוני 2026'

  return (
    <div className="min-h-screen bg-surface py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">

        <div className="text-center">
          <h1 className="text-3xl font-bold text-gold">מדיניות פרטיות ותנאי שימוש</h1>
          <p className="text-muted-txt text-sm mt-2">עודכן לאחרונה: {updated}</p>
        </div>

        <Section title="1. מי אנחנו">
          <p>
            <strong className="text-txt">The Home Economist</strong> היא אפליקציה לניהול ומיפוי פיננסי אישי.
            האפליקציה מופעלת על ידי יחיד/ים ומיועדת לשימוש אישי ומקצועי בישראל.
          </p>
          <p>לפניות: <a href="mailto:ninioori@gmail.com" className="text-gold hover:underline">ninioori@gmail.com</a></p>
        </Section>

        <Section title="2. איזה מידע נאסף">
          <ul>
            <li><strong>פרטי זיהוי:</strong> כתובת מייל ושם (דרך Google Sign-In או הרשמה ישירה)</li>
            <li><strong>נתוני כרטיס אשראי שמועלים:</strong> קבצי Excel שמעלה המשתמש — מעובדים בדפדפן ו/או נשלחים ל-Claude AI לצורך קטגוריזציה</li>
            <li><strong>נתוני תקציב ומיפוי:</strong> נשמרים ב-Firestore תחת ה-UID של המשתמש — נגישים אך ורק למשתמש עצמו</li>
            <li><strong>לוגים טכניים:</strong> Vercel ו-Firebase עשויים לשמור לוגי גישה סטנדרטיים (IP, זמן, נתיב)</li>
          </ul>
        </Section>

        <Section title="3. כיצד המידע משמש">
          <ul>
            <li>הצגת הנתונים למשתמש ושמירתם בין ביקורים</li>
            <li>שליחת תיאורי עסקאות ל-Claude API (Anthropic) לצורך קטגוריזציה אוטומטית — ללא פרטים מזהים נוספים</li>
            <li>שיפור דיוק הסיווג דרך מנגנון למידה מקומי (learnedDB) השמור בחשבון המשתמש</li>
          </ul>
          <p className="text-muted-txt text-sm">
            המידע <strong>לא</strong> נמכר, לא מועבר לצדדים שלישיים לצרכי פרסום, ולא משמש למטרות אחרות מאלה המפורטות כאן.
          </p>
        </Section>

        <Section title="4. אחסון, אבטחה ותקופת שמירה">
          <ul>
            <li>הנתונים מאוחסנים ב-<strong>Google Firebase Firestore</strong> (אזור אירופה)</li>
            <li>כל משתמש ניגש אך ורק לנתונים שלו — מוגן על ידי כללי Firestore Security Rules</li>
            <li>התקשורת מוצפנת ב-HTTPS בכל שלב</li>
            <li>מפתח ה-API של Claude מאוחסן אך ורק בשרת (Vercel Env Variables) ולא נחשף ללקוח</li>
            <li><strong>תקופת שמירה:</strong> הנתונים נשמרים כל עוד החשבון פעיל. עם מחיקת חשבון — כל הנתונים נמחקים תוך 30 ימים</li>
          </ul>
        </Section>

        <Section title="5. זכויות המשתמש לפי חוק הגנת הפרטיות הישראלי">
          <p>בהתאם לחוק הגנת הפרטיות, התשמ"א-1981 ולתקנות שהותקנו מכוחו, יש לך הזכות:</p>
          <ul>
            <li><strong>לעיין</strong> במידע השמור עליך</li>
            <li><strong>לתקן</strong> מידע שגוי</li>
            <li><strong>למחוק</strong> את חשבונך ואת כל הנתונים הקשורים אליו</li>
          </ul>
          <p>
            למימוש זכויות אלה, שלח בקשה ל:
            <a href="mailto:ninioori@gmail.com" className="text-gold hover:underline mr-1">ninioori@gmail.com</a>
            — תגובה תינתן תוך 30 ימים.
          </p>
        </Section>

        <Section title="6. קבצים המועלים לאפליקציה">
          <p>
            קבצי ה-Excel של דוחות האשראי <strong>מעובדים בדפדפן</strong>.
            תיאורי העסקאות (ללא מספרי כרטיס, פרטים אישיים, או יתרות) נשלחים ל-Claude AI לצורך קטגוריזציה.
            Anthropic (יצרנית Claude) כפופה למדיניות הפרטיות שלה — ראה{' '}
            <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
              anthropic.com/privacy
            </a>.
          </p>
        </Section>

        <Section title="7. עוגיות ואחסון מקומי (Cookies & localStorage)">
          <p>
            האפליקציה משתמשת ב-Session Cookies של Firebase ו-localStorage לצורך ניהול ההתחברות בלבד.
            אין שימוש בעוגיות פרסומיות, מעקב, או ניתוח התנהגות.
            ניתן לדחות את השימוש בעוגיות — אך הדבר ימנע התחברות לשירות.
          </p>
        </Section>

        <Section title="8. רשם מאגרי מידע">
          <p>
            בהתאם לחוק הגנת הפרטיות, מאגרי מידע מסוימים חייבים ברישום אצל רשם מאגרי המידע.
            אנו בוחנים את חובת הרישום ונפעל בהתאם לדרישות החוק. לפרטים נוספים פנו אלינו בכתובת{' '}
            <a href="mailto:ninioori@gmail.com" className="text-gold hover:underline">ninioori@gmail.com</a>.
          </p>
        </Section>

        <Section title="9. אפליקציית מעקב הוצאות אוטומטי (אנדרואיד)">
          <p>
            למשתמשים שמתקינים את אפליקציית האנדרואיד הנלווית (&quot;מעקב הוצאות&quot;), האפליקציה קוראת את{' '}
            <strong>התראות התשלום של Google Wallet</strong> במכשיר — אך ורק כדי לרשום הוצאות אוטומטית בחשבון שלך.
          </p>
          <ul>
            <li><strong>איזה מידע:</strong> שם בית העסק והסכום בלבד. תוכן התראות אחר אינו נקרא ואינו נשמר.</li>
            <li><strong>לאן:</strong> נשלח מוצפן (HTTPS) אך ורק לחשבון שלך במערכת, ומופיע בטאב תיעוד ההוצאות, מקוטלג.</li>
            <li><strong>מזהה מכשיר (טוקן):</strong> בעת חיבור האפליקציה נשמר במכשיר טוקן אישי שמקשר את ההוצאות לחשבונך. הטוקן מאפשר רק להוסיף הוצאות לחשבונך — לא לקרוא נתונים.</li>
            <li><strong>הרשאה:</strong> הגישה להתראות ניתנת על ידך במפורש (אחרי מסך גילוי), וניתנת לביטול בכל רגע בהגדרות המכשיר.</li>
            <li>המידע <strong>אינו</strong> משותף עם צד שלישי ואינו נמכר. הקטלוג מתבצע כמתואר בסעיף 3 (Claude AI, ללא פרטים מזהים).</li>
          </ul>
        </Section>

        <Section title="10. שינויים במדיניות">
          <p>
            במקרה של שינויים מהותיים, המשתמשים יקבלו הודעה בכניסה הבאה לאפליקציה.
            המשך השימוש לאחר פרסום השינויים מהווה הסכמה להם.
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
