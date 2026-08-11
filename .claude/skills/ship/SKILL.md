---
name: ship
description: Safe production deploy for this repo. Use whenever deploying web code to main/Vercel, deploying Firebase Cloud Functions, or deploying firestore.rules. Encodes the required order, the deploy guard, and how to verify the deploy actually landed. Triggers on "פרוס", "deploy", "תעלה לפרודקשן", "push to main".
---

# פריסה בטוחה

## עץ אחד: main. (היסטוריה: פעם היו שניים — זה נגמר)

מאז חילוץ הפונקציות (`1ad89e2`, 03/08/2026) **main מכיל את הכול**: קוד האתר וכל
מודולי הפונקציות. העץ היחיד לעבודה ולפריסה:
`c:\Users\ninio\Downloads\קלוד קוד\mipuy-financi-app-v2` (על main).

🛡️ **מגן מכני:** `firebase.json` מריץ predeploy את `scripts/check-functions-tree.js` —
פריסת functions מעץ שחסרים בו מודולים **נכשלת** במקום למחוק פונקציות חיות.
אל תעקוף אותו לעולם.

## סדר הפעולות — קוד אתר

1. `npx tsc --noEmit` — חייב נקי
2. `npx vitest run` — **הכול ירוק.** אין יותר "כשל מותר".
3. `npm run build` — עם משתני dummy של Firebase:
   ```bash
   NEXT_PUBLIC_FIREBASE_API_KEY=dummy-key-for-build \
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=dummy.firebaseapp.com \
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=dummy \
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=dummy.appspot.com \
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000 \
   NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0 \
   npm run build
   ```
   (בלעדיהם הבנייה נופלת על `auth/invalid-api-key` ב-prerender — לא באג בקוד)
4. **גריל** (ראה skill `grill`) — לפי המבחן שם: *אם זה יישבר, כמה אנשים ידעו וכמה
   זמן עד שנשים לב?* הרבה ובשקט = גריל (מסלולי כשל, החלטה שחלה על כולם, נתון שעובר
   בין אנשים, קוד שמעולם לא רץ). טקסט/עיצוב/עמודה מנתון קיים — לא נדרש.
   ⚡ **להריץ ברקע במקביל לשלבים 1-3**, לא אחריהם (אורי, 11/08/2026: "לוקח המוןןן זמן")
5. `git add` **קבצים ספציפיים**, לא `-A` + סריקת סודות (skill `safe-commit`)
6. commit + `git push origin HEAD:main`

## סדר הפעולות — Cloud Functions

1. `node --check functions/<file>.js` **וגם** `node --check functions/index.js`
2. **גריל** — חובה
3. `firebase deploy --only functions:<שם מדויק>` — **תמיד `--only`**, לעולם לא פריסה מלאה
4. לוודא `Deploy complete!` בפלט
5. לפונקציה מתוזמנת: `firebase functions:list | grep <name>` — לוודא שהיא עדיין `scheduled`

## סדר הפעולות — firestore.rules

שינוי rules פוגע גם **באפליקציה הישנה החיה** (orimipuy.com — אותו Firestore).
1. גריל חובה + אישור מפורש מאורי לפני
2. אם השינוי סוגר מסלול כתיבה של הדפדפן — **קוד האתר שמחליף אותו נפרס קודם**
   (אחרת יש חלון שבו הפיצ'ר שבור)
3. `firebase deploy --only firestore:rules`
4. אימות חי אחרי: probe עם סשן משתמש אמיתי (custom token מוחלף ב-ID token דרך
   identitytoolkit; ⚠️ מפתח ה-Web מוגבל דומיין — חובה header
   `Referer: https://orimipuy.com/`) — לוודא שהמותר עובר **ושהאסור נדחה**.
   דוגמה עובדת: הסבב של 05/08 בדק 5 מצבים (read 200 / write 403 / foreign 403 /
   API 200 / anon 401).

## אימות אחרי פריסת אתר — אל תדלג

**פריסה שנדחפה ≠ פריסה שנחתה.**

```bash
npx vercel ls mipuy-financi-app-2-3nay --scope oris-projects-29e04a54 2>&1 | grep -m1 Production
```
⚠️ **ה-CLI מדפיס את הטבלה ל-STDERR** — עם `2>/dev/null` תקבל פלט ריק ותסיק
בטעות שאין פריסה (קרה 04/08). תמיד `2>&1`. לחכות ל-**`● Ready`**, ולוודא שזו
הפריסה **החדשה** — לעקוב מ-`Building`, או `vercel inspect <url>` ולהשוות את
זמן היצירה לזמן הדחיפה.

ואז אימות חי:
```bash
curl -sL -o /dev/null -w "%{http_code}\n" https://app.orimipuy.com          # 200
curl -sI https://app.orimipuy.com/go/tachles | head -1                      # 302
curl -s "https://app.orimipuy.com/api/brand?practiceId=p_XIjWNpyESsM84hUO4OsSjzy6W942" | head -c 60
```

## פרויקטי Vercel — לא להתבלבל

- ✅ `mipuy-financi-app-2-3nay` — **הפעיל**
- ❌ `mipuy-financi-app-2` — נטוש, נכשל בכל deploy, צובע X אדום על PR. **להתעלם**

## חזרה לאחור

אתר: `git revert <sha>` + push → פריסה אוטומטית.
Functions: לפרוס מחדש מ-commit קודם (המגן יוודא שהעץ שלם).
Rules: `git revert` על firestore.rules + `firebase deploy --only firestore:rules`.
