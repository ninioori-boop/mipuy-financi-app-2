---
name: ship
description: Safe production deploy for this repo. Use whenever deploying web code to main/Vercel or deploying Firebase Cloud Functions. Encodes the two-tree rule (deploying functions from the wrong tree DELETES production functions), the required order, and how to verify the deploy actually landed. Triggers on "פרוס", "deploy", "תעלה לפרודקשן", "push to main".
---

# פריסה בטוחה

## ⚠️ שני עצי קוד — המוקש המסוכן ביותר בפרויקט

| מה פורסים | מאיזה עץ | למה |
|---|---|---|
| **קוד אתר** (`src/`) → Vercel | worktree של `main` בתיקיית ה-scratchpad של הסשן | זה מה ש-Vercel בונה |
| **Cloud Functions** | `c:\Users\ninio\Downloads\קלוד קוד\mipuy-financi-app-v2` | **רק כאן** קיימים `clientBot.js`, `goalBot.js`, `creditSplitCheck.js`, `waSignature.js`, `clientSelectors.js`, `brand.js` |

🚨 **פריסת functions מעץ ה-main תמחק פונקציות חיות מהפרודקשן.**
העץ ההוא לא מכיל אותן, ו-Firebase מוחק כל מה שלא נמצא ב-source.

**לפני כל `firebase deploy` — ודא את הנתיב:**
```bash
pwd    # חייב להיות .../Downloads/קלוד קוד/mipuy-financi-app-v2
```

## סדר הפעולות — קוד אתר

1. `npx tsc --noEmit` — חייב נקי
2. `npx vitest run` — **הכשל היחיד המותר** הוא `functions/test/rules.test.mjs`
   (חסר dev-dep בעץ העבודה, קיים מלפני הסשן, לא קשור)
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
4. **גריל** (ראה skill `grill`) — חובה
5. `git add` **קבצים ספציפיים**, לא `-A` (ה-classifier חוסם add גורף)
6. commit + `git push origin HEAD:main`

## סדר הפעולות — Cloud Functions

1. `node --check functions/<file>.js` **וגם** `node --check functions/index.js`
2. **גריל** — חובה
3. `firebase deploy --only functions:<שם מדויק>` — **תמיד `--only`**, לעולם לא פריסה מלאה
4. לוודא `Deploy complete!` בפלט
5. לפונקציה מתוזמנת: `firebase functions:list | grep <name>` — לוודא שהיא עדיין `scheduled`

## אימות אחרי פריסת אתר — אל תדלג

**פריסה שנדחפה ≠ פריסה שנחתה.** בסשן הזה אורי בדק פעמיים בזמן שהבנייה עוד רצה
והסיק שהתיקון לא עבד.

```bash
npx vercel ls mipuy-financi-app-2-3nay --scope oris-projects-29e04a54 | grep -m1 Production
```
לחכות ל-**`● Ready`**. `Building` או `Queued` = עוד לא.

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
Functions: לפרוס מחדש מ-commit קודם. **לוודא שהעץ עדיין מכיל את כל המודולים.**
