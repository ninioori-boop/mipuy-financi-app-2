---
description: אישור מייל לכניסה (invite-only) — מוסיף אותו ל-allowlist ב-Firestore
argument-hint: someone@gmail.com
allowed-tools: Bash(npx tsx scripts/allow-email.ts:*)
---

המשתמש (אורי, יועץ פיננסי) רוצה לאשר כתובת מייל לכניסה לאפליקציה — invite-only.

המייל לאישור: **$ARGUMENTS**

בצע בדיוק את זה, ותו לא:

1. הרץ: `npx tsx scripts/allow-email.ts $ARGUMENTS`
   - הסקריפט מוסיף את המייל לקולקציית `allowlist` ב-Firestore (פרויקט finance-machine-a36e9) דרך firebase-admin, **אוטומטית באותיות קטנות** (כדי שיתאים ל-`request.auth.token.email` בכללים).
   - הוא קורא את `service-account-key.json` משורש הפרויקט (קיים, gitignored). שים לב: אל תזכיר את שם הקובץ בפקודת shell — הסקריפט קורא אותו פנימית.
2. אם הצליח (`✅ ... אושר/ה לגישה`) — אשר למשתמש בעברית, בקצרה, שהמייל אושר ויכול עכשיו להירשם (ייכנס לתוקף תוך כדקה).
3. אם נכשל — הסבר בקצרה מה השתבש (מפתח חסר / פורמט מייל לא תקין / שגיאת רשת) ואיך לתקן.

אל תעשה שום דבר נוסף — זו פעולה ממוקדת אחת.
