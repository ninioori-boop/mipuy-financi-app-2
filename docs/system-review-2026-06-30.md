# 📋 דוח סקר מערכת — The Home Economist (v2)

**תאריך:** 30/06/2026
**היקף:** סקירה מקיפה של אבטחה, ארכיטקטורה, ניהול נתונים, תלויות ובדיקות.
**שיטה:** קריאה ישירה של קוד האבטחה (rules, routes, אימות טוקנים, ניהול סודות) + סקירת שכבת ה‑state וה‑persistence.

---

## 🎯 תקציר מנהלים

המערכת במצב **בריא ובוגר** ביחס לגודלה (~24 משתמשים, invite‑only). ניכרת עבודת
הידוק אבטחה שיטתית ומתועדת היטב. **אין פגיעות קריטית פתוחה**, וסודיות הנתונים בין
לקוחות מוגנת היטב.

| תחום | ציון | תמצית |
|------|:----:|------|
| 🔐 סודיות נתונים (בין לקוחות) | **9.5 / 10** | כללי Firestore/Storage מהודקים, owner‑only + invite‑only |
| 🔑 ניהול סודות ומפתחות | **9.5 / 10** | אפס סודות בקוד, env‑vars בלבד, server‑side only |
| 💸 הגנת עלות / מניעת abuse | **6.5 / 10** | הפער המרכזי — rate‑limit דליף, App Check כבוי, אין kill‑switch |
| 🏗️ ארכיטקטורה וניהול state | **8.5 / 10** | בידוד stores מצוין, הבאג ההיסטורי (aliasing) נפתר |
| 🧪 כיסוי בדיקות | **6 / 10** | בדיקות ליבה טובות, חסרים E2E ובדיקות לחלק מה‑stores |
| 📚 תיעוד ותגובת‑אירוע | **9 / 10** | runbook, hardening‑plan, invite‑setup — ברמה גבוהה |

**ציון כללי משוקלל: ~8.2 / 10** — "טוב מאוד, עם פער ידוע אחד (הגנת עלות) שמרביתו כבר
מתוכנן ומחכה למימוש/קונפיגורציה."

---

## 1. 💪 חוזקות

### 1.1 אבטחה ותשתית
- **אפס סודות בקוד.** סריקה לא מצאה אף מפתח/סיסמה מקודד. כל הסודות דרך env‑vars:
  `ANTHROPIC_API_KEY` ו‑`FIREBASE_SERVICE_ACCOUNT` הם **server‑side בלבד** (אף פעם לא `NEXT_PUBLIC_`).
- **`.gitignore` מקיף** — חוסם `.env*`, `*.pem`, `service-account-key.json`, וקבצי ייצוא לקוחות.
- **שכבת הגנה התנהגותית פעילה** — ה‑hook ‏`security-guard.js` חסם בפועל, במהלך הסקירה הזו,
  ניסיון לגעת בשמות קבצי סוד דרך הטרמינל. ההגנה לעומק עובדת.
- **כללי Firestore מהודקים** ([firestore.rules](../firestore.rules)):
  - `users/{uid}` — קריאה/כתיבה רק לבעלים **וגם** רק אם המייל קיים ב‑`allowlist` (invite‑only).
  - `shared/learnedDB` — ולידציית מבנה + תקרת גודל (20,000 מפתחות) + `hasAll` שמונע מחיקת מפתחות ו‑wipe.
  - `transactionInbox` — הלקוח יכול רק לקרוא/למחוק את הפריטים שלו; **`create/update = false`** (אי‑אפשר לזייף עסקה).
  - כל השאר חסום (`allow read, write: if false`).
- **כללי Storage** ([storage.rules](../storage.rules)) — owner‑only + advisor, תקרת 25MB, whitelist של סוגי קבצים.
- **אימות טוקנים ידני ונכון:**
  - [verifyFirebaseToken.ts](../src/lib/verifyFirebaseToken.ts) — בודק חתימת RSA‑SHA256, `exp`, `aud`, `iss` מול ערכים קבועים.
  - [verifyAppCheckToken.ts](../src/lib/verifyAppCheckToken.ts) — אותו דבר ל‑App Check, **fail‑closed**.
  - [deviceToken.ts](../src/lib/deviceToken.ts) — HMAC‑SHA256 עם השוואה ב‑`timingSafeEqual` (עמיד ל‑timing attack).
- **AI routes מוגנים** (categorize / analyze / automap / bank / credit): אימות Bearer חובה,
  rate‑limit per‑user, תקרת גודל קלט, **system prompt בבעלות השרת** (חוסם prompt‑injection
  ושימוש חוזר במפתח כ‑Claude כללי), ו‑`max_tokens` קבוע.
- **admin SDK מבודד** ([firebaseAdmin.ts](../src/lib/firebaseAdmin.ts)) — רץ רק בשרת, ומחזיר
  `null` → 503 כשהשירות לא מוגדר. אפשר לפרוס "כבוי" בלי לשבור כלום.
- **Security headers** ([next.config.ts](../next.config.ts)) — `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, ו‑CORS `same-origin` על `/api`.
- **App Check מחווט וממתין** — קוד מלא, מאחורי דגל סביבה. ניתן להפעיל ללא שינוי קוד.
- **אין וקטורי XSS** — אפס שימוש ב‑`dangerouslySetInnerHTML` / `eval` / `innerHTML`.

### 1.2 ארכיטקטורה וניהול נתונים
- **בידוד stores** — 11 חנויות Zustand נפרדות, כל אחת עם אחריות ברורה.
- **הבאג ההיסטורי נפתר.** הבעיה הגדולה של הגרסה הישנה — שיתוף reference (aliasing) בין
  arrays של stores — **לא קיימת כאן.** כל עדכון משתמש ב‑spread ו‑`uid()` טרי לכל שורה.
- **שכבת persistence עמידה** — `collectSnapshot` / `applySnapshot` עם בדיקות טיפוס,
  מיגרציות לאחור (back‑compat לשדות חדשים), ו‑dedup של IDs כפולים.
- **שמירה חכמה** — debounce 2 שניות, דילוג על שמירה כשאין שינוי (skip‑identical), ותקרת 900KB.
- **`deletedFromMapping` guard** — מונע "תחיית" שורות שנמחקו ידנית (באג ידוע נוסף מהעבר).
- **בדיקת רגרסיה ממוקדת** — קיים test שמוודא ש**כל** שדה persistable שורד מסע
  collect→JSON→reset→apply בלי אובדן. בדיוק הסוג שמונע את הבאג ההיסטורי.

### 1.3 תפעול ותגובת‑אירוע
- **runbook מלא** ([incident-runbook.md](incident-runbook.md)) — תרחישי דליפת מפתח / abuse עלות /
  הרעלת learnedDB, כל אחד עם "איך מזהים → איך עוצרים → איך משחזרים".
- **תוכנית הידוק מתועדת** ([security-hardening.md](security-hardening.md)) — מצב כל משימה ברור.

---

## 2. ⚠️ חולשות ופערים (מדורג לפי חומרה)

### 🔴 בינוני‑גבוה — הגנת עלות / abuse (הפער המרכזי)
1. **rate‑limit "דליף" על Vercel.** המונה שומר ספירה ב‑`Map` בזיכרון
   ([categorize/route.ts:7](../src/app/api/categorize/route.ts#L7) וכו'). על serverless כל instance
   מתחיל מאפס, כך שתוקף שמפזר בקשות עוקף בקלות את התקרה. *(מתועד כמשימה 1.6, טרם מומש.)*
2. **אין תקרת הוצאה יומית גלובלית / kill‑switch** על ה‑AI. מתקפה מתואמת מכמה חשבונות
   מאושרים יכולה לצבור עלות. ההגנה היחידה כיום היא spend‑limit בקונסולת Anthropic — **רק אם הוגדר ידנית.** *(משימה 1.7, טרם מומש.)*
3. **App Check לא נאכף.** הקוד מחווט אך כבוי (`APP_CHECK_ENFORCE` ו‑Firestore enforcement).
   כל מי שמחזיק טוקן auth תקין יכול לקרוא ל‑routes ישירות בסקריפט, מחוץ לאפליקציה.
   *(אכיפה על Firestore מוקפאת בכוונה — תשבור את האפליקציה הישנה ב‑orimipuy.com עד שתצויד גם היא.)*

### 🟠 בינוני — נתיב ה‑device token (קליטת עסקאות אוטומטית)
4. **ה‑routes של ה‑device token חסרים rate‑limit.** ‏`/api/transaction`, `/api/learn`,
   `/api/app-session` מאומתים ב‑HMAC בלבד — **אין** מגבלת קצב ואין App Check. מי שמשיג
   device token של משתמש יכול להציף את ה‑inbox שלו, ללמד את ה‑`learnedDB` המשותף ללא הגבלה,
   או (דרך app‑session) לקבל session מלא לחשבון.
5. **device token לא ניתן לביטול פרטני.** סיבוב `TRANSACTION_SECRET` מבטל את הטוקנים של
   **כל** המשתמשים בבת אחת. אם טלפון של לקוח נגנב, אין דרך לבטל רק אותו.
6. **`/api/app-session` מרחיב הרשאות** — ממיר device token ("רק לשלוח הוצאה") ל‑custom token
   ("session מלא"). הגיוני לצורך ה‑WebView, אבל מגדיל את רדיוס הנזק אם token יחיד דולף — וללא הגבלת קצב על ההנפקה.

### 🟡 נמוך — היגיינה וחוב טכני
7. **כפילות מיילים של היועץ ב‑3 מקומות** — `firestore.rules`, `storage.rules`, ו‑[labAccess.ts](../src/lib/labAccess.ts).
   שינוי באחד בלי השניים האחרים = drift שקט. *(מתועד בהערות, אך עדיין שביר.)*
8. **הודעות שגיאה לא עקביות** — ב‑[bank-statement/route.ts](../src/app/api/bank-statement/route.ts)
   ו‑credit‑statement התקרה היא 60 אבל ההודעה למשתמש אומרת "(15)". מבלבל, לא מסוכן.
9. **`email_verified` לא נאכף** — חשבון לא מאומת שנמצא ב‑allowlist עדיין עובד. הסיכון נמוך כי
   ההרשמה ממילא invite‑only. *(הוחלט לדלג.)*
10. **`learnedDB` המשותף לא נשמר per‑user** — הוא נטען לכל session אבל לא נכלל ב‑snapshot.
    אחרי logout/login יש רגע קצר עד שהוא נטען מחדש. UX minor, לא אובדן נתונים.
11. **כשלים שקטים בלי התראה** — `saveLearnedEntry` הוא fire‑and‑forget (אם נכשל, אין retry ואין
    הודעה למשתמש), ו‑`applySnapshot` מדלג בשתיקה על רשומות פגומות. הגנתי, אך מסתיר תקלות.

### 🟡 נמוך — תלויות ותפעול
12. **`xlsx@0.18.5`** — יש advisories ידועות (prototype‑pollution / ReDoS). רדיוס הנזק מוגבל
    (פענוח בדפדפן בלבד), ואסור לשדרג ל‑0.20+ (רישיון מסחרי). שווה מעקב או מעבר ל‑fork מתוחזק. *(משימה 2.6.)*
13. **אין גיבוי אוטומטי של Firestore** — מתועד ב‑runbook §8. אין snapshot מתוזמן; שחזור מאובדן נתונים יהיה ידני.

### 🟡 נמוך — כיסוי בדיקות
14. **חסרים בדיקות** ל‑`autoMapStore`, `meetingsStore`, `expenseLogStore`, `categoryBudgetStore`,
    ו‑seed של `businessAnnualStore`. **אין E2E** למסע המלא (login → שינוי → שמירה → logout → login).

---

## 3. 🔒 רמת אבטחה — הערכה לפי וקטור תקיפה

| וקטור | רמת הגנה | הערה |
|------|:--------:|------|
| לקוח קורא נתונים של לקוח אחר | 🟢 גבוהה מאוד | `uid == userId` + invite‑only; חסום ברמת ה‑DB |
| דליפת מפתח/סוד דרך הקוד או git | 🟢 גבוהה מאוד | אפס סודות בקוד, gitignore, hook חוסם |
| זיוף טוקן / עקיפת אימות | 🟢 גבוהה | אימות חתימה מלא, fail‑closed, constant‑time |
| prompt‑injection / ניצול מפתח ה‑AI | 🟢 גבוהה | system prompt בבעלות השרת, max_tokens קבוע |
| הצפת עלות (AI) ע"י משתמש מאושר | 🟠 בינונית | rate‑limit דליף, אין kill‑switch גלובלי |
| גישה ישירה ל‑API ע"י סקריפט חיצוני | 🟠 בינונית | App Check כבוי; מוגן רק ע"י טוקן auth |
| ניצול נתיב ה‑device token | 🟠 בינונית | HMAC חזק, אך ללא rate‑limit/ביטול פרטני |
| XSS / הזרקת קוד בצד לקוח | 🟢 גבוהה | אין וקטורים בקוד |

**שורה תחתונה:** הסיכון ל**סודיות** הנתונים — נמוך מאוד. הסיכון ל**עלות/abuse** (הארנק) —
בינוני, וזה ה‑gap היחיד שדורש תשומת לב אקטיבית.

---

## 4. ➕ מה עוד ניתן להוסיף (לפי תשואה)

**מהיר ובעל ערך גבוה (רובו קונסולה, דקות):**
1. **spend‑limit קשיח בקונסולת Anthropic** + התראות תקציב ב‑GCP. רשת ביטחון מיידית לארנק. ⭐
2. **רישום reCAPTCHA ל‑App Check** → ואז הפעלת `APP_CHECK_ENFORCE=true` על ה‑AI routes
   (לא על Firestore, כדי לא לשבור את האפליקציה הישנה). חוסם סקריפטים חיצוניים.

**מימוש קוד (שעות):**
3. **rate‑limit עמיד** מגובה Firestore (מונה per‑uid/חלון) במקום `Map` בזיכרון.
4. **תקרה יומית גלובלית + kill‑switch** ל‑AI — חסם עליון על העלות היומית גם בהתקפה מתואמת.
5. **rate‑limit + logging** על `/api/transaction`, `/api/learn`, `/api/app-session`.
6. **device token עם אפשרות ביטול פרטני** — למשל גרסה per‑user שמורה ב‑Firestore, כך שאפשר
   לבטל טלפון בודד בלי לסבב את כולם.

**היגיינה ועמידות (שעות):**
7. **מקור אמת יחיד למיילי היועץ** — ליצור מנגנון שמסנכרן את שלושת המקומות (או לפחות בדיקת CI).
8. **תיקון הודעת התקרה** (60 במקום "15") ב‑statement routes.
9. **גיבוי Firestore מתוזמן** (`gcloud firestore export` תקופתי).
10. **השלמת בדיקות** — tests ל‑stores החסרים + E2E אחד למסע השמירה המלא.
11. **מעקב/מעבר ל‑fork מתוחזק של xlsx** (למשל build מתוקן) במקום 0.18.5.

---

## 5. 🧭 מסקנות

1. **המערכת מוכנה לשימוש החי שלה.** הבסיס מוצק: בידוד נתונים, ניהול סודות, ואימות —
   כולם ברמה גבוהה. הבאגים הארכיטקטוניים שהובילו לבנייה‑מחדש (aliasing, תחיית שורות) **נפתרו ויש להם בדיקות.**

2. **הפער היחיד שדורש תשומת לב הוא "הארנק" — לא הסודיות.** ההגנה מפני הצפת עלות חלקית:
   ה‑rate‑limit לא עמיד על serverless, App Check כבוי, ואין kill‑switch. החדשות הטובות —
   רוב זה כבר מתוכנן במסמך ההידוק; חסר מימוש וקונפיגורציה, לא תכנון.

3. **שתי פעולות קונסולה של דקות נותנות את מרבית ההגנה:** spend‑limit ב‑Anthropic +
   הפעלת App Check על ה‑routes. זו ההמלצה המיידית מספר 1 — במיוחד לפני הרחבת קהל המשתמשים.

4. **נתיב ה‑device token הוא הרחבה חדשה ששווה הידוק** לפני שהוא נכנס לשימוש רחב: rate‑limit
   וביטול פרטני. כרגע הוא 503/כבוי, אז יש זמן לעשות זאת לפני ההפעלה.

5. **חוב טכני קל ומנוהל:** כפילות מיילים, הודעת שגיאה, וכיסוי בדיקות חלקי — כולם נמוכי‑סיכון
   ומתאימים ל"שיפור הדרגתי", לא לחירום.

**המלצת קדימות לפני הרחבה / Play Store:** ① spend‑limit + התראות תקציב → ② App Check על routes
→ ③ rate‑limit עמיד + kill‑switch → ④ הידוק נתיב ה‑device token.

---

*נכתב ע"י סקירה אוטומטית של הקוד, 30/06/2026. כל ההפניות לקבצים לחיצות.*
