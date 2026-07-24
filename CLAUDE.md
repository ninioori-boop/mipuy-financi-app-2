# CLAUDE.md — mipuy-financi-app-v2

## כלי MCP — מה מותר להשתמש בו
**השתמש רק בכלים הבאים. אל תטען או תפעיל שום MCP אחר.**

| כלי | מתי |
|-----|-----|
| **context7** | כשצריך תיעוד של ספרייה (Next.js, Firebase, Zustand, shadcn) |
| **playwright** | כשצריך לפתוח דפדפן ולבדוק UI |
| **Google Drive** | אורי אישר במפורש (25/06/2026) — מותר ליצור/להעלות קבצים לדרייב שלו (למשל חשבוניות/גיליונות) |

**אסור להשתמש ב:** Gmail, Google Calendar, Canva, Microsoft 365, Vercel MCP, GitHub MCP.
לכל פעולת git/npm/vercel — השתמש ב-Bash ישירות.

---

## על הפרויקט
**The Home Economist** — גרסה 2 של אפליקציית המיפוי הפיננסי.
נבנית מאפס ב-React/Next.js במקום Vanilla JS, כדי למנוע את סוג הבאגים שנוצרו בגרסה הישנה (state גלובלי, DOM scraping, aliasing בין arrays).

**גרסה ישנה (פועלת):** `../mipuy-financi-app` — ממשיכה לרוץ בנפרד ב-orimipuy.com
**פרויקט זה:** מפותח מקומית עם `npm run dev`, פריסה לדומיין חדש בסוף הפרויקט (יום 17)

---

## סטאק
- **Next.js 16** (App Router, TypeScript)
- **Zustand 5** — state management
- **Tailwind CSS v4** + **shadcn/ui** — עיצוב (אין tailwind.config.ts — הכל ב-globals.css)
- **Firebase 12** (Auth + Firestore) — אותו backend כמו הגרסה הישנה
- **SheetJS xlsx@0.18.5** — parsing Excel (0.18.5 = גרסה אחרונה MIT)
- **Recharts 3** — גרפים
- **Vercel** — deployment (יום 17)

---

## פלטת צבעים — The Home Economist
נגזרת מהלוגו (שתי חצים: זהב + אנתרציט):

```css
--gold:       #C9A86C   /* accent ראשי — מהחץ הזהוב בלוגו */
--gold-light: #E0C896   /* hover states */
--gold-dark:  #A88844   /* active states */
--surface:    #0F0F0F   /* רקע ראשי */
--surface2:   #1A1A1A   /* cards */
--surface3:   #242424   /* elevated cards */
--line:       #2A2A2A   /* borders */
--txt:        #F0EDEA   /* טקסט ראשי */
--muted-txt:  #8A8178   /* טקסט משני */
--income:     #4ADE80   /* הכנסות (ירוק) */
--expense:    #F87171   /* הוצאות (אדום) */
```

**שימוש ב-Tailwind:** `text-gold`, `bg-surface2`, `border-line`, `text-income`, `text-expense`

---

## מבנה תיקיות

```
src/
├── app/
│   ├── layout.tsx              ← dir="rtl", dark, Rubik font
│   ├── page.tsx                ← redirect → /app/credit
│   ├── auth/page.tsx           ← login screen
│   └── app/
│       ├── layout.tsx          ← AppShell + TabNav
│       ├── credit/page.tsx
│       ├── bank/page.tsx
│       ├── mapping/page.tsx
│       ├── monthly/[month]/page.tsx
│       ├── import/page.tsx
│       ├── annual/page.tsx
│       ├── trends/page.tsx
│       ├── guide/page.tsx
│       └── api/
│           ├── categorize/route.ts   ← Claude Haiku proxy (יום 15)
│           └── analyze/route.ts      ← Claude general proxy (יום 15)
├── components/
│   ├── ui/                     ← shadcn auto-generated
│   ├── layout/                 ← AppShell, TabNav, SaveStatusBar, ClientSwitcher
│   ├── auth/                   ← LoginForm, GoogleSignInButton, InviteCodeForm
│   ├── credit/                 ← CreditTab, FileUploadZone, TransactionTable, ...
│   ├── bank/                   ← BankTab, BankTransactionTable, BankInsightsPanel
│   ├── mapping/                ← MappingTab, CategorySection, rows
│   ├── monthly/                ← MonthlyTab, MonthSection, BudgetRow, CashFlowSummary
│   ├── import/                 ← ImportTab, ImportSummaryPanel
│   ├── annual/                 ← AnnualTab, AnnualSection, AnnualKpiBar
│   ├── trends/                 ← TrendsTab + 3 chart components
│   └── shared/                 ← HebrewAmount, LoadingOverlay, CategoryIcon
├── stores/                     ← Zustand stores (יום 4)
│   ├── creditStore.ts
│   ├── importStore.ts          ← מבודד לחלוטין מ-creditStore!
│   ├── mappingStore.ts
│   ├── budgetStore.ts
│   ├── annualStore.ts
│   ├── bankStore.ts
│   ├── learnedDBStore.ts
│   ├── authStore.ts
│   └── uiStore.ts
├── hooks/                      ← custom hooks (ימים 3-5)
│   ├── useFileParser.ts
│   ├── useAiCategorize.ts
│   ├── useAuth.ts
│   ├── useFirestoreSync.ts
│   ├── useLearnedDB.ts
│   ├── useMonthlyCalc.ts
│   ├── usePushToBudget.ts
│   └── useTrendsData.ts
├── lib/
│   ├── firebase.ts             ← נוצר
│   ├── parsing.ts              ← port מ-parsing.js (יום 3)
│   ├── categorize.ts           ← port מ-globals.js (יום 3)
│   ├── businessDB.ts           ← BUSINESS_DB 3000+ entries (יום 3)
│   ├── constants.ts            ← ALL_CATEGORIES, MONTHS_LIST (יום 3)
│   ├── healthScore.ts          ← buildHealthScore pure (יום 3)
│   ├── firestoreService.ts     ← saveMap, loadMap, invites (יום 2)
│   └── utils.ts                ← נוצר (shadcn cn helper)
└── types/
    ├── transaction.ts          ← (יום 3)
    ├── budget.ts               ← (יום 3)
    ├── auth.ts                 ← (יום 3)
    └── firestore.ts            ← (יום 3)
```

---

## Firebase
**Project ID:** `finance-machine-a36e9`
**Auth Domain:** `orimipuy.com`
**Collections:** `users/{uid}`, `maps/{clientUid}`, `invites/{code}`

env vars ב-.env.local (לא לcommit):
- `NEXT_PUBLIC_FIREBASE_*` — client-side
- `ANTHROPIC_API_KEY` — server-side בלבד, אסור NEXT_PUBLIC_

---

## Vercel / פריסה
**שני פרויקטי Vercel מחוברים ל-repo הזה — אל תתבלבל:**
- ✅ **`mipuy-financi-app-2-3nay`** — הפרויקט **הפעיל** (staging חי): `mipuy-financi-app-2-3nay.vercel.app`. זה הירוק שצריך לעבור.
- ❌ **`mipuy-financi-app-2`** — פרויקט **ישן/זנוח** מלפני המעבר לנוכחי. נכשל בכל deploy ו**צובע X אדום על כל PR — להתעלם, זה לא הקוד שלנו.** (אפשר לנתק אותו ב-Vercel → Settings → Git בהזדמנות.)

---

## אינווריאנטים קריטיים

```
❌ creditStore ↔ importStore — אסור aliasing או שיתוף reference
   (זה היה הבאג הגדול בגרסה הישנה)

✅ FileUploadZone מקבל prop: onFileParsed(txs) — parent מחליט לאיזה store
✅ SmartPatternsPanel מקבל prop: transactions[] — לא קורא מגלובל
✅ deletedRows ב-budgetStore מונע reappearance של שורות שנמחקו
✅ ANTHROPIC_API_KEY בלי NEXT_PUBLIC_ — server-side only
✅ xlsx@0.18.5 — אל תשדרג (0.20+ דורש רישיון מסחרי)
```

---

## מקורות לport מהגרסה הישנה

| קובץ ישן | מה לקחת ממנו |
|----------|--------------|
| `../mipuy-financi-app/parsing.js` | detectColumns, parseAmount, extractTransactions, extractInstallmentInfo, isStandingOrderDesc |
| `../mipuy-financi-app/globals.js` | BUSINESS_DB (3000+ entries), ALL_CATEGORIES, CATEGORY_ICONS, buildHealthScore logic |
| `../mipuy-financi-app/client.js` | clientCollectData/clientRestoreData — serialization contract |
| `../mipuy-financi-app/api/categorize.js` | verifyFirebaseToken, rate limiting → Next.js API route |
| `../mipuy-financi-app/monthly.js` | moApplyCreditData, syncManualToMonth → budgetStore actions |
| `../mipuy-financi-app/auth.js` | save guards (< 300 bytes), online/offline logic |

---

## לוח עבודה — סטטוס

| יום | פיצר | סטטוס |
|-----|-------|--------|
| **1** | 🏗️ Bootstrap — Next.js, shadcn, Firebase, RTL, Rubik, routes | ✅ הושלם |
| **2** | 🔐 Auth — Google Sign-In, AuthProvider, Firestore sync | ⏳ הבא |
| **3** | 🧠 Pure Logic — types, parsing.ts, categorize.ts, BUSINESS_DB, unit tests | ⏳ |
| **4** | 🗃️ Stores — כל Zustand stores | ⏳ |
| **5** | 📤 File Upload + Parser — FileUploadZone, useFileParser, TransactionTable | ⏳ |
| **6** | 💳 טאב אשראי — SmartPatterns, CreditSummary, PushToBudget | ⏳ |
| **7** | 🗂️ טאב מיפוי ידני — CategorySection, rows, LiveSummary | ⏳ |
| **8** | 📅 טאב חודשי (תשתית) — MonthlyTab, BudgetRow, plan vs actual | ⏳ |
| **9** | 📅 טאב חודשי (השלמה) — installments, debts, savings, deletedRows | ⏳ |
| **10** | 📥 טאב ייבוא — importStore מבודד, שליחה לחודש | ⏳ |
| **11** | 🏦 טאב עו"ש — BankTab, BankInsights | ⏳ |
| **12** | 📊 מגמות — 3 גרפים Recharts, YTD KPIs | ⏳ |
| **13** | 📆 תכנון שנתי — AnnualTab, anPullActuals | ⏳ |
| **14** | 👥 Multi-user — Advisor panel, invite codes, onSnapshot | ⏳ |
| **15** | 🤖 AI Categorization — /api/categorize route, useAiCategorize | ⏳ |
| **16** | 🎨 עיצוב + UX — RTL polish, HebrewAmount, toast, responsive | ⏳ |
| **17** | 🧪 בדיקות + פריסה — Vitest, Playwright E2E, Vercel deploy | ⏳ |

---

## הרצה מקומית
```bash
cd "c:\Users\ninio\Downloads\קלוד קוד\mipuy-financi-app-v2"
npm run dev
# → http://localhost:3000
```

## בדיקה מהירה (build)
```bash
npm run build   # אם עובר — אין שגיאות TypeScript
```

---

## הערות פיתוח

- **Tailwind v4:** אין `tailwind.config.ts` — צבעים ב-`src/app/globals.css` תחת `@theme inline` ו-`.dark`
- **shadcn:** קומפוננטות ב-`src/components/ui/` — השתמש ב-`npx shadcn@latest add`
- **RTL:** `dir="rtl"` ב-`<html>` מטפל בכיוון. השתמש ב-`ps-` / `pe-` / `ms-` במקום `pl-` / `pr-` / `ml-`
- **Font:** Rubik (Hebrew+Latin) נטען דרך `next/font/google`, variable: `--font-rubik`
- **Firebase:** modular SDK v9 (לא compat). `import { getAuth } from 'firebase/auth'`
- **params ב-Next.js 16:** `params` הם Promise — צריך `await params` ב-server components
