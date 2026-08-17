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

A 25-SECOND VIDEO OF THE SETUP
https://app.orimipuy.com/ios-setup.mp4
Silent screen recording of the whole flow on a real device: import the shortcut,
create the Wallet automation, choose it, done. Worth watching first — it is
faster than reading the rest of this note.

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

## The two gaps, both closed 2026-08-15

1. **Privacy policy.** `https://app.orimipuy.com/privacy` is live (200) and its
   section 9 now covers the iPhone explicitly: the app reads no notifications,
   has no Wallet access, generates its notifications on-device, and deleting the
   Shortcuts automation stops capture. That URL goes in the Test Information
   screen and in the App Store listing.

2. **`demo@orimipuy.com`.** Seeded surgically (32 expense-log entries across a
   month, 8 budgets), so a reviewer signing in lands on a populated screen
   instead of a blank one. Everything else in the document was left untouched
   and verified afterwards.

## Which build to submit

**1.0.0 (19)** — it is the first build with the floating settings gear removed;
in (18) the gear sits on top of the web page's own menu button, which a reviewer
would reasonably report as a layout defect.
