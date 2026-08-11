# CLAUDE.md — The Home Economist (mipuy-financi-app-v2)

> ⚠️ **זו מערכת חיה בפרודקשן.** יועצים ולקוחות אמיתיים מנהלים בה כסף אמיתי היום.
> שלב הבנייה הסתיים מזמן. אין "לוח 17 יום", אין "יום 2 הבא בתור".
> כל שינוי כאן נוגע בנתונים של אנשים. התנהג בהתאם.

---

## 0. לפני שאתה נוגע במשהו

| רוצה לדעת | תריץ / תקרא |
|-----------|-------------|
| מה מצב המערכת עכשיו (7 בדיקות, קריאה בלבד) | `npm run health` |
| כמה משתמשים, מי פעיל, מה המשפך | `npm run report:funnel` |
| מה עושה כל טאב | [TABS.md](TABS.md) |
| נפלה תקלה בפרודקשן | [docs/incident-runbook.md](docs/incident-runbook.md) |
| כמה AI נשרף ועל ידי מי | `npx tsx scripts/ai-usage-report.ts` |

**אל תכתוב לקובץ הזה מספרי משתמשים ושימוש** (כמה לקוחות, כמה פעילים, כמה ממתין
בתור). זה בדיוק מה שהרקיב את הגרסה הקודמת שלו. תפנה לפקודה שמייצרת את האמת,
אל תעתיק לכאן את האמת של היום. מספרים על **הקוד** (שורות, טסטים) מותרים, כי
הם נובעים מהריפו עצמו וזזים לאט.

**סקילים שחייבים לרוץ:**
- `/ship` לפני כל דיפלוי (main, Cloud Functions, firestore.rules)
- `/grill` לפני שינוי **רגיש** בלבד: rules, functions, dataSync, כתיבה לפרודקשן, לוגיקה פיננסית. שינוי תוכן/UI רגיל עובר עם טסטים ובילד.
- `/safe-commit` לפני קומיט שמוסיף קבצים חדשים לגיט
- `/probe` כשצריך נתון אמיתי מ-Firestore

---

## 1. כלי MCP, מה מותר

**השתמש רק בכלים הבאים. אל תטען או תפעיל שום MCP אחר.**

| כלי | מתי |
|-----|-----|
| **context7** | תיעוד ספרייה (Next.js, Firebase, Zustand, shadcn) |
| **playwright** | פתיחת דפדפן ובדיקת UI |
| **Google Drive** | אורי אישר במפורש (25/06/2026): מותר ליצור ולהעלות קבצים לדרייב שלו |

**אסור:** Gmail, Google Calendar, Canva, Microsoft 365, Vercel MCP, GitHub MCP.
לכל פעולת git/npm/vercel השתמש ב-Bash ישירות.

---

## 2. מה המערכת בפועל

**The Home Economist** הוא כלי עבודה של מאמן פיננסי מול לקוחותיו, וגם כלי ניהול
אישי ללקוח עצמו. הוא מורכב מארבעה חלקים שרצים במקביל:

1. **אפליקציית הווב** (הריפו הזה): Next.js על Vercel, חיה ב-**`app.orimipuy.com`**. זה הלב.
2. **אפליקציית אנדרואיד נייטיב** (ריפו נפרד): עוטפת את הווב ב-WebView, ומוסיפה
   לכידה אוטומטית של חיובי Google Pay. iOS נעשה דרך Shortcuts, ראה `/iphone-capture`.
3. **Cloud Functions** (`functions/`): הזמנות, מחיקת חשבון, דוחות שבועיים ליועץ,
   ושני בוטים בוואטסאפ (`clientBotWebhook`, `goalBotWebhook`).
4. **סקריפטים תפעוליים** (`scripts/`): גיבוי, דוחות, allowlist, מיתוג, בדיקות בריאות.

**גודל, כדי לכייל ציפיות:** בערך 44k שורות TypeScript, 20 סטורים, 37 מסכים,
14 API routes (ועוד שני route handlers: `/go/[slug]` לקישורים קצרים
ו-`/manifest.webmanifest`), 580 טסטים ב-45 קבצים.

**שלוש כתובות חיות, אל תבלבל ביניהן:**

| כתובת | מה זה |
|-------|-------|
| `app.orimipuy.com` | 🟢 **הפרודקשן של v2.** זה מה שלקוחות פותחים |
| `mipuy-financi-app-2-3nay.vercel.app` | אותו deployment בדיוק, alias של Vercel |
| `orimipuy.com` | 🟡 **האפליקציה הישנה** (`../mipuy-financi-app`, Vanilla JS), עדיין חיה |

הישנה והחדשה חולקות **אותו** Firestore. שינוי ב-`firestore.rules` פוגע גם בה.

---

## 3. סטאק

- **Next.js 16.2** (App Router, TypeScript) + **React 19.2**
- **Zustand 5** לניהול state
- **Tailwind v4** + **shadcn/ui**, אין `tailwind.config.ts`, הכל ב-`globals.css`
- **Firebase 12** (Auth + Firestore) + **firebase-admin 13** בצד השרת
- **xlsx@0.18.5** ל-Excel. 🔒 **אל תשדרג**, 0.20+ דורש רישיון מסחרי
- **Recharts 3** לגרפים, **@react-pdf/renderer** לייצוא PDF
- **Anthropic API**, המודל בשימוש כרגע: `claude-sonnet-4-6`, מקובע ב-7 מקומות
  (5 מסלולי ה-API, `src/lib/aiCategorize.ts`, ו-`functions/index.js`). שדרוג מודל
  חייב לגעת בכולם, אחרת חצי מהמערכת נשארת מאחור.
- **Vercel** לפריסה, **GitHub Actions** ל-CI

---

## 4. Firebase, המבנה האמיתי

**Project ID:** `finance-machine-a36e9`
ה-`authDomain` נקרא מ-`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` ב-`src/lib/firebase.ts`.
אל תקבע אותו בקוד, ואל תפתח את `.env.local` כדי לבדוק מה הערך.

| קולקשן | מה יש בו |
|--------|----------|
| `users/{uid}` | 🔴 **כל התיק הפיננסי של אדם, במסמך אחד** (השדה `data`) |
| `users/{uid}/sections/{id}` | חתכים לקריאה חלקית |
| `users/{uid}/versions/{id}` | היסטוריית גרסאות (נגזמת דרך `/api/trim-versions`) |
| `advisors/{uid}` · `practices/{id}` | יועצים ומשרדים (תפקידים, מיתוג, מכסת AI) |
| `clientLinks/{id}` | הקישור יועץ↔לקוח, כולל הסכמות ושלב הליווי |
| `shared/learnedDB` | מילון הסיווג המשותף. 🔴 כתיבה **רק** דרך `/api/learn` |
| `transactionInbox/{uid}/items/{id}` | חיובים שנלכדו מהטלפון, לפני ניקוז ליומן |
| `intake/{uid}` | טופס אינטייק (allowlist-gated) |
| `config/ai` | מתג החירום הגלובלי ל-AI |
| `aiUsage`, `rateLimits`, `deletionAudit`, `pushSubscriptions`, `platformOwners` | תפעול |

**שני קבצי rules, לא אחד:** `firestore.rules` (242 שורות) ו-`storage.rules`
(32 שורות, לקבצים שלקוח מעלה בטופס האינטייק). שינוי באחד לא מגן על השני.

**`maps/{uid}` הוא שריד של v1.** האפליקציה הזאת לא כותבת אליו. רק שלושה סקריפטי
דוחות קוראים ממנו כדי לספור לקוחות ותיקים. אל תבנה עליו כלום.

**env vars** ב-`.env.local`, לא לקומיט:
- `NEXT_PUBLIC_FIREBASE_*` לצד לקוח
- `ANTHROPIC_API_KEY` 🔴 **בלי** `NEXT_PUBLIC_`, שרת בלבד
- `AI_KILL_SWITCH`, `AI_DAILY_LIMIT`, `APP_CHECK_ENFORCE` (מתגי תפעול, ברירת מחדל כבויים)

---

## 5. אינווריאנטים קריטיים

כל אחד מהם נולד מתקרית אמיתית. הם לא סגנון, הם צלקות.

```
🔴 סטור חדש = חובה לסווג אותו ב-storeCoverage.test.ts
   (snapshot-reset / session-reset / exempt). סטור שלא סווג = הנתונים
   של אדם אחד מופיעים במסך של אדם אחר. זה כבר קרה, פעמיים.

🔴 שדה חדש ב-autoMapStore = חובה להוסיף אותו ל-resetSessionStores()
   ב-src/lib/dataSync.ts. יש טסט ברמת השדה שיתפוס אותך.
   ⚠️ ל-bankStore יש כיסוי רק ברמת הסטור. שם עוד אפשר לדלוף בשקט.

🔴 שדה חדש בסנפשוט = חובה למסלול מלא: Snapshot type + collectSnapshot
   + applySnapshot + resetAllStores. חסר אחד = אובדן נתונים שקט ברענון.
   (הסוכן store-sync-validator בודק בדיוק את זה.)

🔴 כל התיק במסמך אחד עם תקרה של 900KB (MAX_BYTES ב-DataSync.tsx).
   מסמך שחוצה אותה: השמירה נכשלת, עבודת היום אובדת, והלקוח לא יוכל
   לשמור יותר. כל שדה שאתה מוסיף לסנפשוט מקרב את הקיר.

🔴 שמירה חסומה עד hydrated=true. טעינה שנכשלה לא מסמנת hydrated,
   בכוונה. אל "תתקן" את זה: זה מה שמונע דריסת תיק מלא בברירות מחדל ריקות.

🔴 resetSessionStores() אסור להיקרא מ-applyRemote(). זה ימחק דוח בנק
   שהמשתמש באמצע העבודה עליו, בלי דרך לשחזר.

🔴 shared/learnedDB נכתב אך ורק דרך /api/learn, ו-learnedSharing.ts חוסם
   ממנו אמצעי תשלום ("ביט", "פייפאל", "העברה", "משיכה") וקטגוריות אישיות
   כמו "ביט ללא מעקב". בלי החסימה הזאת כל הלקוחות לומדים שהעברה בביט היא
   קטגוריה מסוימת. זה קרה, וניקוי ידני היה הפתרון.

🔴 ANTHROPIC_API_KEY בלי NEXT_PUBLIC_. שרת בלבד.
🔒 xlsx נעול על 0.18.5.
```

**RTL:** `dir="rtl"` ב-`<html>`. השתמש ב-`ps-`/`pe-`/`ms-`/`me-`, לא ב-`pl-`/`pr-`/`ml-`.

---

## 6. פלטת צבעים

נגזרת מהלוגו (שני חצים: זהב ואנתרציט).

⚠️ **מלכודת:** ב-`src/app/globals.css` יש **שתי** פלטות. אחת ב-`:root` (בהירה)
ואחת ב-`.dark` (כהה). ה-root layout מקבע `<html className="... dark">`, ולכן
**רק הבלוק של `.dark` משפיע בפועל**. עריכת `:root` נראית נכונה, עוברת בילד,
ולא משנה כלום על המסך. הערכים הבאים הם אלה שב-`.dark`.

```css
--gold:       #C9A86C   /* accent ראשי */
--gold-light: #E0C896   /* hover */
--gold-dark:  #A88844   /* active */
--surface:    #0F0F0F   /* רקע ראשי */
--surface2:   #1A1A1A   /* cards */
--surface3:   #242424   /* elevated cards */
--line:       #2A2A2A   /* borders */
--txt:        #F0EDEA   /* טקסט ראשי */
--muted-txt:  #8A8178   /* טקסט משני */
--income:     #4ADE80   /* הכנסות */
--expense:    #F87171   /* הוצאות */
```

ב-Tailwind: `text-gold`, `bg-surface2`, `border-line`, `text-income`, `text-expense`.
אל תכתוב צבע קשיח. למיתוג של משרד ספציפי יש `/brand` ו-`scripts/brand-set.ts`,
זו הדרך היחידה.

---

## 7. פריסה

**שני פרויקטי Vercel מחוברים לריפו הזה, אל תתבלבל:**
- ✅ **`mipuy-financi-app-2-3nay`** הוא הפעיל, ומגיש את `app.orimipuy.com`. זה הירוק שצריך לעבור.
- ❌ **`mipuy-financi-app-2`** נטוש. נכשל בכל דיפלוי וצובע X אדום על כל PR. **להתעלם.**

⚠️ **פריסה שנדחפה אינה פריסה שנחתה.** אל תסיק מ-`git push` שהקוד חי.
סקיל `/ship` מחזיק את מסלול האימות המלא, כולל המלכודת ש-`vercel ls` מדפיס
את הטבלה ל-STDERR (עם `2>/dev/null` תקבל פלט ריק ותסיק שאין פריסה).

**CI** (`.github/workflows/ci.yml`) רץ על כל push: `tsc --noEmit`, `vitest run`,
בדיקת תחביר של functions, שומר עץ ה-functions, ובילד. יש גם ג'וב נפרד שמריץ את
טסטי ה-firestore.rules מול האמולטור (ubuntu, כי אין JRE במכונה המקומית).
זה advisory, אין branch protection. X אדום על main הוא סימן עצור-הכול.

**דיפלוי של Cloud Functions מוגן ב-predeploy hook** (`firebase.json` מריץ את
`scripts/check-functions-tree.js`). הסיבה: ה-CLI של Firebase **מוחק** כל פונקציה
פרוסה שהוא לא מוצא בעץ המקומי. שש פונקציות חיות ישבו פעם על ענף צדדי בלבד,
כך שדיפלוי שגרתי מ-`main` היה מוחק אותן מהפרודקשן בשקט. אם השומר חוסם אותך
בטעות, עדכן את `EXPECTED` **באותו קומיט** שמסיר את המודול.

---

## 8. פקודות

```bash
npm run dev            # פיתוח מקומי → localhost:3000
npm run build          # אם עובר, אין שגיאות TypeScript
npm test               # 472 טסטים
npm run health         # בדיקת מצב המערכת, קריאה בלבד
npm run report:funnel  # דוח AARRR
npm run test:rules     # טסטי firestore.rules מול האמולטור (דורש Java)
```

⚠️ `next dev` שנשאר פתוח כמה ימים גורם לקומפילציות של דקות, והדף נטען אבל לא
עושה hydration. זה נראה בדיוק כמו פיצ'ר שבור. תרענן את השרת לפני שתאשים את הקוד.

---

## 9. חובות ידועים

זה לא רשימת משאלות, אלה דברים שאומתו ופתוחים. אל תגלה אותם מחדש.

- **אפס בדיקות E2E.** `npm run health` מסיים בהפניה ל-`npm run test:e2e`,
  שלא קיים ב-package.json. אין מסלול אוטומטי שמוכיח שהאפליקציה בכלל עובדת.
- **`expenseLog.entries` הוא מערך append-only ללא תקרה** בתוך המסמך שחסום ב-900KB.
  ככל שתיעוד ההוצאות מצליח יותר, כך מתקרב הקיר. אין pruning ואין ארכוב.
- **מתג החירום של ה-AI נכשל פתוח.** ב-`aiBudget.ts`, אם Firestore לא נגיש,
  ה-catch מחזיר `false` ומאפשר להמשיך. הבקרה שותקת בדיוק כשצריך אותה.
- **אין מסלול restore.** יש `backup-firestore.ts`, PITR וגיבוי שבועי.
  אין סקריפט שחזור ואין עדות ששחזור אי פעם בוצע.
- **`bankStore` מוגן רק ברמת הסטור** בטסט הדליפה, לא ברמת השדה כמו `autoMapStore`.
- **גלגל הלמידה תקוע על הצעד האנושי.** הצעות ה-AI נצברות ואף אחד לא סוקר אותן.
  כמה ממתינות עכשיו: `npx tsx scripts/review-ai-suggestions.ts`.
- **קבצים עסקיים לא מעוקבים בשורש הריפו** (הצעות מחיר, חוזים, תמחור) שאינם
  ב-.gitignore. `git add -A` יכניס תנאים מסחריים של לקוח להיסטוריית הגיט.
