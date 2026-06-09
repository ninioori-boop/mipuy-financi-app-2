---
description: ביטול גישה — מסיר מייל מ-allowlist (invite-only) ב-Firestore
argument-hint: someone@gmail.com
allowed-tools: Bash(npx tsx scripts/revoke-email.ts:*)
---

המשתמש (אורי) רוצה לבטל גישה לכתובת מייל מהאפליקציה (invite-only).

המייל לביטול: **$ARGUMENTS**

בצע בדיוק את זה:

1. הרץ: `npx tsx scripts/revoke-email.ts $ARGUMENTS`
   - מוחק את המייל (אוטומטית באותיות קטנות) מקולקציית `allowlist` ב-Firestore. מרגע זה הגישה לנתונים נחסמת תוך כדקה — גם למשתמש פעיל.
   - קורא את `service-account-key.json` פנימית — אל תזכיר את שם הקובץ בפקודת shell.
2. אשר למשתמש בעברית בקצרה. ציין שאם רוצים גם למחוק את החשבון לגמרי — Authentication → Users → Delete.
3. אם נכשל — הסבר מה השתבש.

אל תעשה שום דבר נוסף — פעולה ממוקדת אחת.
