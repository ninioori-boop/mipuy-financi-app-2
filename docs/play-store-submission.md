# 📦 העלאת "מעקב הוצאות" ל-Google Play — חבילת הגשה

מסמך מוכן-להעתקה לכל שדה ב-Play Console. מתחילים ב-**Internal Testing**.

---

## פרטי אפליקציה
| שדה | ערך |
|-----|-----|
| שם האפליקציה (≤30) | `מעקב הוצאות — הכלכלן של הבית` |
| Package name | `com.orimipuy.tracker` |
| קטגוריה | Finance |
| אימייל ליצירת קשר | `ninioori@gmail.com` |
| מדיניות פרטיות (URL) | `https://mipuy-financi-app-2-3nay.vercel.app/privacy` |

> כשנעבור לדומיין production → לעדכן ל-`https://app.orimipuy.com/privacy`.

---

## תיאור החנות (Store listing — עברית)
**תיאור קצר (≤80 תווים):**
```
רישום הוצאות אוטומטי מ-Google Pay ישירות לחשבון שלך, מקוטלג לפי קטגוריה.
```

**תיאור מלא:**
```
"מעקב הוצאות" של הכלכלן של הבית רושם את ההוצאות שלך אוטומטית — בלי להקליד כלום.

• כל תשלום ב-Google Pay נקלט מעצמו ונרשם בחשבון שלך, מקוטלג לקטגוריה הנכונה.
• אפשר גם לרשום הוצאה ידנית בלחיצה.
• פילוח הוצאות לפי קטגוריה, מקובץ לפי ימים.
• הכול מסונכרן לחשבון שלך במערכת "הכלכלן של הבית".

האפליקציה קוראת את התראות התשלום של Google Wallet אך ורק כדי לרשום את ההוצאה
(שם בית העסק והסכום). המידע נשלח מוצפן לחשבון שלך בלבד ולא משותף עם אף צד שלישי.
```

---

## 🔐 Data Safety (טופס בטיחות נתונים)
**Does your app collect or share user data?** → **Yes**

| סוג נתון | נאסף? | משותף? | חובה? | מטרה |
|----------|:-----:|:------:|:-----:|------|
| Financial info → **Purchase history** (שם עסק + סכום) | ✅ | ❌ | ✅ | App functionality |
| Device or other IDs → **device token** | ✅ | ❌ | ✅ | App functionality |

- **Encrypted in transit?** → **Yes** (HTTPS)
- **Can users request data deletion?** → **Yes** (דרך החשבון / מייל `ninioori@gmail.com`)
- **Data sold to third parties?** → **No**
- **Data shared for advertising?** → **No**
- הערה: תיאורי-עסקה מעובדים ע"י Anthropic (Claude) לצורך קטלוג בלבד, ללא פרטים מזהים.

---

## ⚠️ Permissions Declaration — Notification access (BIND_NOTIFICATION_LISTENER_SERVICE)
*(טופס "Sensitive app permissions" → Notification access. לכתוב באנגלית לבודקים:)*
```
Core functionality: This app's sole purpose is automatic personal expense
tracking. It reads the user's own payment notifications (Google Wallet) to
capture the merchant name and amount, then logs them to the user's personal
expense account. The notification-access permission is essential — the app
cannot perform its core function without it.

The user grants the permission explicitly, after an in-app prominent disclosure
that states exactly what is read and why, and can revoke it at any time from
device settings. Only the merchant name and amount are used; no other
notification content is read, stored, or shared. No notification data is sold
or shared with any third party.
```

---

## 🛡️ Prominent disclosure (כבר מוטמע באפליקציה)
*(הטקסט שמופיע במסך הגילוי לפני "אפשר גישה להתראות" — להראות לבודקים אם יבקשו):*
```
כדי לרשום הוצאות אוטומטית, האפליקציה קוראת את התראות התשלום שלך מ-Google Wallet.
שם בית העסק והסכום בלבד נשלחים באופן מאובטח (HTTPS) לחשבון שלך במערכת
"הכלכלן של הבית" — ולא משותפים עם אף צד שלישי. אפשר לבטל בכל רגע דרך הגדרות המכשיר.
```

---

## Content rating
- שאלון IARC: אין אלימות/תוכן מיני/הימורים/חומרים → דירוג צפוי **Everyone / לכל הגילאים**.

---

## 🖼️ נכסים שאתה צריך לספק (גרפיקה)
| נכס | מידות | מקור |
|-----|-------|------|
| אייקון חנות | 512×512 PNG | לשנות גודל של `public/logo.png` ל-512×512 |
| צילומי מסך טלפון (2–8) | ~1080×1920 | מהאפליקציה: מסך ראשי (סטטוס+עסקאות+פילוח), מסך חיבור, דיאלוג הוצאה ידנית |
| Feature graphic (אופציונלי) | 1024×500 | מהמותג (זהב/אנתרציט) |

> לצילומי מסך: פתח את האפליקציה במכשיר, צלם, ושלח לי — או נשתמש בצילומים שכבר יש.

---

## סדר הפעולות ב-Play Console (חלק ג׳)
1. פתיחת חשבון מפתח ($25 חד-פעמי) → **play.google.com/console**.
2. **Create app** → שם, עברית, Free, אישור מדיניות.
3. **Internal testing** → Create release → העלאת ה-AAB (`mipuy-expense-tracker-v3.0.aab`).
4. מילוי: App content → Privacy policy / Data safety / Permissions / Content rating.
5. הוספת מיילים של לקוחות-בודקים → שיתוף קישור הצטרפות.
6. Submit לבדיקה.

_נכתב: 2026-06-29. ראה גם `docs/triggers-work-plan.md`._
