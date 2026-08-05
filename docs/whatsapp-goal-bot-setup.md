# בוט מטרות אישי בוואטסאפ — מדריך הקמה

בוט אישי שאורי מדבר איתו בוואטסאפ:

- **21:00 כל יום** → הבוט שולח "מה המטרות שלך למחר?"
- **13:00 כל יום** → הבוט שולח "אילו מטרות השלמת?"
- בכל רגע אפשר לכתוב לבוט רשימת מטרות, או "סיימתי את השנייה" / "עשיתי ספורט" והוא מסמן ✓.

הכול רץ על Firebase Functions הקיימות (פרויקט `finance-machine-a36e9`). אין תשתית חדשה.

---

## מה כבר בנוי (בצד הקוד)

- `functions/goalBot.js` — כל הלוגיקה (מבודד לגמרי מ-gate ההרשמה ומהיועצים).
- `functions/index.js` — מייצא את שלוש הפונקציות: `goalBotEvening`, `goalBotMidday`, `goalBotWebhook`.
- מודל: `claude-opus-4-8` עם structured outputs להבנת ההודעות.
- Firestore: אוסף `goalBot`, מסמך ליום לפי תאריך (`YYYY-MM-DD`), כל מטרה `{ text, done, doneAt }`.

**נשאר:** להקים את חשבון Meta, לאשר 2 תבניות, ולהגדיר 5 secrets ואז לפרוס.

---

## שלב 1 — חשבון Meta ואפליקציה (אורי עושה, קליקים בלבד)

1. היכנס ל-<https://developers.facebook.com/> והתחבר.
2. **My Apps → Create App → Business → Next.**
3. תן שם (למשל "Ori Goal Bot"), בחר את ה-Business Portfolio שלך → Create.
4. במסך האפליקציה, מצא **WhatsApp → Set up**. זה יוצר עבורך:
   - מספר טלפון בדיקה של Meta (הבוט ישלח ממנו — **אין צורך בסים שני**).
   - **Phone number ID** (מספר ארוך מתחת למספר הטלפון) → זה `WHATSAPP_PHONE_ID`.
   - **Temporary access token** (24 שעות, טוב לבדיקות ראשונות) → זה `WHATSAPP_TOKEN`.

## שלב 2 — הוסף את המספר הפרטי שלך כנמען

בטאב WhatsApp → **API Setup**, תחת "To", לחץ **Manage phone number list** והוסף את מספר הוואטסאפ הפרטי שלך. Meta תשלח קוד אימות בוואטסאפ — הזן אותו. בלי זה הבוט לא יכול לשלוח אליך במצב הבדיקה.

> המספר שלך בפורמט בינלאומי בלי `+` ובלי `0` מוביל, למשל `9725XXXXXXXX` → זה `WHATSAPP_TO`.

## שלב 3 — שתי התבניות (Message Templates)

וואטסאפ דורשת תבנית מאושרת לכל הודעה **יזומה**. ב-WhatsApp Manager → **Message Templates → Create template**:

**תבנית 1**
- Name: `goals_evening`
- Category: **Utility**
- Language: **Hebrew**
- Body:
  > היי אורי 👋 מה המטרות שלך למחר? כתוב לי אותן כרשימה ואשמור.

**תבנית 2**
- Name: `goals_midday`
- Category: **Utility**
- Language: **Hebrew**
- Body:
  > צהריים טובים 🙂 אילו מטרות השלמת עד עכשיו? כתוב לי מה סיימת ואסמן.

> תבניות Utility בעברית בדרך כלל מאושרות תוך דקות עד כמה שעות. חובה שהשמות יהיו בדיוק `goals_evening` ו-`goals_midday` (כך הקוד קורא להן).

## שלב 4 — מה לשלוח לי

אחרי שלבים 1–2, שלח לי:

1. `WHATSAPP_TOKEN` (ה-access token)
2. `WHATSAPP_PHONE_ID`
3. `WHATSAPP_TO` (המספר הפרטי שלך, ספרות בלבד)

אני אגדיר אותם + `WHATSAPP_VERIFY_TOKEN` (מחרוזת אקראית שאני בוחר) + `ANTHROPIC_API_KEY` כ-secrets מאובטחים, ואפרוס.

## שלב 5 — חיבור ה-Webhook (אחרי הפריסה, אני מדריך)

הפריסה תיתן כתובת ל-`goalBotWebhook`, למשל:
`https://us-central1-finance-machine-a36e9.cloudfunctions.net/goalBotWebhook`

ב-Meta: WhatsApp → **Configuration → Webhook → Edit**:
- **Callback URL** = הכתובת למעלה
- **Verify token** = ה-`WHATSAPP_VERIFY_TOKEN` שהגדרתי (אתן לך אותו)
- **Verify and Save**, ואז **Subscribe** ל-שדה **messages**.

---

## הגדרת ה-secrets (אני מריץ)

```bash
cd functions
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_ID
firebase functions:secrets:set WHATSAPP_TO
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase deploy --only functions:goalBotEvening,functions:goalBotMidday,functions:goalBotWebhook
```

> **חשוב:** פריסה כזו נוגעת בפרויקט Firebase החי (אותו פרויקט של ההרשמה). הפונקציות החדשות **מוסיפות** בלבד ולא נוגעות ב-gate ההרשמה או בפונקציות היועצים, אבל כל `firebase deploy` מרענן את כל הפונקציות — לכן פורסים רק אחרי אישור מפורש של אורי.

## הערות לעתיד

- **טוקן קבוע:** ה-token של 24 שעות טוב לבדיקה. לפרודקשן צריך **System User token** קבוע (Business Settings → System Users → Generate token עם הרשאת `whatsapp_business_messaging`). מחליפים את ה-secret בלי לגעת בקוד.
- **שעות:** 21:00 ו-13:00 (Asia/Jerusalem) מוגדרות ב-cron בתוך `goalBot.js` — קל לשנות.
- **שיפור עתידי:** להוסיף לתבנית הצהריים משתנה שמראה את רשימת המטרות של היום (דורש template עם פרמטר).
