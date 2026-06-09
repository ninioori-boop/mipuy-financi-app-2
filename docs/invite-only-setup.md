# 🔐 Invite-Only — התקנה ותפעול

הרשמה בהזמנה בלבד: רק מיילים שאתה מאשר יכולים לפתוח חשבון (Email/Password **וגם** Google).
ממומש ב-**Cloud Function חוסמת** (`beforeUserCreated`) + רשימת `allowlist` ב-Firestore.

## 🛡️ הבטחה: משתמשים קיימים לא ייפגעו
הפונקציה רצה **אך ורק על יצירת חשבון חדש** — **לא** על כניסה. 10 המשתמשים הקיימים נכנסים כרגיל ולא נוגעים בה בכלל. בנוסף, סקריפט הזריעה מוסיף את כל המיילים הקיימים ל-allowlist כביטוח נוסף. הרשימה פרטית (לקוחות לא יכולים לקרוא אותה) ו**לא נוגעת בכללי Firestore החיים**.

---

## חלק א' — התקנה חד-פעמית

> מבוצע על ידך. כל שלב בטוח; הסיכון היחיד הוא בפונקציה עצמה — לכן **בודקים בסוף** לפני שסומכים.

1. **שדרג ל-Identity Platform** (נדרש ל-blocking functions): [Authentication → Settings](https://console.firebase.google.com/project/finance-machine-a36e9/authentication/settings) → Upgrade. שכבת-חינם נדיבה, לא שובר auth קיים.
2. **ודא תוכנית Blaze** (Cloud Functions דורשות): אם אתה על Spark — שדרג.
3. **התקן Firebase CLI** (לא מותקן): `npm i -g firebase-tools` ואז `firebase login`.
4. **התקן תלויות הפונקציה**: `cd functions && npm install && cd ..`
5. **זרע את המשתמשים הקיימים** (דורש `service-account-key.json` בשורש): `npx tsx scripts/seed-allowlist.ts`
   → מוסיף את כל 10 המיילים הקיימים ל-allowlist.
6. **פרוס את הפונקציה**: `firebase deploy --only functions`
   (פורס **רק** את הפונקציה — לא נוגע בכללים.)
7. **חבר את הטריגר** (אם לא אוטומטי): [Authentication → Settings → Blocking functions](https://console.firebase.google.com/project/finance-machine-a36e9/authentication/settings) → תחת "Before account creation" בחר את `gateSignup`.

### ✅ בדיקה לפני שסומכים (חובה)
- **חסום:** נסה להירשם עם מייל **חדש שלא ברשימה** → אמור להידחות עם "ההרשמה בהזמנה בלבד".
- **מותר:** הוסף מייל בדיקה (חלק ב'), הירשם איתו → אמור להצליח.
- **קיים:** התחבר עם חשבון קיים → עובד רגיל (מוכיח שאין פגיעה).

---

## חלק ב' — ⭐ איך לאפשר למישהו גישה (התפעול היומיומי)

כשלקוח חדש צריך גישה, אשר את המייל שלו באחת משתי דרכים:

### דרך 1 — דרך הקונסולה (ויזואלי, בלי כלים)
1. [Firestore → allowlist](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/data) → אם הקולקציה לא קיימת, "Start collection" בשם `allowlist`.
2. **Add document** → **Document ID** = המייל של הלקוח **באותיות קטנות בלבד** (למשל `dana@gmail.com`).
   ⚠️ **קריטי:** אפילו אות גדולה אחת (`Dana@…`) תמנע ממנו להיכנס — Firebase משווה אות-באות. תמיד הכל קטן.
3. (אופציונלי) הוסף שדה `email` עם אותו ערך. שמור.
4. זהו — הלקוח יכול עכשיו להירשם עם המייל הזה.

### דרך 2 — פקודה אחת (מהיר)
```bash
npx tsx scripts/allow-email.ts dana@gmail.com
```

### לבטל הרשמה עתידית
מחק את מסמך המייל מ-`allowlist`. _(זה מונע הרשמה **חדשה**; חשבון שכבר נוצר לא מושבת בכך — לזה השתמש ב-Authentication → Users → Disable.)_

---

## מה נבנה (לעיון)
- `functions/index.js` — הפונקציה החוסמת (`gateSignup`).
- `functions/package.json` — תלויות הפונקציה.
- `scripts/seed-allowlist.ts` — זריעת המשתמשים הקיימים.
- `scripts/allow-email.ts` — אישור מייל בודד.
- `firebase.json` — נוסף `functions`.

_נכתב: 2026-06-07._
