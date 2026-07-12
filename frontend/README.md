# CRM - ממשק (Frontend)

אפליקציית React + TypeScript, בעברית מלאה (RTL), מחוברת למסד הנתונים ב-Supabase (`../supabase/schema.sql`).

## מה יש כרגע (שלב 1)

- התחברות עם אימייל + קוד אימות (OTP) - אין צורך בסיסמה.
- דשבורד עם סטטיסטיקות בסיסיות (סה"כ חברות, חברות שלי, אנשי קשר).
- רשימת חברות עם חיפוש לפי שם/ח"פ, והוספת חברה חדשה.
- כרטיס חברה מלא: כל השדות, אנשי קשר, היסטוריית התקשרויות.

מה שעוד לא בפנים (שלבים הבאים): יומן/משימות, יעדים, סידור עבודה שבועי, דוחות/יצוא, צ'אט, אינטגרציות, קונפטי.

## הרצה מקומית

```bash
cd frontend
npm install
cp .env.example .env.local
```

עורכים את `.env.local` וממלאים את `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY` - את שני הערכים האלה מוצאים ב-Supabase Dashboard תחת **Project Settings ← API**.

```bash
npm run dev
```

נפתח בכתובת `http://localhost:5173`.

## פריסה לאינטרנט (כדי שהצוות יוכל להתחבר)

הכי פשוט: [Vercel](https://vercel.com) (חינמי) - מתחברים עם GitHub, בוחרים את הריפו הזה, מגדירים ש-**Root Directory** הוא `frontend`, ומוסיפים את שני משתני הסביבה (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) בהגדרות הפרויקט שם. כל push לברנץ' הראשי יעדכן את האתר החי אוטומטית.
