---
name: safe-commit
description: Scan for secrets before committing. MUST run before any commit that ADDS files to git (new scripts, functions, config) — a real live account password was caught this way. Also use before pushing a branch that has never been pushed. Encodes the scan patterns and what belongs in .gitignore for this repo.
---

# סריקת סודות לפני commit

## מתי להפעיל — חובה

| מצב | להפעיל? |
|---|---|
| commit שמוסיף **קבצים חדשים** ל-git | ✅ **חובה** |
| דחיפה ראשונה של ענף / קבצים שלא היו במאגר | ✅ **חובה** |
| commit ל-`scripts/`, `functions/`, או קובץ config | ✅ **חובה** |
| עריכת קובץ שכבר במאגר, בלוגיקה בלבד | ⚠️ מומלץ, לא חובה |
| קבצי תיעוד / memory | ❌ מיותר |

**למה חובה:** בגיבוי קוד הפונקציות (2026-07-30) הסריקה תפסה **סיסמה של חשבון חי**
בתוך `scripts/setup-young-investor.ts`. בלעדיה היא הייתה נכנסת להיסטוריית המאגר
**לצמיתות** — מחיקה מ-git history היא כאב ראש אמיתי, ואחרי push לענן היא כבר חשופה.

## הסריקה

**1. מה בכלל נכנס** — לבדוק לפני שסורקים:
```bash
git status --short && git diff --cached --name-only
```

**2. מפתחות ו-tokens** (בתוכן ה-staged בלבד):
```bash
git diff --cached | grep -E "^\+" | grep -inE \
  "sk-ant-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|re_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{40,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}"
```

**3. סיסמאות והשמות מפורשות** — דרך כלי Grep (ה-hook חוסם `grep` עם המילה password
בטרמינל):
```
pattern: (passw|secret|token|apiKey|api_key|credential)\s*[:=]\s*["'][^"']{8,}["']
```
לסנן ידנית: `process.env`, `defineSecret`, `.value()`, הערות, ו-console.log שמדפיס
`"present"/"missing"` ולא ערך.

**4. סיסמאות שכבר ידועות בפרויקט** — חיפוש נקודתי: `2026!`, `createUser`, `updateUser`.

## מה עושים עם ממצא

**לא למחוק את הכלי — להוציא ממנו את הסוד.** להעביר למשתנה סביבה, ולהוסיף שגיאה
ברורה כשהוא חסר:
```ts
const TEMP_PASSWORD = process.env.SETUP_TEMP_PASSWORD || "";
// ...
if (!TEMP_PASSWORD) {
  console.error("❌ אין סיסמה. הרץ עם: SETUP_TEMP_PASSWORD='...' npx tsx <script>");
  process.exit(1);
}
```

## מה לא נכנס למאגר בפרויקט הזה

כבר ב-`.gitignore`, לוודא שנשאר: `.env*` · `service-account-key.json` · `*.pem` ·
`clients.md/html` · `docs/marketing/` · `hatzaa-*` / `hoskem-*` (מסמכים עסקיים) ·
`play-store-assets/` · `.playwright-mcp/`

**סקריפטי `_tmp-*`** — לא לעשות להם commit; הם למחיקה (ראה skill `probe`).

## אזהרות שכבר קיימות במאגר

`scripts/setup-impersonation-test.ts` מכיל סיסמת חשבון בדיקה שכבר בהיסטוריה מלפני
הסריקה. חשבון בדיקה בלבד, לא דחוף — אבל לא להוסיף עוד כאלה.
