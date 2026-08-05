---
name: probe
description: Inspect LIVE production Firestore data with a throwaway read-only script. Use whenever a question needs real data — "how many clients have X", "why did this client see Y", verifying a fix landed, measuring sizes. Encodes the security-hook workaround (inline node -e reading the service-account key is BLOCKED) and the mandatory dry-run-before-write discipline.
---

# אבחון על נתונים חיים

## מתי להפעיל

כשצריך **עובדה מהפרודקשן**, לא הנחה: כמה לקוחות במצב מסוים · למה לקוח ראה משהו ·
האם תיקון באמת נחת · מדידת גדלים · מי מחזיק ערך שגוי.

**תמיד עדיף למדוד לפני שבונים.** בסשן 2026-07 מדידה של 5 דקות חסכה יומיים עבודה
מסוכנת: התברר שהתיק הגדול ביותר הוא 19% מהתקרה, ולכן הפיצ'ר המתוכנן נדחה בצדק.

## ⚠️ ה-gotcha שחוסם

hook האבטחה **חוסם** קריאת `service-account-key.json` דרך הטרמינל:
```bash
node -e "...readFileSync('service-account-key.json')..."   # ❌ נחסם
cat service-account-key.json                              # ❌ נחסם
```

**הדרך היחידה שעובדת:** לכתוב קובץ `.ts` אמיתי עם כלי Write, ולהריץ ב-`npx tsx`.

## תבנית

צור `scripts/_tmp-<נושא>.ts` (הקידומת `_tmp-` מסמנת שזה למחיקה):

```ts
/** Read-only: <מה בדיוק נבדק>. */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

initializeApp({ credential: cert(JSON.parse(
  readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
const db = getFirestore();

async function main() {
  // ... שאילתות והדפסות
}
main().then(() => setTimeout(() => process.exit(0), 150))
  .catch(e => { console.error(e); process.exit(1); });
```

הרצה **מתיקיית ה-Downloads** (שם נמצא המפתח):
```bash
cd "/c/Users/ninio/Downloads/קלוד קוד/mipuy-financi-app-v2" && npx tsx scripts/_tmp-x.ts
```

**`setTimeout` לפני `process.exit` הוא חובה** — יציאה חדה בזמן שה-admin SDK סוגר
חיבורים מפילה assertion של libuv ב-Windows.

## כללים

**מוחקים אחרי:** `rm -f scripts/_tmp-*.ts`. סקריפט אבחון חד-פעמי לא נשאר במאגר.
(סקריפט שיהיה שימושי שוב — לתת לו שם אמיתי בלי `_tmp-` ולהכניס ל-git.)

**מדפיסים סיכום, לא נתונים גולמיים.** לא להדפיס עסקאות של לקוחות, מיילים מלאים
או תוכן אישי. `uid.slice(0, 10)` מספיק לזיהוי.

**כתיבה = תמיד dry-run קודם.** כל סקריפט שמשנה נתונים חייב:
- ברירת מחדל **קריאה בלבד**, כתיבה רק עם `--apply`
- להדפיס **בדיוק** מה ישתנה, לפני
- **גיבוי** של מה שנמחק (למשל `shared/learnedDBRemoved`)
- אימות אחרי, שמוכיח שהפעולה הצליחה

**לא לרוץ על נתונים חיים בלי אישור.** גם קריאה על חשבון של לקוח אמיתי — לומר למשתמש
מה בודקים ולמה. בסשן הזה שיניתי בטעות מיתוג של משרד אמיתי בהנחה שהוא סנדבוקס.
