# 📲 קליטת הוצאות אוטומטית מ-Google Pay / Apple Pay — תוכנית

**מטרה (החזון):** המשתמש משלם ב-Google Pay או Apple Pay → התשלום נכנס **לבד ומיד** לטאב
**תיעוד הוצאות**, **מקוטלג אוטומטית**, בלי שום פעולה ידנית. כמו Money Master.

**פלטפורמות יעד:** גם iOS וגם אנדרואיד.

> סטטוס (2026-06-20, עודכן): **המסלול השקט מאומת מקצה-לקצה, חי ב-staging, וניקוי-האבטחה הושלם! 🎉** ההפעלה + E2E + סיבוב שני הסודות (TRANSACTION_SECRET + מפתח-השירות, הישן נמחק) — כולם בוצעו ואומתו. **נשאר רק: (ג) בניית הטריגרים — Shortcut ל-iOS / אפליקציית native לאנדרואיד (הלקוח מתקין → מאשר הרשאה → קולט אוטומטית).**
> עיקרון-על: **לא לשבור את המערכת החיה.** הכל תוספתי ומבודד. גיבוי כללים: `firestore.rules.backup-before-inbox-2026-06-15`.

---

## ⏭️ מה נשאר לעשות (תמצית להמשך)

**הקוד + ההפעלה הושלמו.** נשארו: בדיקה, טריגרים, וניקוי-אבטחה.

### ✅ שלב א׳ — הפעלת ה-backend — הושלם (2026-06-15)
`FIREBASE_SERVICE_ACCOUNT` + `TRANSACTION_SECRET` הוגדרו ב-Vercel (Sensitive, Production+Preview) ונעשה Redeploy. כלל `transactionInbox` פורסם ב-Firestore (גיבוי הקודם: `firestore.rules.backup-before-inbox-2026-06-15`). אומת מהשרת: `/api/transaction` עבר מ-503 ל-401 → firebase-admin מחובר וה-secret נטען.

### ✅ שלב ב׳ — בדיקת E2E — הושלם (2026-06-18)
הטוקן מאי-ההתאמה תוקן ע"י ייצורו מהאפליקציה החיה (מעבדה → 🔑) במקום מקומית. `POST /api/transaction` עם הטוקן החזיר **`{"ok":true,"category":"מזון לבית"}`** ("רמי לוי" קוטלג נכון). Ori אישר שהעסקה **הופיעה לבד בטאב תיעוד הוצאות** דרך ה-onSnapshot drain. **כל הצינור מאומת מקצה-לקצה.** (הערה: curl על Windows שולח עברית מקולקלת → "שונות"; node/השולחים-האמיתיים שולחים UTF-8 נקי. דרך לשלוח בדיקה מ-node: `fetch(..., {body: JSON.stringify({token, merchant:'רמי לוי', amount, ref})})`.)

### 🔲 שלב ג׳ — הטריגרים האמיתיים ("השומר", חוליה ①)
- **iOS:** Shortcut אוטומציית Wallet → "Get Contents of URL" POST ל-`/api/transaction` עם הטוקן + Merchant + Amount. (בדיקה דורשת אייפון של לקוח.)
- **אנדרואיד (מוצר, היעד):** אפליקציית **native** (Capacitor + NotificationListenerService) שמתקינה מ-Google Play. הלקוח מתקין → מתחבר → מאשר הרשאת-התראות → האפליקציה שולפת את הטוקן לבד ושולחת. **הלקוח לא רואה טוקן.** (MacroDroid היה רק לבדיקה מהירה, לא למוצר.)
- חוויית-לקוח סופית מתועדת ב-`[[project_auto_expense_ingestion]]`: אנדרואיד = אישור הרשאה בלבד; iOS = הוספת Shortcut מוכן.

### ✅ שלב ד׳ — ניקוי-אבטחה — הושלם (2026-06-20)
שני הסודות שעברו בצ'אט סובבו: (1) `TRANSACTION_SECRET` הוחלף ב-Vercel (אומת — הטוקן הישן נדחה `unauthorized`); (2) מפתח-השירות סובב — נוצר מפתח חדש (`a89c25198b…`), הוחלף ב-Vercel + בקובץ המקומי, **המפתח הדולף `8558d73d…` נמחק לתמיד** ב-GCP. אומת לפני המחיקה שהאפליקציה הישנה (orimipuy.com) **לא משתמשת בכלל ב-service account** (client-SDK), אז המחיקה לא נגעה בה. `/api/transaction` נשאר 401 אחרי המחיקה (firebase-admin עובד עם המפתח החדש). מפתח שלישי `554ef618…` (May 26) **נשאר** — לא דלף, מקורו לא ידוע, לא נגענו.

---

## הצינור המלא — 3 חוליות

```
①  משלם ב-Google Pay / Apple Pay
        ↓  טריגר אוטומטי ("השומר")
②  נשלף: שם בית-עסק + סכום
        ↓
③  זיהוי קטגוריה + רישום בטאב תיעוד הוצאות
```

---

## ✅ מה כבר נבנה (חי בפריסה, advisor-only)

| מה | קובץ | תיאור |
|----|------|-------|
| POC ידני | `src/app/app/transaction-test/page.tsx` | טופס בדיקה: שם+סכום → `categorize()` → `expenseLogStore.add()`. בתפריט מעבדה (advisorOnly). |
| מקלט deep-link | `src/app/app/ingest/page.tsx` | `/app/ingest?merchant=&amount=&date=&ref=` → ה-PWA המחובר מקטלג ורושם. מחכה ל-`hydrated`, ו-dedup לפי `ref`. |

שניהם **client-side בלבד**, משתמשים ב-`categorize()` (lib/categorize.ts) + `expenseLogStore` הקיימים.
**חוליה ③ (קטלוג+רישום) ו-② (פרמטרים) — עובדות.** חסר רק ① (הטריגר השקט) + מסלול שרת נקי לשתי הפלטפורמות.

**מגבלת ה-deep-link:** פותח את הדפדפן/אפליקציה לרגע בכל עסקה — לא שקט. בשביל "שניהם + שקט" עוברים למסלול השרת למטה.

---

## 🏗️ מה נשאר לבנות — המסלול השקט (HTTP ברקע, לשתי הפלטפורמות)

```
משלם → Shortcut(iOS) / MacroDroid|native(Android) שולח POST שקט
     → /api/transaction → מקטלג → "תיבת-דואר" פרטית ב-Firestore
     → האפליקציה מנקזת משם → טאב תיעוד הוצאות
```

### 5 החלקים (לפי הסיכום שאושר)

| # | חלק | מי | סיכון | סטטוס |
|---|-----|-----|-------|--------|
| 1 | **`/api/transaction`** (POST) — מאמת טוקן-מכשיר, מקטלג (`categorize` בצד-שרת), כותב לתיבה דרך firebase-admin | 🤖 | אפס (route חדש) | ✅ נבנה+פרוס (gated 503) |
| 2 | **firebase-admin + service-account** כ-env ב-Vercel | 👤 (אדריך) | נמוך (שרת בלבד) | ⬜ **נשאר — אתה** |
| 3 | **כלל-Firestore לתיבה** — אוסף חדש, תוספת בלבד | 🤖 כותב / 👤 מפרסם | נמוך | 🟡 נכתב ב-`firestore.rules` — **ממתין לפרסום שלך** |
| 4 | **ניקוז בצד-לקוח** — onSnapshot על התיבה → `expenseLogStore.add()` → מחיקת הפריט | 🤖 | אפס | ✅ נבנה (`hooks/useTransactionInbox.ts`, מחובר ל-DataSync) |
| 5 | **טוקן-מכשיר** — `/api/device-token` (מאומת Firebase ID) מחזיר טוקן חתום; UI בדף המעבדה להציג/להעתיק | 🤖 | אפס | ✅ נבנה (כרטיס 🔑 בדף המעבדה) |

### פרטי מימוש (לזכור כשממשיכים)

**טוקן-מכשיר (חלק 5):** חתום HMAC — `<uid>.<hmac(uid, TRANSACTION_SECRET)>`. בלי אחסון ב-Firestore.
- `GET /api/device-token` מאומת ב-Firebase ID token (כמו ה-AI routes, `verifyFirebaseToken`) → מחזיר את הטוקן.
- המשתמש מעתיק אותו פעם אחת ל-Shortcut / MacroDroid.
- `TRANSACTION_SECRET` = env חדש ב-Vercel.

**`/api/transaction` (חלק 1):** מקבל `{ token, merchant, amount, date?, ref? }`.
- מאמת HMAC של הטוקן → מחלץ `uid`.
- `categorize(merchant)` בצד-שרת (פונקציה טהורה, רצה בשרת).
- כותב ל-`transactionInbox/{uid}/items/{autoId}` = `{ merchant, amount, date, category, ref, createdAt }` דרך **firebase-admin**.
- **גרייסבול:** אם אין service-account env → מחזיר 503 (כך בטוח לפרוס לפני שמגדירים).

**כלל Firestore (חלק 3) — תוספתי, לא נוגע בקיים:**
```
match /transactionInbox/{uid}/items/{item} {
  allow read, delete: if request.auth != null && request.auth.uid == uid;
  allow create, update: if false;   // רק השרת (admin) כותב, עוקף כללים
}
```
האפליקציה הישנה לא נוגעת ב-`transactionInbox` → אפס השפעה עליה.

**ניקוז (חלק 4):** hook ב-DataSync — `onSnapshot` על `transactionInbox/{uid}/items` (אוסף קטן, עלות זניחה):
- לכל פריט: `expenseLogStore.add({date, amount, category, note: merchant + ' #'+ref})` ואז `deleteDoc` של הפריט.
- **גרייסבול:** `try/catch` סביב הקריאה — אם הכלל עדיין לא פורסם, no-op שקט (לא שובר כלום).
- dedup: ה-`ref` כבר מטופל; אפשר גם לבדוק מול `note` קיים.

---

## ① הטריגר ("השומר") — לכל פלטפורמה (חוליה אחרונה, אחרי השרת)

- **iOS:** אוטומציית **Wallet/Transaction** ב-Shortcuts (iOS 17+) → פעולת "Get Contents of URL" POST ל-`/api/transaction` עם הטוקן + Merchant + Amount. **שקט.** (צריך אייפון של לקוח לבדיקה — למשתמש אין.)
- **אנדרואיד (מיידי):** **MacroDroid/Tasker** — טריגר "התראה התקבלה" מ-Google Pay/הבנק → חילוץ regex של שם+סכום → HTTP POST שקט ל-`/api/transaction`.
- **אנדרואיד (מוצר):** אפליקציית **native (Capacitor + NotificationListenerService)** → אותו POST. לחנות Google Play.

---

## מה המשתמש (Ori) יצטרך לעשות בקונסולה (כשנגיע לחלקים 2-3)
1. **Vercel → Settings → Environment Variables:** להוסיף `FIREBASE_SERVICE_ACCOUNT` (תוכן `service-account-key.json`) + `TRANSACTION_SECRET` (מחרוזת אקראית). *(האסיסטנט מדריך, לא רואה את הערכים.)*
2. **Firestore Console → Rules:** להדביק את תוספת-הכלל של `transactionInbox` (כמו פעם קודמת). גיבוי הכללים הנוכחי: `firestore.rules.backup-2026-06-13`.

## סדר בנייה מומלץ כשממשיכים
1. חלקים בטוחים קודם (גרייסבול, לא דורשים כלום מהמשתמש): **5 → 1 → 4**. לפרוס. שום דבר לא משתנה עד הפעלה.
2. הפעלה: המשתמש מוסיף env (2) + מפרסם כלל (3).
3. בדיקה מקצה-לקצה עם `curl`/Postman (מדמה Shortcut) → רואים שהעסקה נכנסת לטאב הוצאות.
4. רק אז — בניית הטריגרים האמיתיים (①): Shortcut ל-iOS, MacroDroid/native לאנדרואיד.

## אינווריאנטים / זהירות
- הכל **תוספתי ומבודד** — route חדש, אוסף חדש, קוד-לקוח חדש. אפס שינוי בטאבים/חנויות/כללים קיימים.
- ה-backend משותף עם orimipuy.com — לכן רק **תוספות** (אוסף `transactionInbox` שהישנה לא נוגעת בו). ראה `[[project_shared_firebase_backend]]`.
- service-account = שרת בלבד, לעולם לא `NEXT_PUBLIC_`, לעולם לא נחשף ללקוח.
- `xlsx@0.18.5` לא קשור; אין שינוי תלויות פרט ל-`firebase-admin` (server-only).

_נכתב: 2026-06-13. ממשיכים מכאן._
