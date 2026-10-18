# אגו (CRM Ego) — דף ניהול לידים

דף לידים נפרד ללקוח "אגו" - גיליון Google Sheets + Apps Script משלו, בלי חפיפה
עם שום פרויקט אחר (ר' `templates/client-leads-page/BUILD-GUIDE.md` לתהליך
המלא ולמה שכבר ידוע מראש אצל כל פרויקט כזה).

## מה יש כאן, מעבר לתבנית הרגילה

**Webhook גנרי לסוכנת קולית** - בנוסף לכל מה שיש בדף לידים רגיל (וואטסאפ,
טפסים, סטטוסים), יש נקודת קצה ייעודית שמיועדת לסוכנת קולית חיצונית (לא
NLPearl - ספק אחר, טרם סופי) שתבצע שיחות ללידים ותדווח תוצאה בחזרה.

### כתובת ה-Webhook למסור לספק הסוכנת הקולית

אחרי הפריסה (ר' BUILD-GUIDE.md שלב 5), כתובת ה-`/exec` + הפרמטר הבא:

```
https://script.google.com/macros/s/XXXXXXXXXX/exec?source=voiceagent
```

**חשוב:** הפרמטר `?source=voiceagent` הוא מה שמזהה שזו קריאה מהסוכנת הקולית
(לא ליד חדש, לא תשובת וואטסאפ) - חייב להיות בכתובת שנמסרת לספק.

### מבנה הנתונים (data contract) שהסוכנת הקולית צריכה לשלוח

בקשת POST, גוף JSON, לכתובת שלמעלה. שמות השדות גמישים (ר' `agentFirst_` ב-
`Code.gs`) - כל אחד מהשמות הבאים מזוהה אוטומטית:

| מה זה | שמות שדה אפשריים | הערה |
|---|---|---|
| טלפון הליד (חובה) | `phone` / `phoneNumber` / `to` / `contactPhone` | לפי 9 הספרות האחרונות, כמו בכל שאר המערכת |
| תגית/תוצאה | `tag` / `tags` / `outcome` / `result` | הופכת להיות הסטטוס של הליד ישירות |
| סיכום שיחה | `summary` / `callSummary` / `notes` | מצטבר, לא דורס |
| תמלול | `transcript` / `conversation` / `turns` | מחרוזת, או מערך turns עם `role`/`content` |
| תאריך שיחה | `startTime` / `callDate` / `startedAt` | ISO date |
| משך שיחה (שניות) | `duration` / `durationSeconds` / `callDuration` | |
| רגש כללי | `sentiment` / `overallSentiment` | |
| קישור הקלטה | `recording` / `recordingUrl` / `audioUrl` | |

כשהספק הסופי ייבחר ויתברר מה השמות האמיתיים - מוסיפים אותם לרשימות
האליאסים ב-`agentFirst_(payload, [...])` בתוך `handleVoiceAgentWebhook_`
(`Code.gs`), לא כותבים מחדש.

### בדשבורד

כל ליד שיש לו נתוני שיחה (סיכום/תמלול/תגית) מקבל כפתור 🤖 קטן בסוף השורה
שפותח מודאל עם תמלול כבועות דיבור, סיכום, הקלטה לנגינה ישירה - אותו עיצוב
בדיוק שכבר הוכיח את עצמו עם פרלה ב-IBM BOB.

## שאר ההגדרות

זהה לכל פרויקט מהתבנית - ר' `templates/client-leads-page/BUILD-GUIDE.md`:
פריסה, Script Properties של אינפוריו (אותו חשבון כמו המערכת הראשית כברירת
מחדל), ואבחון "האם משהו מגיע ל-doPost" (טאב WebhookLog).
