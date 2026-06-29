# 🍎 תיעוד אוטומטי של Apple Pay באייפון — הקמת Shortcut

מדריך חד-פעמי. אחרי ההקמה, **כל תשלום Apple Pay בחנות נרשם לבד** בטאב תיעוד ההוצאות.

## דרישות
- iPhone עם **iOS 17 ומעלה** (אז נוספה אוטומציית "Transaction"/"Wallet").
- Apple Pay מוגדר עם כרטיס.

## מה זה תופס / לא תופס
- ✅ תשלומי **Apple Pay פיזיים בחנות** (קירוב NFC).
- ❌ **לא** קניות אונליין, ולא כרטיס פיזי רגיל (בלי Apple Pay).

---

## ההקמה — 3 שלבים

### שלב 1 — קבל את הטוקן והוסף את ה-Shortcut
1. ב-iPhone, פתח ב-Safari את:
   ```
   https://mipuy-financi-app-2-3nay.vercel.app/connect
   ```
   *(או הדומיין `https://app.orimipuy.com/connect` — אותו שרת.)*
2. התחבר עם **המייל והסיסמה של הכלכלן של הבית** (או Google).
3. לחץ **"📋 העתק טוקן"** (שלב 1 במסך) — הטוקן עכשיו בלוח.
4. לחץ **"📲 הוסף את ה-Shortcut"** (שלב 2). אפליקציית Shortcuts תיפתח עם מסך הוספה.
5. במהלך ההוספה תופיע שאלה — **הדבק שם את הטוקן** (הוא כבר בלוח, לחיצה ארוכה → Paste) → **הוסף Shortcut**.

> ה-Shortcut שנוסף נקרא **Mipuy**. הוא כבר יודע לאן לשלוח ועם איזה טוקן — לא צריך לגעת בו יותר.

### שלב 2 — צור את אוטומציית ה-Wallet (שתפעיל את ה-Shortcut אוטומטית)
> את החלק הזה אפל מחייבת להגדיר ידנית פעם אחת — אי אפשר לייבא אותו מוכן.

1. פתח את אפליקציית **Shortcuts** (קיצורים) → לשונית **Automation** (אוטומציה).
2. לחץ **+** (למעלה-ימין) → **Create Personal Automation**.
3. גלול ובחר **Transaction** (ב-iOS 26+ זה נקרא **Wallet**).
4. תחת **When I tap** — בחר את **הכרטיס/ים** שתרצה לעקוב אחריהם (ואפשר Category = All) → **Next**.
5. לחץ **Add Action** → חפש **"Run Shortcut"** ובחר אותו.
6. בפעולה שנוספה לחץ על המילה **"Shortcut"** ובחר את **Mipuy**.
7. ודא שהקלט של ה-Transaction מועבר ל-Shortcut (כברירת מחדל זה כך — ה-"Shortcut Input").
8. לחץ **Next** → **כבה** את **Ask Before Running** (כדי שלא יבקש אישור בכל תשלום) → **Done**.

### שלב 3 — בדיקה
שלם עם Apple Pay בחנות (קירוב). תוך כמה שניות — פתח את האפליקציה → טאב **תיעוד הוצאות** → התשלום אמור להופיע שם, מקוטלג. ✅

---

<details>
<summary><b>אם הייבוא לא עובד — הקמה ידנית מלאה (fallback)</b></summary>

אם מסיבה כלשהי ה-Shortcut המוכן לא נוסף או לא רץ, אפשר לבנות את כל הלוגיקה **ישירות בתוך האוטומציה**, בלי לייבא כלום:

#### חלק א׳ — יצירת האוטומציה
1. **Shortcuts** → **Automation** → **+** → **Create Personal Automation**.
2. בחר **Transaction** (או **Wallet**).
3. **When I tap** — בחר כרטיס/ים (או Category = All).
4. סמן **Run Immediately** → **Next**.

#### חלק ב׳ — הפעולה (שליחה לשרת)
5. **Add Action** → חפש **"Get Contents of URL"** ובחר אותו.
6. בשדה ה-URL הדבק:
   ```
   https://mipuy-financi-app-2-3nay.vercel.app/api/transaction
   ```
7. לחץ **"Show More"** מתחת ל-URL:
   - **Method:** **POST**
   - **Headers:** Add header → Key = `Content-Type`, Value = `application/json`
   - **Request Body:** **JSON**
8. תחת Request Body (JSON) הוסף 3 שדות (**Add new field**):
   | Key | Type | Value |
   |-----|------|-------|
   | `token` | Text | *(הדבק כאן את טוקן-המכשיר שלך מ-/connect)* |
   | `merchant` | Text | המשתנה **Merchant** (בחר מתוך Shortcut Input) |
   | `amount` | Number | המשתנה **Amount** |
9. **Next** → **Done**.

> אם הסכום נכנס מוזר (עם סימן מטבע): לפני שלב 5 הוסף פעולה **"Get Numbers from Input"** על המשתנה Amount, והשתמש בתוצאה שלה בשדה `amount`.

</details>

---

## 🔒 הערת אבטחה
טוקן-המכשיר מאפשר רק **להזריק הוצאות לחשבון שלך** (לא לקרוא נתונים). עדיין — אל תשתף אותו.

## 📌 ליועץ (Ori) — סטטוס
- ה-Shortcut המוכן (`public/mipuy.shortcut`) נחתם בענן דרך GitHub Actions ("Sign iOS Shortcut") ומוגש מ-`/mipuy.shortcut`.
- **טרם אומת על אייפון אמיתי.** עד אז: אם חיווט ה-Merchant/Amount לא עובד מתוך ה-Shortcut המיובא — השתמשו בהקמה הידנית (ה-fallback למעלה), שמחלצת אותם בתוך האוטומציה.
- בשדרוג לדומיין production — אין מה לעדכן כאן: כפתור ההוספה ב-/connect וכתובת ה-Shortcut נגזרים אוטומטית מה-origin. רק כתובת ה-`WFURL` בתוך `ios-shortcut/mipuy.plist` (staging) תוחלף ותיחתם מחדש.

_עודכן: 2026-06-29. ראה גם `docs/triggers-work-plan.md`._
