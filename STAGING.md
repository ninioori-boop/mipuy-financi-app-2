# Staging Environment

זה ה-branch של staging — סביבת בדיקה זהה לפרודקשן.

## איך זה עובד

- **`main`** = פרודקשן. נפרס ל-`mipuy-financi-app-2.vercel.app` (ולדומיין הסופי כשיוקצה).
- **`staging`** = סביבת בדיקה. נפרסת ל-`mipuy-financi-app-2-git-staging-oris-projects-29e04a54.vercel.app`.

## תהליך פיתוח בטוח (אחרי שלב 0 הושלם)

1. כל שינוי מפותח על branch תכונה (feature branch).
2. ה-branch ממוזג ל-`staging` לבדיקה.
3. ה-deployment של staging נבדק ידנית.
4. רק אחרי אישור — `staging` ממוזג ל-`main` ועולה לפרודקשן.

## למה זה חשוב

10 לקוחות משלמים משתמשים במערכת ה-production. כל שינוי שמגיע ישירות ל-`main` עלול לפגוע בהם.
Staging נותן לנו "חזרה גנרלית" לפני שהשינוי מגיע ללקוחות.
