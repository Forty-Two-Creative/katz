# כץ ✂️ — מקצר לינקים פנים-ארגוני

אפליקציה פשוטה לקיצור לינקים עם מעקב כניסות, בנויה ב-Next.js + Auth.js (כניסה עם Google) + Prisma + PostgreSQL, ומיועדת לפריסה ב-Vercel.

**יכולות:**
- ✂️ קיצור לינק ארוך לכתובת קצרה (`katz.wtf/abc1234`)
- 🎯 בניית קידוד קמפיין (פרמטרי UTM) — לא חובה
- 🔗 כתובת מותאמת אישית — לא חובה
- 🏷️ שיוך לקוח (`clientId` מתיקי) — מחבר לינק לשאר המערכות של 42
- 🔌 API ליצירת לינק ממערכת אחרת (`POST /api/links`)
- 📊 מעקב בסיסי: כמות כניסות, מקור (referer), מדינה, סוג מכשיר
- 🔐 כניסה עם Google (אפשר להגביל לדומיין הארגוני)
- 📤 שיתוף לינקים בלחיצה
- 👤 ניהול משתמשים לאדמין (`or@42creative.co.il`)

---

## הרצה מקומית (Local)

```bash
npm install
cp .env.example .env      # ומלאו את הערכים (ראו למטה)
npm run db:push           # יוצר את הטבלאות במסד הנתונים
npm run dev               # http://localhost:3000
```

---

## משתני סביבה (Environment Variables)

| משתנה | תיאור |
|---|---|
| `DATABASE_URL` | מחרוזת חיבור ל-PostgreSQL (השתמשו ב-Pooled URL ב-Vercel/Neon) |
| `AUTH_SECRET` | מחרוזת אקראית. צרו עם `npx auth secret` |
| `AUTH_TRUST_HOST` | `true` (חובה ב-Vercel) |
| `AUTH_GOOGLE_ID` | Client ID מ-Google Cloud |
| `AUTH_GOOGLE_SECRET` | Client Secret מ-Google Cloud |
| `ALLOWED_EMAIL_DOMAIN` | הגבלת כניסה לדומיין (לדוגמה `42creative.co.il`). השאירו ריק כדי לאפשר לכל אחד |
| `SUPER_ADMIN_EMAIL` | המייל שתמיד יהיה אדמין (ברירת מחדל: `or@42creative.co.il`) |
| `KATZ_API_TOKEN` | סוד משותף ל-`POST /api/links`. בלעדיו ה-endpoint מחזיר 503 |
| `KATZ_API_USER_EMAIL` | החשבון שמחזיק לינקים שנוצרו דרך ה-API (ברירת מחדל: `api@katz.service`) |

---

## הקמה ב-Vercel — שלב אחר שלב

### 1. מסד נתונים (PostgreSQL)
ב-Vercel: **Storage → Create Database → Postgres** (או [Neon](https://neon.tech)).
העתיקו את ה-`DATABASE_URL` (הגרסה ה-pooled).

### 2. Google OAuth
1. היכנסו ל-[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Create Credentials → OAuth client ID → Web application**.
3. תחת **Authorized redirect URIs** הוסיפו:
   ```
   https://<הדומיין-שלכם>.vercel.app/api/auth/callback/google
   ```
   (ולפיתוח מקומי: `http://localhost:3000/api/auth/callback/google`)
4. העתיקו את ה-Client ID וה-Client Secret.

### 3. פריסה
1. ב-Vercel: **Add New → Project**, וייבאו את הריפו `or-42creative/katz`.
2. הוסיפו את כל משתני הסביבה (מהטבלה למעלה) תחת **Settings → Environment Variables**.
3. **Deploy**.
4. אחרי הפריסה הראשונה, הריצו פעם אחת כדי ליצור את הטבלאות:
   ```bash
   # מקומית, עם ה-DATABASE_URL של הפרודקשן ב-.env
   npm run db:push
   ```
   (או הוסיפו את הצעד הזה ל-build pipeline).

### 4. דומיין מותאם
האפליקציה רצה על **https://katz.wtf**. ב-Vercel: **Settings → Domains** — הוסיפו `katz.wtf`,
והגדירו ב-DNS אצל רשם הדומיין את הרשומות ש-Vercel מציג (A record לאפקס / CNAME ל-www).

> ⚠️ אחרי שמוסיפים דומיין, עדכנו את ה-redirect URI ב-Google:
> `https://katz.wtf/api/auth/callback/google`
> וכדאי גם להגדיר ב-Vercel את משתנה הסביבה `NEXT_PUBLIC_SITE_URL=https://katz.wtf`.

---

## API — יצירת לינק ממערכת אחרת

מערכת אחרת של 42 (תיקי, הפורטל) יכולה לקצר לינק בלי משתמש ובלי דפדפן.

### אימות

כותרת בלבד:

```
Authorization: Bearer $KATZ_API_TOKEN
```

אין נפילה חזרה לסשן ואין טוקן ב-query string — מי שאין לו כותרת תקינה מקבל `401`.
אם `KATZ_API_TOKEN` לא מוגדר בכלל, ה-endpoint מחזיר `503` ולא יוצר שום דבר.

### בקשה

`POST /api/links`, גוף JSON:

| שדה | חובה | תיאור |
|---|---|---|
| `url` | ✅ | כתובת היעד. בלי `http://` או `https://` — נוסיף `https://` |
| `title` | — | שם פנימי ללינק |
| `slug` | — | כתובת מותאמת. ריק = נייצר אחת אקראית |
| `clientId` | — | `Client.id` מתיקי. מזהה בלבד, לא שם לקוח |
| `expiresAt` | — | תאריך תפוגה, ISO 8601 |
| `utm` | — | `{ source, medium, campaign, term, content }` (גם בשמות המלאים `utm_source` וכו׳) |

```bash
curl -X POST https://katz.wtf/api/links \
  -H "Authorization: Bearer $KATZ_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "url": "https://example.com/landing",
        "title": "קמפיין קיץ",
        "clientId": "cmh2k9f4x0000qa7b3n1d8z6v",
        "utm": { "source": "instagram", "medium": "social" }
      }'
```

### תשובה

`201` עם:

```json
{
  "id": "cmh3...",
  "slug": "k7m2q9x",
  "shortUrl": "https://katz.wtf/k7m2q9x"
}
```

שגיאות: `400` (גוף לא תקין / `url` חסר או פסול / `clientId` פסול / `expiresAt` פסול),
`401` (טוקן שגוי או חסר), `409` (ה-`slug` המבוקש תפוס), `503` (אין טוקן מוגדר בשרת).

### בעלות על הלינק

לינקים שנוצרים דרך ה-API שייכים לחשבון שירות (`KATZ_API_USER_EMAIL`) ולא לאדם —
מחיקת משתמש מוחקת בשרשור את כל הלינקים שלו, ולינק שתיקי יצרה לא צריך להישבר
כשמי שחיבר את האינטגרציה עוזב. החשבון הזה לא כתובת מייל אמיתית, ולכן אי אפשר
להתחבר כמוהו.

כדי שהלינקים האלה לא יהיו בלתי-נראים לחלוטין, **אדמין רואה אותם בדשבורד ובייצוא
ה-CSV** בנוסף ללינקים שלו ולאלה ששותפו איתו. לא שונה שום דבר אחר בהרשאות.

---

## שדרוג מסד הנתונים

השינוי היחיד בסכמה הוא הוספת העמודה `clientId` לטבלת `Link` (ואינדקס עליה) —
תוספתי בלבד, בלי `DROP` ובלי שינוי טיפוס של עמודה קיימת:

```bash
npm run db:push
```

לבדיקה מראש מה בדיוק ירוץ, בלי לגעת במסד:

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

---

## איך זה עובד

- כל לינק מקבל `slug` קצר (7 תווים) או כתובת מותאמת אישית.
- כניסה ל-`/<slug>` רושמת כניסה (referer, מדינה, מכשיר) ומפנה ליעד.
- נתוני המדינה/עיר מגיעים מ-headers של Vercel (`x-vercel-ip-country`) — עובדים רק בפרודקשן.
- האדמין (`SUPER_ADMIN_EMAIL`) רואה את כל המשתמשים ויכול למנות/להוריד מנהלים ולמחוק משתמשים.

## סטאק

Next.js 15 (App Router) · Auth.js v5 · Prisma 6 · PostgreSQL · Tailwind CSS v4
