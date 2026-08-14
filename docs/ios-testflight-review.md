# TestFlight external testing — copy for App Store Connect

Paste-ready text for the **Test Information** and **App Review Information**
screens of `הכלכלן של הבית` (bundle `com.orimipuy.hakalkalan`). Written
2026-08-14, before the first Beta App Review submission.

Apple reviews the first build that goes to external testers. Everything below
exists to answer, in advance, the two questions that get iOS apps like this one
rejected: *"is this just a website in a wrapper?"* and *"how do we even use it?"*

---

## Test Information

### Beta App Description (shown to testers, Hebrew)

```
הכלכלן של הבית רושם כל תשלום ב-Apple Pay ישר לתיעוד ההוצאות שלך, מסווג
לקטגוריה, בלי שתקליד כלום.

אחרי ההתקנה יש שתי פעולות חד פעמיות: להתחבר עם המשתמש שלך, וליצור אוטומציה
אחת באפליקציית קיצורי דרך. מאותו רגע כל קנייה נרשמת לבד, ומגיעה התראה עם
הסכום ועם מצב התקציב.

האפליקציה בעברית ומיועדת למי שמנהל תקציב אישי או משפחתי.
```

### Feedback Email

```
ninioori@gmail.com
```

### What to Test (per build, Hebrew)

```
1. התחברות עם המשתמש שלך, ואישור ההתראות כשמתבקש.
2. יצירת האוטומציה: קיצורי דרך ← אוטומציה ← + ← ארנק ← עסקה ←
   כל הכרטיסים ← הפעל מיד ← הוסף פעולה ← "רישום הוצאה".
3. תשלום קטן ב-Apple Pay.

מה אמור לקרות: החיוב נרשם לבד, בלי שהטלפון מבקש ממך להקליד שום דבר,
ומגיעה התראה עם הסכום.

אם הטלפון פותח מקלדת ומבקש טקסט, זו התקלה שאנחנו בודקים. תדווח.
```

---

## App Review Information (English — the reviewer reads this)

### Sign-in required: yes

Account: `demo@orimipuy.com` — the same review login already used for Google
Play. **The password is deliberately not written here**, so this file stays safe
to commit; take it from the password manager and type it straight into App Store
Connect.

### Notes

```
WHAT THIS APP IS
A personal budgeting app used by a financial coach and their clients in Israel.
The interface is Hebrew and right-to-left.

THE NATIVE FEATURE, AND HOW TO TEST IT WITHOUT SPENDING MONEY
The point of this app is that it records purchases by itself. It exposes an
App Intent named "רישום הוצאה" (Log Expense) that the user attaches to a Wallet
transaction automation, so every Apple Pay charge is logged automatically. The
intent runs in the background with the phone locked, posts the charge to our
server, and posts a local notification with the amount and the budget status.

You do not need to make a real payment to test it:

  1. Sign in with the account above.
  2. Open Shortcuts, create any shortcut, and add the action "רישום הוצאה"
     (it appears under this app).
  3. Put sample text in its single field, for example:  Cafe Aroma 34.00
  4. Run the shortcut. A notification appears confirming the expense was
     recorded, and the entry shows up in the app's expense screen.

The same action is what appears in the Wallet-transaction automation picker
(Shortcuts > Automation > Wallet > Transaction), which is the real-world flow.

WHY PART OF THE UI IS WEB CONTENT
The expense screen is rendered from our web app so a client sees exactly the
same live financial data on the phone and on the desktop, with one source of
truth. It is not the whole app. The native parts are: the onboarding and
sign-in flow, the notification permission flow, the App Intent above, local
notifications with time-sensitive alerts for budget warnings, a settings
screen, and a built-in guide that walks the user through creating the Wallet
automation.

PERMISSIONS
Notifications: the app tells the user that a charge was recorded and whether it
puts them over budget. Budget warnings are sent as time-sensitive so they are
not held back by Focus, which is the point of an alert about money.

CONTACT
Or Ninio, ninioori@gmail.com
```

---

## Two gaps to close before submitting

1. **There is no privacy policy page.** External testing and the App Store both
   require a URL. Nothing exists at `app.orimipuy.com/privacy` today. It has to
   state what is collected (expenses, income, balances), that it is stored in
   Firebase, that it is never sold, and how to delete an account (the app has
   full self-service deletion already — see `project_account_deletion`).

2. **`demo@orimipuy.com` is empty.** It was created for Google Play's app-access
   review and has no data in it. A reviewer signing in sees blank screens and
   may read that as an incomplete app. Seed it with a month of plausible
   expenses, income and a budget before submitting.
