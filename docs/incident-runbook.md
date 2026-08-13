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
3. **כיבוי מוחלט של ה-AI** — ב-Vercel הסר/שנה את `ANTHROPIC_API_KEY` (ה-routes יחזירו 500 "לא מוגדר"). זה מכבה את כל הסיווג/ניתוח עד שתחזיר.

**שחזור:** החזר את המפתח / הפעל מחדש את המשתמש אחרי שהאיום חלף.

---

## 2. 📊 חשד להתעללות / קפיצת עלות ב-Firestore

**זיהוי:** [GCP Billing](https://console.cloud.google.com/billing) או [Firebase Usage](https://console.firebase.google.com/project/finance-machine-a36e9/firestore/usage) — קפיצה חריגה ב-reads/writes (הבסיס הרגיל: ~25 reads / ~39 writes ביממה).

**עצירה מיידית:**
1. **נטרל את המשתמש** (כמו 1.2 לעיל) — נתוני כל משתמש מבודדים ל-`users/{uid}`, אז ניטרול חוסם את הווקטור שלו לחלוטין.
2. **הקפאת כתיבות חירום** — אם צריך לעצור הכל בזמן חקירה, פרוס כללי "read-only" זמניים (ראה §6).
3. App Check enforcement — **לא** פתרון מהיר כאן: זה ישבור גם את `orimipuy.com`. ראה §7.

**שחזור:** יש גיבוי אוטומטי (יומי + שבועי + PITR) ו-dump מקומי — ראה §8.

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

## 8. 🛟 גיבוי (פעיל מ-04/08/2026)
שלוש שכבות:
1. **גיבוי מתוזמן של Google** (הוגדר בקונסולה ע"י אורי): יומי עם שמירה של 14 יום + שבועי (ימי ראשון) עם שמירה של 98 יום, ו-Point-in-time recovery (7 ימים). ניהול: [Disaster Recovery](https://console.cloud.google.com/firestore/databases/-default-/disaster-recovery?project=finance-machine-a36e9). **שחזור מגיבוי כזה יוצר מסד חדש** — מתאים לאסון, לא לתיקון נקודתי. ל**חשבון השירות** אין הרשאת backupSchedules (403), אבל **ה-CLI עם ההתחברות של אורי כן רואה הכל** — אין צורך בקונסולה:
   ```bash
   firebase firestore:backups:list --project finance-machine-a36e9
   firebase firestore:backups:schedules:list --project finance-machine-a36e9
   ```
   כל גיבוי מופיע עם `Snapshot Time` ו-`State`. **`READY` = ניתן לשחזור.**
2. **dump מקומי מלא:** `npx tsx scripts/backup-firestore.ts` (קריאה בלבד) — כל האוספים כולל תתי-אוספים ל-`..\firestore-backups\<תאריך>` מחוץ ל-git, עם אימות עצמי. **להריץ לפני כל פעולה מסוכנת.** ממנו משחזרים מסמך בודד (שחזור כירורגי).
3. סקריפט `npm run export:clients` — snapshot של המשתמשים ל-`clients.md`/`.html` (תיעוד מצב, לא גיבוי).

---

## 9. 🔁 שחזור מאסון — **נוהל מוכח** (בוצע ואומת 12/08/2026)

> זה לא תיאור תיאורטי. הנוהל הזה הורץ מקצה לקצה על הפרודקשן, והמספרים למטה נמדדו.

**מתי:** נתונים נמחקו/הושחתו בהיקף רחב. לתיקון מסמך בודד — עדיף §8.2 (dump מקומי).

**🔴 כלל הזהב:** משחזרים **תמיד** למסד חדש. הדגל `-d` קובע את היעד.
**לעולם אל תעביר `(default)` ל-`-d`.** מסד חדש = הפרודקשן לא נוגע בו בכלל.

```bash
# 1. איזה גיבויים יש (בחר לפי Snapshot Time, ודא State=READY)
firebase firestore:backups:list --project finance-machine-a36e9

# 2. שחזר למסד חדש. שם היעד חייב להיות חדש ולא קיים.
firebase firestore:databases:restore --project finance-machine-a36e9 \
  -d restore-<תאריך> -b projects/finance-machine-a36e9/locations/nam5/backups/<BACKUP_ID>

# 3. אחרי אימות — מחק את מסד הבדיקה, אחרת הוא ממשיך לעלות כסף
firebase firestore:databases:delete restore-<תאריך> --project finance-machine-a36e9 --force
```

### ⏱️ מה שנמדד בפועל, ושחייבים לדעת מראש

- **הפקודה חוזרת תוך 8 שניות. זה לא אומר שהשחזור נגמר.** היא רק מתחילה אותו.
- **המסד לא ניתן לקריאה במשך ~14 דקות** (855 שניות נמדדו על מסד בגודל הנוכחי).
  כל קריאה מוחזרת עם `9 FAILED_PRECONDITION: Cannot serve requests when the
  database is undergoing a restore`.
- 🔴 **המלכודת:** המסד מתחיל להגיש קריאות **לפני** שהשחזור הסתיים. בבדיקה,
  קריאה ראשונה הצליחה ואז הקריאה הבאה נכשלה שוב באותה שגיאה. **קריאה מוצלחת אחת
  אינה סימן שהשחזור נגמר.** מי שיראה את זה באירוע אמיתי ויכריז "חזרנו" יקרא
  נתונים חלקיים. חכה לכמה קריאות רצופות מוצלחות.
- ה-CLI מדפיס בסיום מחיקה מזהה UUID ולא את שם המסד. זה תקין. לאימות:
  `firebase firestore:databases:list` — צריך להישאר רק `(default)`.

### ✅ איך מאמתים שהשחזור באמת נאמן

**אל תשווה עותק משוחזר לפרודקשן החי ותצפה לזהות.** הגיבוי הוא צילום רגע, והפרודקשן
זז מאז. השוואה עיוורת תדליק אזעקות שווא (בבדיקה: `advisors` 6 מול 8, כי שניים נמחקו
אחרי הצילום).

המבחן הנכון נשען על `users/{uid}.updatedAt`:

| מצב המסמך | מה חייב להתקיים |
|-----------|------------------|
| `updatedAt` **לפני** זמן הגיבוי | חייב להיות **זהה בית-בית** בעותק המשוחזר. הבדל כאן = פגם שחזור אמיתי |
| `updatedAt` **אחרי** זמן הגיבוי | חייב לחזור עם חותמת זמן ≤ זמן הגיבוי, כלומר גרסה ישנה תקינה |
| חסר מהמשוחזר | תקין **רק** אם נוצר אחרי הצילום. מסמך ישן שחסר = אובדן נתונים |
| אוסף ריק במשוחזר | תקין רק אם **כל** המסמכים בו נכתבו אחרי הצילום (קרה עם `learnedProposals`) |

**תוצאת האימות מ-12/08/2026** (גיבוי של 11/08 13:12, 26 אוספים):
`46/46 תיקים שוחזרו · 39 שלא נגעו בהם מאז הצילום חזרו זהים בית-בית ·
7 שנערכו מאז חזרו כגרסה תקינה מלפני הצילום · 0 פגמים · אפס אובדן נתונים.`
התיק הגדול (183KB) שוחזר במלואו כולל תת-אוספים (19 גרסאות, 1 section).

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
