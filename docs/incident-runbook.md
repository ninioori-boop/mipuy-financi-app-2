# 🚨 Runbook — תגובת אירוע (אבטחה / עלות)

מדריך פעולה מהיר למקרה חירום. כל תרחיש: **איך מזהים → איך עוצרים מיד → איך משחזרים.**
פרויקט Firebase: `finance-machine-a36e9`.

> עיקרון: קודם **לעצור את הדימום** (לחסום את הווקטור), אחר כך לחקור. כל פעולת "עצירה" כאן הפיכה.

---

## 1. 💸 חשד להתעללות בעלות AI (מישהו מציף את `/api/categorize` או `/api/analyze`)

**זיהוי:**
- חשבונית/שימוש קופצים ב-[Anthropic Console → Usage](https://console.anthropic.com/).
- בלוגים של Vercel: שורות `[categorize] uid=… msgLen=…` / `[analyze] uid=…` חוזרות בתדירות גבוהה מאותו uid.

**עצירה מיידית (לפי סדר עוצמה):**
1. **תקרת Anthropic** — אם הוגדרה (1.10), היא כבר עוצרת ב-cap. אם לא — הגדר עכשיו.
2. **נטרל את המשתמש** — [Firebase Auth → Users](https://console.firebase.google.com/project/finance-machine-a36e9/authentication/users) → מצא את ה-uid → **Disable account**. מרגע זה הטוקן שלו נדחה ב-`verifyFirebaseToken` וה-routes יחזירו 401.
3. **kill-switch גלובלי ל-AI** — ב-Vercel הגדר `AI_KILL_SWITCH=true` (או הנמך את `AI_DAILY_LIMIT`) → redeploy. **כל** ה-AI routes יחזירו 503 מיד, בלי לגעת במפתח. הפיך תוך שנייה (מחק את המשתנה כדי להחזיר). זה הצעד הגלובלי המהיר והכי פחות הרסני.
4. **כיבוי מוחלט של ה-AI** — ב-Vercel הסר/שנה את `ANTHROPIC_API_KEY` (ה-routes יחזירו 500 "לא מוגדר"). הצעד ההרסני ביותר — רק אם ה-kill-switch לא זמin.

> הערה: התקרה per-user כעת מגובת-Firestore (`rateLimits`, `src/lib/rateLimit.ts`) ועמידה בין instances של Vercel — אז משתמש בודד כבר חסום אוטומטית בתקרה שלו. ה-kill-switch הוא החסם הגלובלי מעל זה.

**שחזור:** החזר את המפתח / כבה את `AI_KILL_SWITCH` / הפעל מחדש את המשתמש אחרי שהאיום חלף.

---

## 2. 📊 חשד להתעללות / קפיצת עלות ב-Firestore

**זיהוי:** [GCP Billing](https://console.cloud.google.com/billing) או [Firebase Usage](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/usage) — קפיצה חריגה ב-reads/writes (הבסיס הרגיל: ~25 reads / ~39 writes ביממה).

**עצירה מיידית:**
1. **נטרל את המשתמש** (כמו 1.2 לעיל) — נתוני כל משתמש מבודדים ל-`users/{uid}`, אז ניטרול חוסם את הווקטור שלו לחלוטין.
2. **הקפאת כתיבות חירום** — אם צריך לעצור הכל בזמן חקירה, פרוס כללי "read-only" זמניים (ראה §6).
3. App Check enforcement — **לא** פתרון מהיר כאן: זה ישבור גם את `orimipuy.com`. ראה §7.

**שחזור:** אין גיבוי אוטומטי של Firestore. שקול ייצוא ידני תקופתי (`gcloud firestore export`) כרשת ביטחון — ראה §8.

---

## 3. 🔑 דליפת `service-account-key.json` (תכשיט הכתר — עוקף את כל הכללים)

**זה החמור ביותר.** מי שמחזיק בו שולט בכל נתוני כל הלקוחות.

**זיהוי:** הקובץ הופיע ב-git, נשלח, או נראה במקום לא צפוי.

**עצירה מיידית:**
1. [Firebase Console → Project Settings → Service accounts](https://console.firebase.google.com/project/finance-machine-a36e9/settings/serviceaccounts/adminsdk) → או [GCP IAM → Service Accounts → Keys](https://console.cloud.google.com/iam-admin/serviceaccounts) → **מחק/בטל את המפתח שדלף** (revoke). מרגע זה הוא חסר תוקף.
2. צור מפתח חדש רק אם צריך (לסקריפט הייצוא), ושמור אותו מחוץ לריפו (gitignored — כבר מוגדר).
3. אם דלף ל-git — לא מספיק למחוק קובץ; המפתח כבר חשוף בהיסטוריה. חובה **revoke** (שלב 1).

**מניעה:** ה-hook `security-guard.js` חוסם קריאת הקובץ דרך הטרמינל; `.gitignore` חוסם commit.

---

## 4. 🔐 דליפת `ANTHROPIC_API_KEY`

**עצירה:** [Anthropic Console → API Keys](https://console.anthropic.com/settings/keys) → **Revoke** את המפתח → צור חדש → עדכן ב-Vercel env (`ANTHROPIC_API_KEY`, ללא `NEXT_PUBLIC_`) → redeploy.

---

## 5. 🧪 הרעלת `shared/learnedDB` (הסיווג מתקלקל לכל הלקוחות)

**זיהוי:** סיווג אוטומטי מחזיר קטגוריות שגויות באופן עקבי לכל המשתמשים.

**עצירה/שחזור:**
1. [פתח את המסמך](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/data/~2Fshared~2FlearnedDB) — בדוק ערכים חשודים.
2. הכללים כבר חוסמים מחיקת-מפתחות ו-wipe, אבל **לא** שינוי ערכים. תקן ערכים שהורעלו ידנית בקונסולה.
3. אם נרחב — נטרל את המשתמש שהרעיל (חפש בלוגים מי כתב), ושקול לאכוף `email_verified` על הכתיבה ל-learnedDB.

---

## 6. 🧊 הקפאת חירום — כללי "read-only" זמניים

כשצריך לעצור את כל הכתיבות בזמן חקירה, בלי לשבור קריאה:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read:  if request.auth != null && request.auth.uid == userId;
      allow write: if false;   // הקפאה זמנית
    }
    match /shared/learnedDB { allow read: if request.auth != null; allow write: if false; }
    match /{document=**} { allow read, write: if false; }
  }
}
```
פרוס דרך הקונסולה (Rules → Publish) או `firebase deploy --only firestore:rules`. **להחזיר** את `firestore.rules` המקורי אחרי החקירה.

---

## 7. ⚠️ App Check enforcement — אזהרה

אכיפת App Check היא הגדרה **גלובלית לפרויקט** וחלה גם על `orimipuy.com` (האפליקציה הישנה, שאין בה App Check). **הפעלת Enforce תשבור את כל הלקוחות שם.** אל תפעיל אכיפה עד שגם האפליקציה הישנה תצויד ב-App Check, או תיסגר. רישום + ניטור — בטוחים; Enforce — לא, עד אז.

---

## 8. 🛟 גיבוי (מומלץ — לא קיים כרגע)
אין גיבוי אוטומטי. לרשת ביטחון, שקול ייצוא תקופתי:
- `gcloud firestore export gs://<bucket>` (דורש bucket ב-GCS), או
- סקריפט `npm run export:clients` כבר מושך snapshot של כל המשתמשים ל-`clients.md`/`.html` (לא גיבוי מלא, אבל תיעוד מצב).

---

## 9. 📱 דליפת / גניבת device token (קליטת עסקאות אוטומטית)

**רקע:** ה-device token הוא credential אישי לכל משתמש, שמודבק פעם אחת בטלפון (iOS Shortcut /
אוטומציית Android) ומאפשר POST של עסקאות + מינוף ל-session. הוא מאומת ב-HMAC ועמיד לזיוף,
אבל אם **הטלפון עצמו נגנב** — הטוקן שעליו תקף.

**עצירה (ביטול ממוקד, בלי לפגוע באף לקוח אחר):**
1. מצא את ה-uid של המשתמש ב-[Firebase Auth → Users](https://console.firebase.google.com/project/finance-machine-a36e9/authentication/users).
2. הרץ `npx tsx scripts/revoke-device.ts <uid>` — מעלה את `deviceTokens/{uid}.minVersion` ב-1.
   כל טוקן ישן של אותו משתמש נדחה מיד (`isDeviceTokenRevoked`), והנתיבים מחזירים 401.
3. המשתמש מקבל טוקן חדש פשוט ע"י פתיחת האפליקציה (`/api/device-token` חותם בגרסה החדשה).

**אל תסובב את `TRANSACTION_SECRET`** לצורך זה — סיבוב הסוד מבטל את הטוקנים של **כל** הלקוחות
בבת אחת. שמור אותו רק לתרחיש שהסוד עצמו דלף. הביטול הממוקד (revoke-device) פוגע רק בטלפון אחד.

**הגנת קצב:** הנתיבים `/api/transaction`, `/api/learn`, `/api/app-session` מוגבלים per-uid
(`rateLimit.ts`), אז טוקן גנוב לא יכול גם להציף — חפש בלוגים `RATE_LIMITED uid=…` לזיהוי.

---

## 🧹 תחזוקה: TTL על `rateLimits`
מסמכי המונים נכתבים עם שדה `expireAt`. כדי שייווצקו אוטומטית, הפעל **TTL policy** ב-
[Firestore → TTL](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/ttl)
על הקולקציה `rateLimits`, שדה `expireAt`. (עד שמופעל — לא נורא: כל חלון משתמש ב-doc id חדש,
והישנים פשוט נצברים. ה-TTL רק מנקה.) ה-policy מוגבל ל-`rateLimits` בלבד ולא נוגע בשום קולקציה אחרת.

---

## 📇 קישורים מהירים
- [Firebase Console](https://console.firebase.google.com/project/finance-machine-a36e9)
- [Auth → Users](https://console.firebase.google.com/project/finance-machine-a36e9/authentication/users) (נטרול משתמש)
- [Firestore Rules](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/rules)
- [Firestore Usage](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/usage)
- [GCP Billing](https://console.cloud.google.com/billing)
- [Anthropic Console](https://console.anthropic.com/)
- Vercel → Project → Settings → Environment Variables (מפתחות) + Logs (זיהוי uid מנצל)

_נכתב: 2026-06-07._
