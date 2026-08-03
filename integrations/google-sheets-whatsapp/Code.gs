/**
 * אינטגרציה: Google Sheets <-> וואטסאפ (InforU) + שיחות קוליות (NLPearl).
 *
 * מודל רב-קמפיינים: כל טאב (גיליון) שיש בעמודת הכותרת שלו "טלפון נייד"
 * נחשב קמפיין נפרד. מספר התבנית / מזהה הסוכנת של הטאב נלקח משורה 2
 * (השורה הראשונה עם נתונים) וחל על כל שאר השורות בטאב, אלא אם שורה
 * ספציפית מגדירה ערך אחר משלה.
 * להוספת קמפיין חדש: לשכפל טאב, לנקות את שורות הנתונים, למלא בשורה 2
 * את מספר התבנית/מזהה הקמפיין הרצויים, ולהוסיף אנשי קשר - בלי לגעת בקוד.
 *
 * התקנה:
 * 1. Extensions > Apps Script, להדביק את הקובץ הזה בתור Code.gs.
 * 2. Project Settings > Script Properties, להוסיף:
 *      INFORU_USERNAME    = שם המשתמש של אינפוריו
 *      INFORU_TOKEN       = הטוקן של אינפוריו
 *      NLPEARL_ACCOUNT_ID = מזהה החשבון ב-NLPearl (מתוך platform.nlpearl.ai/app/settings/api)
 *      NLPEARL_SECRET_KEY = מפתח ה-API הסודי של NLPearl, מאותו עמוד הגדרות
 *      GEMINI_API_KEY     = מפתח API של Google Gemini (מ-aistudio.google.com),
 *                           לסיכום AI של שיחה עם ליד מהדשבורד - אופציונלי,
 *                           נדרש רק אם משתמשים בכפתור "✨ סיכום AI"
 * 3. להריץ sendMessages / startCalls (או לחבר טריגר זמן) כדי לעבד כל שורה
 *    שעדיין אין לה סטטוס, בכל טאבי הקמפיינים. אפשר גם להשתמש בתפריט
 *    "קמפיינים" בגיליון כדי להריץ טאב בודד בלבד.
 * 4. Deploy > Manage deployments > Web app: Execute as "Me", Who has access "Anyone"
 *    (לא "Anyone with Google account" - לשרתים חיצוניים אין חשבון גוגל).
 *    את כתובת ה-/exec שמתקבלת (או כתובת ה-StableRelay שמולה) לשלוח גם
 *    לאינפוריו כ-webhook לתשובות, וגם ל-NLPearl כ-Lead Webhook וכ-Call Webhook
 *    (הגדרות הסוכנת > Overview > Webhooks).
 *
 * כותרות עמודות נדרשות בכל טאב קמפיין: טלפון נייד, שם פרטי, מספר תבנית,
 * סטטוס דיוור (שם ישן שעדיין נתמך: "סטטוס"), תשובת איש קשר, תאריך תשובה,
 * מזהה קמפיין, סטטוס שיחה, מזהה ליד NLPearl, סיכום שיחה (שם ישן שעדיין
 * נתמך: "תוצאות שיחה").
 * עמודות אופציונליות שנוצרות לבד אוטומטית בגיליון בפעם הראשונה שהן
 * נדרשות בפועל (אין צורך להוסיף אותן ידנית מראש): סטטוס איש קשר (עמודה
 * מובילה אחת - מתחילה מלחיצה אמיתית על כפתור תגובה בוואטסאפ, אבל ניתנת
 * לדריסה חופשית בכל עת ע"י הצוות מהדשבורד), תאריך שיחה, הערות משתמש.
 */

// --- אינפוריו (וואטסאפ) ---
const INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';
const DEFAULT_TEMPLATE_ID = '267627';

const PHONE_HEADER = 'טלפון נייד';
const NAME_HEADER = 'שם פרטי';
const COMPANY_HEADER = 'שם חברה';
const TITLE_HEADER = 'תפקיד';
const EMAIL_HEADER = 'אימייל';
const SOURCE_HEADER = 'מקור הליד';
const TEMPLATE_HEADER = 'מספר תבנית';
const STATUS_HEADER = 'סטטוס דיוור';
const STATUS_HEADER_LEGACY = 'סטטוס'; // שם ישן - טאבים שטרם שונו ידנית
const REPLY_HEADER = 'תשובת איש קשר';
const REPLY_HEADER_LEGACY = 'תשובת לקוח'; // שם ישן - טאבים שטרם שונו ידנית
const FIRST_REPLY_HEADER = 'סטטוס איש קשר';
const REPLY_DATE_HEADER = 'תאריך תשובה';
const SENT_STATUS = 'נשלח וואטסאפ';
const APPROVED_STATUS = 'מאושר לשליחה';

// --- תזמון שליחה ---
// שני סטטוסים נפרדים במכוון, כדי שהסטטוס עצמו יגיד מה יקרה ולא נצטרך
// לנחש לפי אם תא התאריך ריק:
//   "מאושר לשליחה"    - יוצא בהרצה ידנית מהתפריט. בדיוק ההתנהגות הקיימת.
//   "מתוזמן לשליחה"   - יוצא לבד כשמגיע הזמן שבעמודת SCHEDULE_HEADER,
//                       וההרצה הידנית **מדלגת** עליו כדי שלא ייצא בטעות מוקדם.
// לשיחות פרלה יש סטטוס תזמון נפרד ("מתוזמן לשיחה") שמשתמש **באותה**
// עמודת תאריך. שני סטטוסים ולא אחד - אחרת שורה שתוזמנה לוואטסאפ הייתה
// נתפסת גם ע"י סריקת השיחות ואותו איש קשר היה מקבל גם הודעה וגם שיחה.
const SCHEDULED_STATUS = 'מתוזמן לשליחה';
const SCHEDULED_CALL_STATUS = 'מתוזמן לשיחה';
const SCHEDULE_HEADER = 'תאריך ושעת שליחה';
const SCHEDULE_TRIGGER_FN_ = 'runScheduledSends';
const SCHEDULE_INTERVAL_MINUTES_ = 15;

// --- NLPearl (שיחות קוליות) ---
const NLPEARL_API_BASE = 'https://api.nlpearl.ai/v2/Outbound/';
const DEFAULT_OUTBOUND_ID = '6a27be5ae83373643a10ae34'; // מזהה ה-Pearl (הפרמטר שב-v2), לא מזהה קמפיין ה-Outbound

const CAMPAIGN_HEADER = 'מזהה קמפיין';
const CALL_STATUS_HEADER = 'סטטוס שיחה';
const CALL_LEAD_ID_HEADER = 'מזהה ליד NLPearl';
const CALL_RESULT_HEADER = 'סיכום שיחה';
const CALL_RESULT_HEADER_LEGACY = 'תוצאות שיחה'; // שם ישן - טאבים שטרם שונו ידנית
const CALL_FIRST_RESULT_HEADER = 'תוצאה ראשונית (שיחה)';
const CALL_DATE_HEADER = 'תאריך שיחה';
const CALL_SENT_STATUS = 'שיחה נשלחה';

// --- CRM פנימי (הערות הצוות; הסטטוס הידני משותף עם FIRST_REPLY_HEADER) ---
// יומן הערות ידניות של הצוות בלבד - נפרד מ"תשובת איש קשר" (שיחת
// הוואטסאפ עם הבוט). מוצגת בדשבורד ובאקסל בתור "הערות מיטוב" (התווית
// בלבד - שם העמודה בגיליון לא השתנה).
const USER_NOTES_HEADER = 'הערות משתמש';
const TEAM_USERS_ = ['מזי', 'טליה'];

// --- הקצאת לידים לנציגות ---
// טליה ומזי הן אדמין ועובדות מול הדשבורד הראשי. הנציגות מקבלות דף נפרד
// (?rep=<קוד>) שמציג **רק** את הלידים שהוקצו להן.
const REPS_SHEET_NAME = 'נציגות';
const ASSIGN_SHEET_NAME = 'הקצאות';
const DEFAULT_REPS_ = ['חגית', 'שירלי', 'עדנה', 'פינצ\'י'];

// הסטטוסים שנציגה יכולה לבחור כשהיא מסמנת "סיימתי לטפל". ארבעה בלבד -
// כדי שזו תהיה לחיצה אחת בלי גלילה. "אחר..." פותח את הרשימה המלאה.
const REP_QUICK_STATUSES_ = ['תואמה פגישה', 'בתהליך', 'בתהליך עתידי', 'לא מעוניין'];
// הסטטוס שמפעיל קונפטי אצל הנציגה (השאר מקבלים אנימציית לבבות).
const REP_CELEBRATE_STATUS_ = 'תואמה פגישה';

// עמודות טאב "הקצאות" - הסדר קבוע, והקריאה תמיד לפי שם הכותרת.
const ASSIGN_HEADERS_ = [
  'מזהה הקצאה', 'תאריך הקצאה', 'נציגה', 'קמפיין', 'טלפון נייד',
  'שם חברה', 'איש קשר', 'תפקיד', 'אימייל', 'ערוץ', 'תיעוד בעת ההעברה',
  'טופל', 'סטטוס שסומן', 'הערת נציגה', 'תאריך טיפול'
];

// טאבים שהם עזר/לוג בלבד, לעולם לא נחשבים קמפיין גם אם במקרה יש בהם
// עמודה שנראית כמו טלפון נייד.
const STATUS_COLORS_SHEET_NAME = 'צבעי סטטוס';
const LEGEND_SHEET_NAME_ = 'מקרא';
// רשימת הסטטוסים הסגורה שהלקוחה שולטת בה - "סטטוס איש קשר" (ידני +
// כפתורי וואטסאפ) חייב להיות אחד מהערכים כאן; "סטטוס שיחה" (פרלה,
// ישיר או מזוקק ב-AI) מתעגל לערך הכי קרוב מהרשימה הזו (ר' matchCallStatus_).
const STATUS_LIST_SHEET_NAME = 'רשימת סטטוסים';
const NON_CAMPAIGN_SHEETS_ = ['WebhookLog', 'NLPearlCampaigns', STATUS_COLORS_SHEET_NAME,
  LEGEND_SHEET_NAME_, STATUS_LIST_SHEET_NAME, REPS_SHEET_NAME, ASSIGN_SHEET_NAME];

// רשימת הפתיחה (זרע) לטאב "רשימת סטטוסים" - לפי בקשת הלקוחה במפורש.
// נכתבת לגיליון רק פעם אחת, ע"י setupStatusListSheet() (ר' למטה) - אחרי
// מכן הלקוחה שולטת ברשימה ישירות מהגיליון, בלי צורך בשינוי קוד.
const DEFAULT_STATUS_LIST_ = [
  'שגוי', 'אין פרטי התקשרות', 'לא רלוונטי', 'לא מעוניין', 'לא לפנות', 'כפול', 'כללי', 'חברה נסגרה',
  'פגישה פרונטלית', 'פגישה מקוונת', 'פגישה למעקב', 'פגישה לחיוב', 'פגישה לא לחיוב', 'פגישה התקיימה', 'פגישה בוטלה', 'לא מאשר הגעה',
  'בתהליך', 'בתהליך עתידי', 'בתהליך מיידי', 'נשלח מייל', 'נשלח וואטסאפ', 'ממתין להקצאה',
  'נרשם ע"י מיטוב', 'נרשם לבד', 'ירשם לבד', 'נסלק', 'נסגרה עסקה', 'נכח בכנס', 'לא נכח בכנס',
  'ליד לא לחיוב', 'ליד הועבר ללקוח',
  SCHEDULED_STATUS, SCHEDULED_CALL_STATUS
];

// --- Wix (לידים מטופס באתר) ---
// שם הטאב שאליו נכנסים לידים חדשים מ-Wix - זהו טאב הקמפיין הקיים
// "AI2NADLAN אודי גת" (בבקשת הלקוחה, כדי שהלידים מהאתר יצטרפו ישירות
// לקמפיין הפעיל ולא ישבו בטאב נפרד). חייב להיות טאב קמפיין רגיל
// (עם עמודת "טלפון נייד") בשם הזה בדיוק.
const WIX_LEADS_SHEET_NAME = 'AI2NADLAN אודי גת';
const WIX_SOURCE_LABEL = 'אתר (Wix)';

function getInforuAuthHeader_() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('INFORU_USERNAME');
  const token = props.getProperty('INFORU_TOKEN');
  return 'Basic ' + Utilities.base64Encode(username + ':' + token);
}

function getNlpearlAuthHeader_() {
  const props = PropertiesService.getScriptProperties();
  const accountId = props.getProperty('NLPEARL_ACCOUNT_ID');
  const secretKey = props.getProperty('NLPEARL_SECRET_KEY');
  return 'Bearer ' + accountId + ':' + secretKey;
}

/**
 * תפריט "קמפיינים" מותאם אישית - כדי שאפשר יהיה להריץ טאב בודד במקום
 * תמיד להריץ את כל טאבי הקמפיינים ביחד. מופיע אוטומטית בכל פתיחה של הגיליון.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('קמפיינים')
    .addItem('📤 שלח הודעות וואטסאפ - לטאב הנוכחי בלבד', 'sendMessagesActiveTab')
    .addItem('📞 התחל שיחות - לטאב הנוכחי בלבד', 'startCallsActiveTab')
    .addSeparator()
    .addItem('📤 שלח הודעות וואטסאפ - לכל הקמפיינים', 'sendMessages')
    .addItem('📞 התחל שיחות - לכל הקמפיינים', 'startCalls')
    .addToUi();
}

/**
 * קוראת **רק את שורת הכותרות** של הטאב. חשוב מאוד לביצועים: getDataRange()
 * מושך את כל תוכן הגיליון (מאות שורות עם סיכומי שיחות ארוכים) גם כשצריך רק
 * את שורה 1. כשזה נעשה לכל טאב בנפרד - בכל טעינת דשבורד ובכל וובהוק - זה
 * מגיע למגבלת הזמן של Apps Script ומחזיר "שגיאת שרת" גנרית בצד הלקוח.
 */
function headerRow_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
}

function isCampaignSheet_(sheet) {
  if (NON_CAMPAIGN_SHEETS_.indexOf(sheet.getName()) !== -1) return false;
  const headers = headerRow_(sheet);
  return findColumnNormalized_(headers, PHONE_HEADER) !== -1;
}

function sendMessagesActiveTab() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (!isCampaignSheet_(sheet)) {
    ui.alert('הטאב הנוכחי ("' + sheet.getName() + '") אינו טאב קמפיין - חסרה בו עמודת "טלפון נייד". עברי לטאב הקמפיין הרצוי ונסי שוב.');
    return;
  }
  sendMessagesInSheet_(sheet);
  ui.alert('הודעות וואטסאפ נשלחו לטאב "' + sheet.getName() + '".');
}

function startCallsActiveTab() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (!isCampaignSheet_(sheet)) {
    ui.alert('הטאב הנוכחי ("' + sheet.getName() + '") אינו טאב קמפיין - חסרה בו עמודת "טלפון נייד". עברי לטאב הקמפיין הרצוי ונסי שוב.');
    return;
  }
  startCallsInSheet_(sheet);
  ui.alert('שיחות הותחלו לטאב "' + sheet.getName() + '".');
}

/**
 * כל טאב שבשורת הכותרות שלו יש עמודת "טלפון נייד" נחשב טאב קמפיין.
 */
function getCampaignSheets_(ss) {
  return ss.getSheets().filter(isCampaignSheet_);
}

/**
 * משווה כותרות "ברכות" - בלי תלות ברווחים כפולים/רווח בקצה/גרשיים/
 * רישיות (בדיוק כמו normalizeLabel_ למטה, המשמש כבר להתאמת שדות Wix).
 * חשוב כי כותרת שנוצרה/הוקלדה ידנית עלולה להכיל רווח נוסף בלתי-נראה
 * שישבור התאמה מדויקת (indexOf רגיל) ויגרום לקוד "לא למצוא" עמודה
 * שקיימת בפועל, וליצור בטעות עמודה כפולה חדשה לצידה.
 */
function findColumnNormalized_(headers, name) {
  const target = normalizeLabel_(name);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeLabel_(headers[i]) === target) return i;
  }
  return -1;
}

/**
 * מוצאת עמודה לפי כותרת - וגם לפי שם ישן חלופי (legacy), למי שעדיין לא
 * שינתה ידנית את הכותרת בטאב הזה לשם החדש. כך שני השמות עובדים בכל טאב
 * בלי תלות אם היא כבר שינתה שם או לא.
 */
function findHeaderIndex_(headers, primary, legacy) {
  const idx = findColumnNormalized_(headers, primary);
  if (idx !== -1) return idx;
  return legacy ? findColumnNormalized_(headers, legacy) : -1;
}

/**
 * מוודאת שלטאב יש עמודה עם הכותרת הזו - ואם לא, מוסיפה אותה בעצמה
 * בעמודה הבאה הפנויה (בסוף שורת הכותרות) ומחזירה את האינדקס שלה
 * (0-based, כמו headers.indexOf). כך עמודות אופציונליות (סטטוס איש
 * קשר, סטטוס/הערות משתמש) נוצרות לבד ברגע שהן נדרשות בפועל בפעם
 * הראשונה - אין צורך להוסיף אותן ידנית מראש בשום טאב.
 * הפרמטר headers מתעדכן במקום (push) כדי שקריאות נוספות לאותה מערך
 * באותה הרצה יראו את העמודה החדשה ולא יתנגשו איתה.
 */
function ensureColumn_(sheet, headers, headerName) {
  const idx = findColumnNormalized_(headers, headerName);
  if (idx !== -1) return idx;
  const newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue(headerName);
  headers.push(headerName);
  return newCol - 1;
}

/**
 * משווה מספרי טלפון לפי 9 הספרות האחרונות, כך ש-"052-7810099",
 * "0527810099" ו-"+972527810099" (אותו מספר ישראלי בפורמטים שונים)
 * מזוהים כזהים.
 */
function phoneSuffix_(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-9);
}

/**
 * ממירה מספר טלפון גולמי (בכל פורמט שהלקוח שלח - עם/בלי מקף, עם/בלי
 * 0 מוביל, עם/בלי 972+) לפורמט אחיד קבוע: "05X-XXXXXXX" - כדי שפרלה
 * תמיד תוכל לחייג (וגם כדי שהעמודה תיראה אחידה בגיליון עצמו). מזהה רק
 * מספרים ישראליים סבירים (9-10 ספרות מקומיות, או 972+ עם 9 ספרות אחריו) -
 * מחזירה null אם הפורמט לא מזוהה בבירור, כדי לא לנחש/לשבש מספר תקין.
 */
function normalizePhoneValue_(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let local10 = null;
  if (digits.length === 10 && digits.charAt(0) === '0') {
    local10 = digits;
  } else if (digits.length === 9 && digits.charAt(0) !== '0') {
    local10 = '0' + digits;
  } else if (digits.length === 12 && digits.indexOf('972') === 0) {
    local10 = '0' + digits.slice(3);
  } else if (digits.length === 13 && digits.indexOf('9720') === 0) {
    local10 = '0' + digits.slice(4);
  } else {
    return null;
  }
  return local10.slice(0, 3) + '-' + local10.slice(3);
}

/**
 * כלי עזר חד-פעמי: מציג את כל קמפייני ה-Outbound של NLPearl (עם ה-
 * outboundId האמיתי שלהם, שונה ממזהה ה-Pearl/הסוכנת) בטאב "NLPearlCampaigns",
 * כי מזהה ה-Pearl שמופיע בכתובת ה-URL בפלטפורמה הוא לא ה-outboundId
 * שממשק Make Call מצפה לו.
 */
function listOutboundCampaigns() {
  const response = UrlFetchApp.fetch('https://api.nlpearl.ai/v1/Outbound', {
    method: 'get',
    headers: { Authorization: getNlpearlAuthHeader_() },
    muteHttpExceptions: true
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('NLPearlCampaigns') || ss.insertSheet('NLPearlCampaigns');
  sheet.clear();
  sheet.appendRow(['raw response']);
  sheet.appendRow([response.getContentText()]);
}

/**
 * כלי עזר חד-פעמי: בודק את הסטטוס האמיתי של שיחה ספציפית ישירות מול NLPearl.
 * להדביק מזהה שיחה בתוך CALL_ID_TO_CHECK לפני ההרצה.
 */
function checkCallStatus() {
  const CALL_ID_TO_CHECK = '6a53311af56b3a971e406b73';

  const response = UrlFetchApp.fetch('https://api.nlpearl.ai/v2/Call/' + CALL_ID_TO_CHECK, {
    method: 'get',
    headers: { Authorization: getNlpearlAuthHeader_() },
    muteHttpExceptions: true
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('NLPearlCampaigns') || ss.insertSheet('NLPearlCampaigns');
  sheet.appendRow(['call status check', response.getContentText()]);
}

/**
 * שומר ב-Script Properties את התאריך שבו קמפיין (טאב) הופעל לראשונה
 * (שליחת הודעות או התחלת שיחות) - לצורך "כמה ימים הקמפיין פעיל" בדשבורד.
 * לא דורס תאריך שכבר נשמר.
 */
function recordCampaignStart_(sheetName) {
  const props = PropertiesService.getScriptProperties();
  const key = 'CAMPAIGN_START_' + sheetName;
  if (!props.getProperty(key)) {
    props.setProperty(key, new Date().toISOString());
  }
}

/**
 * שומר לאיזה טאב-קמפיין נשלחה לאחרונה הודעה/שיחה למספר טלפון נתון.
 * חיוני כי אותו מספר טלפון יכול (למשל למטרות בדיקה, או אם אותו לקוח
 * אמיתי נמצא בכמה קמפיינים) להופיע בכמה טאבים במקביל - בלי המיפוי הזה,
 * webhook של תשובה נכנסת לא היה יודע לאיזה טאב היא שייכת, ועלול לעדכן
 * טאב לא-קשור רק כי גם בו יש שורה עם אותו מספר.
 */
function recordLastContact_(phone, sheetName) {
  const suffix = phoneSuffix_(phone);
  if (!suffix) return;
  PropertiesService.getScriptProperties().setProperty('LAST_CONTACT_' + suffix, sheetName);
}

/**
 * מחזיר את טאב הקמפיין שאליו נשלחה לאחרונה הודעה/שיחה למספר הטלפון הזה
 * (ראו recordLastContact_), אם קיים ותקין - אחרת null.
 */
function lastContactSheet_(ss, phoneSuffixValue) {
  const sheetName = PropertiesService.getScriptProperties().getProperty('LAST_CONTACT_' + phoneSuffixValue);
  if (!sheetName) return null;
  const sheet = ss.getSheetByName(sheetName);
  return (sheet && isCampaignSheet_(sheet)) ? sheet : null;
}

/**
 * סופרת אירועי פעילות (תשובת וואטסאפ / תוצאת שיחה) ביום הנוכחי, לכל
 * טאב קמפיין - לצורך גרף המגמה של 7 הימים האחרונים בדשבורד. נשמר
 * ב-Script Properties כ-JSON קטן {"yyyy-MM-dd": count, ...}, עם ניקוי
 * ימים ישנים מ-30 יום ומעלה כדי שלא יתפח בלי גבול.
 */
function recordDailyActivity_(sheetName) {
  const props = PropertiesService.getScriptProperties();
  const key = 'DAILY_ACTIVITY_' + sheetName;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let data = {};
  try { data = JSON.parse(props.getProperty(key) || '{}'); } catch (err) { data = {}; }
  data[today] = (data[today] || 0) + 1;
  const days = Object.keys(data).sort();
  if (days.length > 30) {
    days.slice(0, days.length - 30).forEach(function (d) { delete data[d]; });
  }
  props.setProperty(key, JSON.stringify(data));
}

/**
 * מחזירה מערך של 7 הימים האחרונים (כולל היום) עם כמות הפעילות של כל
 * יום, לצורך גרף המגמה בדשבורד. ימים שעדיין לא נצברה בהם פעילות מאז
 * שהמעקב הזה נוסף יופיעו כ-0 - זה נתון אמיתי, לא מדומה.
 */
function dailyActivityTrend_(sheetName) {
  const props = PropertiesService.getScriptProperties();
  const key = 'DAILY_ACTIVITY_' + sheetName;
  let data = {};
  try { data = JSON.parse(props.getProperty(key) || '{}'); } catch (err) { data = {}; }

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const label = Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM');
    trend.push({ date: dayKey, label: label, count: data[dayKey] || 0 });
  }
  return trend;
}

/**
 * קוראת את תא "תאריך ושעת שליחה" ומחזירה Date או null.
 * התא עשוי לחזור כאובייקט Date (כשהתא מעוצב כתאריך) או כמחרוזת
 * (כשהוא מעוצב כטקסט או הודבק) - שני המקרים נתמכים, אחרת תזמון היה
 * "נעלם" בשקט לפי עיצוב התא, וזה בדיוק סוג הכשל שאסור שיקרה כאן.
 * מחרוזת ריקה/לא מזוהה מחזירה null - לעולם לא "היום ב-00:00".
 */
function parseScheduleValue_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value;
  }

  // תא שעוצב בטעות כ"משך זמן" ([h]:mm:ss) במקום כתאריך: הערך שמאחורי
  // הקלעים תקין (מספר סידורי של שיטס - ימים מאז 30/12/1899) והתצוגה
  // היא שמטעה - "1109654:30:00" הוא בדיוק 01/08/2026 09:30. קרה בפועל
  // אצל הלקוחה, ולכן מקבלים גם מספר ולא רק תאריך/טקסט.
  if (typeof value === 'number' && isFinite(value)) {
    return serialToDate_(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  // אותו מקרה, כשהתא חוזר כמחרוזת של משך זמן: "1109654:30:00".
  const duration = text.match(/^(\d{3,})[:.](\d{1,2})(?:[:.](\d{1,2}))?/);
  if (duration) {
    const hours = Number(duration[1]) + Number(duration[2]) / 60 + Number(duration[3] || 0) / 3600;
    return serialToDate_(hours / 24);
  }

  const dmy = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]),
      Number(dmy[4] || 0), Number(dmy[5] || 0));
    return isNaN(d.getTime()) ? null : d;
  }

  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{2}))?/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]),
      Number(ymd[4] || 0), Number(ymd[5] || 0));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * ממירה מספר סידורי של Google Sheets (ימים מאז 30/12/1899) ל-Date.
 * מוגבלת לטווח 1990-2100 כדי שמספר קטן שנכתב בטעות בעמודה (למשל "5")
 * לא יתפרש כתאריך אמיתי ויגרום לשליחה לא צפויה - מחוץ לטווח מחזירה
 * null, וזה בדיוק ההתנהגות הבטוחה (השורה פשוט לא תישלח ותסומן בדשבורד).
 */
function serialToDate_(serial) {
  const SERIAL_1990 = 32874;   // 01/01/1990
  const SERIAL_2100 = 73051;   // 01/01/2100
  if (!(serial > SERIAL_1990 && serial < SERIAL_2100)) return null;

  const days = Math.floor(serial);
  const seconds = Math.round((serial - days) * 86400);
  const d = new Date(1899, 11, 30);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  d.setSeconds(seconds);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * מחליטה אם שורה נשלחת בהרצה הנוכחית:
 *   mode='manual'    - הרצה ידנית מהתפריט. רק "מאושר לשליחה", בדיוק כמו
 *                      עד היום. שורה "מתוזמן לשליחה" **תמיד** מדולגת, גם
 *                      אם זמנה כבר עבר - בקשה מפורשת של הלקוחה, כדי
 *                      שהרצה ידנית לא תוציא מוקדם משהו שתוזמן לעתיד.
 *   mode='scheduled' - הטריגר שרץ ברקע. רק "מתוזמן לשליחה" שיש לו תאריך
 *                      שכבר הגיע. בלי תאריך לא יוצא לעולם - במכוון, כדי
 *                      ששורה שסומנה בטעות לא תישלח בלי שנקבע לה זמן.
 */
function shouldSendNow_(status, scheduleAt, mode, now) {
  const normalized = normalizeLabel_(status);
  if (mode === 'scheduled') {
    if (normalized !== normalizeLabel_(SCHEDULED_STATUS)) return false;
    return !!scheduleAt && scheduleAt.getTime() <= now.getTime();
  }
  return normalized === normalizeLabel_(APPROVED_STATUS);
}

function sendMessages() {
  getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(function (sheet) {
    sendMessagesInSheet_(sheet);
  });
}

function sendMessagesInSheet_(sheet, mode) {
  const runMode = mode || 'manual';
  const now = new Date();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  const nameCol = findColumnNormalized_(headers, NAME_HEADER);
  const statusCol = findHeaderIndex_(headers, STATUS_HEADER, STATUS_HEADER_LEGACY);
  const templateCol = findColumnNormalized_(headers, TEMPLATE_HEADER);
  // עמודת התזמון אופציונלית לגמרי - טאב בלי העמודה הזו פשוט עובד כמו
  // שעבד עד היום, בלי שגיאות ובלי שינוי התנהגות.
  const scheduleCol = findColumnNormalized_(headers, SCHEDULE_HEADER);

  if (phoneCol === -1 || nameCol === -1 || statusCol === -1) return 0;

  recordCampaignStart_(sheet.getName());

  // ברירת מחדל לכל הטאב: מה שכתוב בשורה 2 (השורה הראשונה עם נתונים) של הטאב הזה.
  const sheetTemplateId = (templateCol !== -1 && data[1] && data[1][templateCol])
    ? String(data[1][templateCol]) : DEFAULT_TEMPLATE_ID;

  let sent = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).replace(/\D/g, '');
    const name = row[nameCol];
    const status = String(row[statusCol] || '').trim();
    const scheduleAt = scheduleCol !== -1 ? parseScheduleValue_(row[scheduleCol]) : null;
    const templateId = (templateCol !== -1 && row[templateCol]) ? String(row[templateCol]) : sheetTemplateId;
    const rowIndex = i + 1;

    // שולחים רק לשורה שסומנה ידנית כ"מאושר לשליחה" - כדי לאפשר להעלות
    // רשימה שלמה (למשל 300 אנשי קשר) ולשלוח בפעימות נשלטות, על ידי
    // שינוי הסטטוס רק לחלק מהשורות בכל פעם. ההשוואה (בתוך shouldSendNow_)
    // עוברת דרך normalizeLabel_ ולא === ישיר - דפוס באג מתועד בפרויקט:
    // רווח נסתר/רווח קשיח (NBSP) מהדבקה או מרשימה נפתחת שובר השוואה
    // מדויקת בשקט.
    if (!phone || !shouldSendNow_(status, scheduleAt, runMode, now)) continue;

    recordLastContact_(phone, sheet.getName());

    const payload = {
      Data: {
        TemplateId: templateId,
        TemplateParameters: [
          { Name: '[#1#]', Type: 'Contact', Value: 'FirstName' }
        ],
        Recipients: [
          { Phone: phone, FirstName: name }
        ]
      }
    };

    const response = UrlFetchApp.fetch(INFORU_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: getInforuAuthHeader_() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    const newStatus = result.StatusId === 1 ? SENT_STATUS : 'שגיאה: ' + result.StatusDescription;
    sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
    sent++;
    Logger.log('טאב "' + sheet.getName() + '", ' + name + ' (' + phone + '): ' + newStatus);
  }
  Logger.log('טאב "' + sheet.getName() + '": ' + sent + ' הודעות נשלחו מתוך ' + (data.length - 1) +
    ' שורות (נשלח רק למי שמסומן "' +
    (runMode === 'scheduled' ? SCHEDULED_STATUS + '" שהגיע זמנו' : APPROVED_STATUS + '"') + ').');
  return sent;
}

function startCalls() {
  getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(function (sheet) {
    startCallsInSheet_(sheet);
  });
}

/**
 * מתקשרת פעם אחת לכל ליד שעדיין אין לו "מזהה ליד NLPearl" (מעולם לא
 * נרשם לפרלה). פרלה עצמה מנהלת את כל ההמשך - ניסיונות חוזרים ללידים
 * שלא ענו, שעות פעילות - לפי ההגדרות שהלקוחה כבר קבעה בקמפיין שלה
 * בפרלה. הצד שלנו לא מנהל שום retry/eligibility - רק "רושם" פעם אחת,
 * ואז מקשיב ל-Webhook (handleNlpearlWebhook_) ומעדכן את הגיליון בכל
 * פעם שפרלה מדווחת על ניסיון/תוצאה, בין אם השיחה יצאה דרכנו ובין אם
 * הלידים נטענו ישירות למערכת של פרלה בלי לעבור דרך הקוד הזה בכלל.
 */
function startCallsInSheet_(sheet, mode) {
  const runMode = mode || 'manual';
  const now = new Date();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  const nameCol = findColumnNormalized_(headers, NAME_HEADER);
  const campaignCol = findColumnNormalized_(headers, CAMPAIGN_HEADER);
  const callStatusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
  const leadIdCol = findColumnNormalized_(headers, CALL_LEAD_ID_HEADER);
  const statusCol = findHeaderIndex_(headers, STATUS_HEADER, STATUS_HEADER_LEGACY);
  const scheduleCol = findColumnNormalized_(headers, SCHEDULE_HEADER);

  if (phoneCol === -1 || callStatusCol === -1) return 0;

  recordCampaignStart_(sheet.getName());

  // ברירת מחדל לכל הטאב: מה שכתוב בשורה 2 (השורה הראשונה עם נתונים) של הטאב הזה.
  const sheetOutboundId = (campaignCol !== -1 && data[1] && data[1][campaignCol])
    ? String(data[1][campaignCol]) : DEFAULT_OUTBOUND_ID;

  let called = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = row[phoneCol];
    const name = nameCol !== -1 ? row[nameCol] : '';
    const outboundId = (campaignCol !== -1 && row[campaignCol]) ? String(row[campaignCol]) : sheetOutboundId;
    const rowIndex = i + 1;
    // "כבר נרשם לפרלה" נבדק לפי קיום מזהה ליד (leadId) - לא לפי טקסט
    // "סטטוס שיחה", כי העמודה הזו נדרסת עם הסטטוס האמיתי מ-NLPearl.
    const alreadyCalled = leadIdCol !== -1 && !!row[leadIdCol];
    const dialStatus = statusCol !== -1 ? String(row[statusCol] || '').trim() : '';
    const scheduleAt = scheduleCol !== -1 ? parseScheduleValue_(row[scheduleCol]) : null;

    if (!phone || alreadyCalled) continue;
    if (!shouldCallNow_(dialStatus, scheduleAt, runMode, now)) continue;

    recordLastContact_(phone, sheet.getName());

    const digits = String(phone).replace(/\D/g, '');
    const internationalPhone = digits.startsWith('0') ? '+972' + digits.slice(1) : '+' + digits;

    const payload = {
      phoneNumber: internationalPhone,
      externalId: digits + '-' + Date.now(),
      callData: { firstName: name }
    };

    const response = UrlFetchApp.fetch(NLPEARL_API_BASE + outboundId + '/Lead', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: getNlpearlAuthHeader_() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseText = response.getContentText();
    const success = response.getResponseCode() < 300;
    sheet.getRange(rowIndex, callStatusCol + 1).setValue(success ? CALL_SENT_STATUS : 'שגיאה: ' + responseText);
    if (success && leadIdCol !== -1) {
      let leadId = responseText;
      try {
        const parsed = JSON.parse(responseText);
        leadId = parsed.leadId || parsed.id || responseText;
      } catch (err) {
        // התשובה הייתה טקסט רגיל (מזהה הליד עצמו) - להשתמש בו כמו שהוא
      }
      sheet.getRange(rowIndex, leadIdCol + 1).setValue(leadId);
    }
    called++;
  }
  return called;
}

/**
 * מקבילה ל-shouldSendNow_, לשיחות פרלה:
 *   mode='manual'    - שומרת בדיוק על ההתנהגות הקיימת (מתקשרת לכל מי
 *                      שאין לו עדיין מזהה ליד), ורק **מדלגת** על שורה
 *                      שתוזמנה - כדי שהרצה ידנית לא תקדים תזמון לעתיד.
 *   mode='scheduled' - רק "מתוזמן לשיחה" שהגיע זמנו. שימי לב שזה סטטוס
 *                      נפרד מ"מתוזמן לשליחה" - אחרת שורה שתוזמנה לוואטסאפ
 *                      הייתה מקבלת גם שיחה, ואותו איש קשר היה נדלק פעמיים.
 */
/** true אם הסטטוס הוא אחד משני סטטוסי התזמון (שליחה או שיחה). */
function isScheduledStatus_(status) {
  const normalized = normalizeLabel_(status);
  return normalized === normalizeLabel_(SCHEDULED_STATUS) ||
    normalized === normalizeLabel_(SCHEDULED_CALL_STATUS);
}

function shouldCallNow_(dialStatus, scheduleAt, mode, now) {
  const normalized = normalizeLabel_(dialStatus);
  const scheduledForCall = normalized === normalizeLabel_(SCHEDULED_CALL_STATUS);
  const scheduledForSend = normalized === normalizeLabel_(SCHEDULED_STATUS);

  if (mode === 'scheduled') {
    if (!scheduledForCall) return false;
    return !!scheduleAt && scheduleAt.getTime() <= now.getTime();
  }

  if (scheduledForCall || scheduledForSend) return false;
  if (scheduleAt && scheduleAt.getTime() > now.getTime()) return false;
  return true;
}

/**
 * הסורק שרץ ברקע על השרתים של גוגל (לא על המחשב של הלקוחה) ומוציא
 * הודעות/שיחות שהגיע זמנן. רץ כל SCHEDULE_INTERVAL_MINUTES_ דקות דרך
 * Trigger, אבל אפשר גם להריץ אותו ידנית מהעורך כדי "לדחוף" מיד.
 *
 * למה זה בטוח:
 *  - שולח **רק** שורות שסומנו במפורש "מתוזמן לשליחה"/"מתוזמן לשיחה"
 *    ושיש להן תאריך שכבר עבר. שורה בלי תאריך לא יוצאת לעולם.
 *  - אחרי שליחה הסטטוס משתנה ל"נשלח וואטסאפ", ולכן הסריקה הבאה כבר
 *    לא תתפוס אותה - אין סיכון לשליחה כפולה.
 *  - נעילה (LockService) מונעת משתי הרצות לחפוף אם אחת מתעכבת.
 *  - אם גוגל לא הריצה בזמן (תחזוקה/מכסה), ההודעה תצא בהרצה הבאה
 *    באיחור - ולא "תיעלם".
 */
function runScheduledSends() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    Logger.log('סריקת תזמון: הרצה קודמת עדיין פועלת - מדלג על הפעימה הזו.');
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let totalSent = 0;
    let totalCalled = 0;

    getCampaignSheets_(ss).forEach(function (sheet) {
      totalSent += sendMessagesInSheet_(sheet, 'scheduled') || 0;
      totalCalled += startCallsInSheet_(sheet, 'scheduled') || 0;
    });

    Logger.log('סריקת תזמון הסתיימה: ' + totalSent + ' הודעות וואטסאפ, ' +
      totalCalled + ' שיחות פרלה יצאו.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * מתקינה את הטריגר של התזמון. מריצים **פעם אחת** ידנית מהעורך.
 * בטוחה להרצה חוזרת - מסירה קודם טריגר קיים כדי שלא ייווצרו כפילויות
 * (שתי פעימות במקביל = ניסיון שליחה כפול).
 */
function installScheduleTrigger() {
  removeScheduleTrigger();
  ScriptApp.newTrigger(SCHEDULE_TRIGGER_FN_)
    .timeBased()
    .everyMinutes(SCHEDULE_INTERVAL_MINUTES_)
    .create();
  Logger.log('טריגר התזמון הותקן - רץ כל ' + SCHEDULE_INTERVAL_MINUTES_ + ' דקות.');
}

function removeScheduleTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === SCHEDULE_TRIGGER_FN_) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(removed ? 'הוסרו ' + removed + ' טריגרים של תזמון.' : 'לא נמצא טריגר תזמון להסרה.');
}

/**
 * ניקוי חד-פעמי: אם כבר הותקן Trigger מתוזמן של runAutoCalls (מהתכונה
 * הישנה שהוסרה - הלקוחה גילתה שפרלה כבר מנהלת retry/שעות בעצמה, ושני
 * המנגנונים ביחד היו עלולים לגרום להתקשרות כפולה) - מריצים את זה פעם
 * אחת כדי להסיר אותו. בטוחה להרצה גם אם אין שום Trigger כזה.
 */
function removeAutoCallTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runAutoCalls') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('הוסרו ' + removed + ' Triggers.');
}

/**
 * מנתב שלושה מקורות ה-Webhook, על פני כל טאבי הקמפיינים:
 * - אינפוריו שולח: { "Data": [ { "Value": "<טלפון>", "Message": "<טקסט התשובה>", ... } ] }
 * - NLPearl שולח אובייקט Lead/Call ישירות (יש בו "pearlId").
 * - Wix Automations שולח ליד חדש מטופס באתר, עטוף במפתח עליון "data".
 * כל קריאה נכנסת נרשמת גם גולמית בטאב WebhookLog לצורך דיבוג.
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('WebhookLog') || ss.insertSheet('WebhookLog');
  logSheet.appendRow([new Date(), e.postData.contents]);

  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.Data) {
      handleInforuWebhook_(ss, payload);
    } else if (payload.pearlId) {
      handleNlpearlWebhook_(ss, payload);
    } else if (payload.data) {
      handleWixWebhook_(ss, payload);
    }
  } catch (err) {
    logSheet.appendRow([new Date(), 'ERROR: ' + err.message + ' | ' + err.stack]);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * הבוט של אינפוריו יכול לשלוח כמה הודעות MO ברצף מהיר מאוד (שיחה
 * אוטומטית עם הלקוח) - כל הודעה מגיעה כקריאת webhook נפרדת. משתמשים
 * ב-LockService כדי שקריאות שמגיעות כמעט באותו רגע יעובדו אחת אחרי
 * השנייה (ולא "יתנגשו" ותיכתב תשובה לא-אחרונה), ומצרפים כל תשובה
 * לעמודת "תשובת איש קשר" (עם שעה) במקום לדרוס את הקודמת - כדי לשמור את
 * כל השיחה, לא רק את ההודעה האחרונה.
 *
 * מחפשים קודם כל רק בטאב שאליו נשלחה לאחרונה הודעה למספר הזה
 * (lastContactSheet_) - כדי שתשובה תעדכן אך ורק את הקמפיין הרלוונטי,
 * גם אם באותו מספר טלפון נעשה שימוש (למשל לבדיקות) בכמה טאבים במקביל.
 * רק אם אין מיפוי כזה (למשל שורה שנוספה ידנית ומעולם לא נשלחה אליה
 * הודעה מהמערכת) נופלים חזרה לחיפוש בכל טאבי הקמפיינים.
 */
/**
 * שולפת את הטקסט של הכפתור שנלחץ, אם ההודעה הנכנסת היא בכלל תוצאה של
 * לחיצה על כפתור תגובה מובנה (ולא הודעת טקסט חופשי שהלקוח הקליד).
 * אינפוריו מסמן את זה בשדה AdditionalInfo (מחרוזת JSON) - יש בו
 * "ButtonPayload" רק כשזו הייתה לחיצת כפתור אמיתית; בטקסט חופשי השדה
 * הזה קיים אבל בלי ButtonPayload בכלל.
 */
function extractButtonPayload_(entry) {
  try {
    const info = JSON.parse(entry.AdditionalInfo || '{}');
    return info.ButtonPayload || '';
  } catch (e) {
    return '';
  }
}

function handleInforuWebhook_(ss, payload) {
  const entry = payload.Data && payload.Data[0];
  if (!entry) return;

  const incomingPhone = phoneSuffix_(entry.Value);
  const incomingText = entry.Message;
  const buttonPayload = extractButtonPayload_(entry);
  if (!incomingPhone) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const tracked = lastContactSheet_(ss, incomingPhone);
    const sheets = tracked ? [tracked] : getCampaignSheets_(ss);
    for (const sheet of sheets) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
      if (phoneCol === -1) continue;

      const replyCol = findHeaderIndex_(headers, REPLY_HEADER, REPLY_HEADER_LEGACY);
      const replyDateCol = findColumnNormalized_(headers, REPLY_DATE_HEADER);
      if (replyCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          // "הערות איש קשר" (השרשור המלא) מקבלת רק טקסט חופשי אמיתי -
          // לחיצת כפתור לבדה כבר מתועדת ב"סטטוס" ולא צריכה גם עותק כאן,
          // כדי שמי שרק לחץ כפתור ולא כתב שום דבר בעצמו יישאר עם "הערות
          // איש קשר" ריקות (אין שם שום שיחה אמיתית לתעד). "הערות מיטוב"
          // נשארת עמודה נפרדת - ליומן ידני של הצוות בלבד (ר' addUserNote).
          if (!buttonPayload) {
            const existingReply = data[i][replyCol];
            const combined = existingReply ? (existingReply + '\n' + incomingText) : incomingText;
            sheet.getRange(rowIndex, replyCol + 1).setValue(combined);
          }
          // "תאריך" (תאריך תשובה) מתעדכן בכל אינטראקציה אמיתית עם הבוט -
          // גם טקסט חופשי וגם לחיצת כפתור - כדי שתשקף "מתי היה מגע אחרון".
          if (replyDateCol !== -1) sheet.getRange(rowIndex, replyDateCol + 1).setValue(new Date());
          recordDailyActivity_(sheet.getName());
          // "סטטוס" נקבע רק מלחיצה אמיתית על כפתור (למשל "פגישה"/"לא
          // מעוניין" בתפריט הראשוני) - נשמר פעם אחת בלבד, לא נדרס בלחיצה
          // נוספת בהמשך השיחה עם הבוט האוטומטי. העמודה נוצרת לבד בפעם
          // הראשונה שבאמת יש מה לכתוב בה - אין צורך להוסיף אותה ידנית.
          if (buttonPayload) {
            const firstReplyCol = ensureColumn_(sheet, headers, FIRST_REPLY_HEADER);
            if (!data[i][firstReplyCol]) {
              sheet.getRange(rowIndex, firstReplyCol + 1).setValue(buttonPayload);
              // כפתורי וואטסאפ אינם קבועים מראש (הלקוחה מעצבת תבניות
              // חדשות בעצמה) - כל טקסט כפתור חדש שעדיין לא ב"רשימת
              // סטטוסים" מתווסף אליה אוטומטית, כדי שהרשימה תישאר מלאה.
              addStatusIfMissing_(buttonPayload);
            }
          }
          return;
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// --- משיכת הודעות וואטסאפ יוצאות שנשלחו ידנית (Inbox של InforU) ---
const WHATSAPP_PULL_ENDPOINT_ = 'https://capi.inforu.co.il/api/v2/WhatsApp/GetWhatsAppChats';
const WHATSAPP_PULL_LAST_TIME_PROP_ = 'WHATSAPP_PULL_LAST_TIME';
const WHATSAPP_PULL_BACKFILL_MINUTES_ = 10; // אם עוד לא נשמר זמן קודם - כמה אחורה למשוך בהרצה הראשונה
const WHATSAPP_PULL_TRIGGER_FN_ = 'pullOutgoingWhatsAppMessages';

/**
 * מוסיפה שורה בודדת ל"תשובת איש קשר" (REPLY_HEADER, מצטברת) של איש
 * הקשר עם הטלפון הנתון - זהה לחלוטין לתבנית ההצטברות שכבר קיימת
 * ב-handleInforuWebhook_, רק כתובה כפונקציה נפרדת כי כאן מטפלים
 * בכמה הודעות ברצף (לא ניתן להשתמש ב-return מוקדם מתוך פונקציה אחת
 * כמו שם). מחזירה true אם נמצאה שורה מתאימה ונכתב אליה.
 */
function appendOutgoingMessageToSheet_(ss, incomingPhone, text) {
  const tracked = lastContactSheet_(ss, incomingPhone);
  const sheets = tracked ? [tracked] : getCampaignSheets_(ss);
  for (const sheet of sheets) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
    const replyCol = findHeaderIndex_(headers, REPLY_HEADER, REPLY_HEADER_LEGACY);
    if (phoneCol === -1 || replyCol === -1) continue;

    for (let i = 1; i < data.length; i++) {
      const sheetPhone = phoneSuffix_(data[i][phoneCol]);
      if (sheetPhone && sheetPhone === incomingPhone) {
        const rowIndex = i + 1;
        const existingReply = data[i][replyCol];
        const combined = existingReply ? (existingReply + '\n' + text) : text;
        sheet.getRange(rowIndex, replyCol + 1).setValue(combined);
        recordDailyActivity_(sheet.getName());
        return true;
      }
    }
  }
  return false;
}

/**
 * מושכת (Pull, לא Webhook) מ-InforU הודעות וואטסאפ **יוצאות** (Direction:
 * "Outgoing") שנשלחו ידנית מתוך ה-Inbox שלהם - למשל כשהבוט "נתקע" והצוות
 * עונה בעצמו ישירות בשיחה. הודעות **נכנסות** (Direction: "Incoming")
 * מדולגות במפורש - הן כבר מגיעות ומתועדות דרך ה-Webhook הרגיל
 * (handleInforuWebhook_), וכתיבה כפולה כאן הייתה יוצרת שכפול.
 *
 * זוכרת ב-Script Properties (WHATSAPP_PULL_LAST_TIME_PROP_) עד איזה
 * זמן כבר נמשך בהצלחה, כדי שכל הרצה תמשוך רק הודעות **חדשות** מאז
 * ההרצה הקודמת - בלי חפיפה ובלי לפספס טווח. רצה מ-Trigger מתוזמן כל
 * 5 דקות (ר' installWhatsAppPullTrigger) - התדירות הזו לפי המלצת
 * InforU עצמם.
 */
function pullOutgoingWhatsAppMessages() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const lastPullIso = props.getProperty(WHATSAPP_PULL_LAST_TIME_PROP_);
  const fromDate = lastPullIso ? new Date(lastPullIso) : new Date(now.getTime() - WHATSAPP_PULL_BACKFILL_MINUTES_ * 60 * 1000);

  const formatForInforu_ = function (d) {
    return Utilities.formatDate(d, 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm:ss.SS");
  };

  const response = UrlFetchApp.fetch(WHATSAPP_PULL_ENDPOINT_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: getInforuAuthHeader_() },
    payload: JSON.stringify({
      Data: {
        FromDateTime: formatForInforu_(fromDate),
        ToDateTime: formatForInforu_(now)
      }
    }),
    muteHttpExceptions: true
  });

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log('pullOutgoingWhatsAppMessages: תשובה לא תקינה מ-InforU: ' + response.getContentText());
    return;
  }

  if (result.StatusId !== 1) {
    const description = (result.StatusDescription || '') + ' ' + (result.DetailedDescription || '');
    // "Couldn't find active chat" זו לא שגיאה - זו הדרך של InforU להגיד
    // "אין אף שיחה בטווח הזמן הזה" (אף אחד לא כתב/ענה ב-5 הדקות
    // האחרונות). מקדמים את חלון הזמן כרגיל (כמו הרצה מוצלחת עם 0
    // תוצאות) ולא מציגים "שגיאה" ביומן, כדי לא להבהיל את מי שמסתכלת בו.
    if (description.indexOf("Couldn't find active chat") !== -1) {
      props.setProperty(WHATSAPP_PULL_LAST_TIME_PROP_, now.toISOString());
      Logger.log('pullOutgoingWhatsAppMessages: אין שיחות חדשות בטווח - תקין, אין מה לעדכן.');
      return;
    }
    Logger.log('pullOutgoingWhatsAppMessages: שגיאה - ' + description);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const chats = (result.Data && result.Data.Results) || [];
  let written = 0;
  let skippedIncoming = 0;
  let skippedTemplates = 0;
  let notFound = 0;

  chats.forEach(function (chat) {
    const messages = chat.Messages || [];
    messages.forEach(function (msg) {
      if (msg.Direction !== 'Outgoing') { skippedIncoming++; return; }
      // הודעת התבנית של הקמפיין (ההודעה הראשונה שנשלחה לכולם) לא מתועדת -
      // היא זהה לכל הלידים, מעמיסה את עמודת ההערות ולא מוסיפה מידע. מזוהה
      // לפי השדה WhatsappTemplateInfo שקיים רק בהודעות תבנית (ר' התיעוד
      // של InforU) - לא לפי ניחוש טקסט. רק המשך השיחה הידני מתועד.
      const additional = msg.AddtionalInfo || msg.AdditionalInfo || {};
      if (additional.WhatsappTemplateInfo) { skippedTemplates++; return; }

      const phone = phoneSuffix_(msg.PhoneNumber);
      if (!phone) return;

      const outgoingLine = '👤 מיטוב: ' + (msg.MessageText || '');
      if (appendOutgoingMessageToSheet_(ss, phone, outgoingLine)) {
        written++;
      } else {
        notFound++;
      }
    });
  });

  props.setProperty(WHATSAPP_PULL_LAST_TIME_PROP_, now.toISOString());
  Logger.log('pullOutgoingWhatsAppMessages: ' + chats.length + ' שיחות נמשכו, ' + written +
    ' הודעות יוצאות נכתבו, ' + skippedIncoming + ' הודעות נכנסות דולגו (כבר מתועדות ע"י ה-Webhook), ' +
    skippedTemplates + ' הודעות תבנית דולגו (ההודעה הראשונה של הקמפיין), ' +
    notFound + ' לא נמצאה עבורן שורה בגיליון.');
}

/**
 * מתקינה Trigger מתוזמן שמריץ את pullOutgoingWhatsAppMessages כל 5
 * דקות - לפי המלצת InforU. מריצים **פעם אחת בלבד** מהעורך. בטוחה
 * להרצה חוזרת - תמיד מוחקת קודם Trigger ישן עם אותו שם.
 */
function installWhatsAppPullTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === WHATSAPP_PULL_TRIGGER_FN_) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(WHATSAPP_PULL_TRIGGER_FN_).timeBased().everyMinutes(5).create();
  Logger.log('Trigger מותקן - ' + WHATSAPP_PULL_TRIGGER_FN_ + ' ירוץ כל 5 דקות.');
}

/** מסירה את ה-Trigger המתוזמן של משיכת ההודעות היוצאות. */
function removeWhatsAppPullTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === WHATSAPP_PULL_TRIGGER_FN_) { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('הוסרו ' + removed + ' Triggers.');
}

/**
 * מיפוי סטטוסי ליד של NLPearl לעברית קריאה - לפי טבלת "Lead Statuses"
 * מהתיעוד הרשמי של NLPearl (developers.nlpearl.ai), שהלקוחה העתיקה לנו
 * מילה במילה. אלה סטטוסי-מערכת ("מה קורה עם החיוג עכשיו") - לא תוצאה
 * עסקית - ולכן הם לעולם לא דורסים תוצאה אמיתית (תגית/סיכום), ר'
 * isPearlSystemStatus_ למטה.
 */
// כל מצבי ה"עוד לא נסגר, פרלה תחזור אליו" מאוחדים לתווית אחת לפי בקשת
// הלקוחה - במקום ניואנסים טכניים (בתור/מחייג/ינוסה שוב) שלא משנים לה בפועל.
const PEARL_PENDING_LABEL_ = 'ממתין לשיחה נוספת';

// מעל האורך הזה טקסט נחשב "נרטיב" (תיאור שיחה) ולא תווית סטטוס - תגיות
// אמיתיות תמיד קצרות ("לא מעוניין", "פגישה מקוונת"), תיאורי שיחה תמיד ארוכים.
const NARRATIVE_MIN_LENGTH_ = 40;

// הקודים המספריים של פרלה - **רק** למצבים שבהם לא התקיימה שיחה ולכן
// אין סיכום להסתמך עליו. קודים 100/110 ("הסתיים בהצלחה/ללא הצלחה") הוסרו
// במכוון: הם לא מבחינים בין "ניתק לי" ל"ביקש שנחזור מחר", ולכן הסטטוס
// במקרים האלה נקבע מסיכום השיחה (matchCallStatus_) ולא מהקוד. קוד לא
// מוכר פשוט לא כותב כלום ומשאיר את הסטטוס הקיים.
const PEARL_LEAD_STATUS_LABELS_ = {
  1: PEARL_PENDING_LABEL_,
  10: PEARL_PENDING_LABEL_,
  20: PEARL_PENDING_LABEL_,
  30: 'שגוי',
  40: PEARL_PENDING_LABEL_,
  70: 'אין מענה',
  130: 'אין מענה',
  150: 'אין מענה',
  220: 'לא לפנות',
  300: PEARL_PENDING_LABEL_,
  500: 'שגיאת מערכת בפרלה'
};

/**
 * true אם ערך "סטטוס שיחה" הנוכחי הוא סטטוס-מערכת (מהמיפוי למעלה, או
 * placeholder "שיחה נשלחה") - כלומר מותר לדרוס אותו בסטטוס-מערכת עדכני.
 * ערך אחר (תגית אמיתית מפרלה / תווית מעוגלת מהרשימה של הלקוחה) הוא
 * תוצאה עסקית - סטטוס-מערכת גנרי לעולם לא דורס אותה.
 */
function isPearlSystemStatus_(value) {
  if (!value) return true;
  const normalized = normalizeLabel_(value);
  if (normalized === normalizeLabel_(CALL_SENT_STATUS)) return true;
  const isKnownSystemLabel = Object.keys(PEARL_LEAD_STATUS_LABELS_).some(function (code) {
    return normalizeLabel_(PEARL_LEAD_STATUS_LABELS_[code]) === normalized;
  });
  if (isKnownSystemLabel) return true;
  // נרטיב ארוך שנתקע בעמודת הסטטוס לפני כלל האחידות - אינו תוצאה עסקית
  // ואינו אמור לשבת שם מלכתחילה (הטקסט המלא ממילא שמור ב"סיכום שיחה").
  // מותר לסטטוס אמיתי מפרלה לדרוס אותו, אחרת השורה נתקעת על נרטיב לנצח.
  // הזיהוי לפי **אורך** ולא לפי "לא ברשימת הסטטוסים": אילו הסתמכנו על
  // הרשימה, תקלה רגעית בקריאת הטאב הייתה הופכת כל תגית עסקית אמיתית
  // ("לא מעוניין") לניתנת לדריסה - ואיבוד תוצאות אמיתיות. תגית אמיתית
  // תמיד קצרה; נרטיב תמיד ארוך.
  return String(value).length > NARRATIVE_MIN_LENGTH_;
}

/**
 * סדר העדיפויות לניתוב אירוע פרלה לטאב הנכון (כשאותו מספר קיים בכמה):
 * 1. טאב שבעמודת "מזהה קמפיין" שלו (שורה 2) רשום אותו pearlId שמגיע
 *    באירוע - זה הזיהוי הכי אמין, כי הוא אומר במפורש "הטאב הזה שייך
 *    לפרל הזאת". חיוני לתהליך שבו הלקוחה טוענת לידים ישירות למערכת של
 *    פרלה (בלי לחייג דרכנו) - אז ה"זיכרון" (lastContactSheet_) בכלל לא
 *    מתעדכן, ולידים שהופיעו גם בקמפיין ישן היו מקבלים את התוצאה בטאב הישן.
 * 2. הטאב שאליו הותחלה לאחרונה שיחה/הודעה למספר (lastContactSheet_).
 * 3. כל שאר טאבי הקמפיין.
 */
function orderedPearlSheets_(ss, incomingPhone, eventPearlId) {
  const allSheets = getCampaignSheets_(ss);
  const tracked = lastContactSheet_(ss, incomingPhone);

  const sheetMatchesPearl_ = function (sheet) {
    if (!eventPearlId) return false;
    const headers = headerRow_(sheet);
    const campaignCol = findColumnNormalized_(headers, CAMPAIGN_HEADER);
    if (campaignCol === -1) return false;
    const row2Value = sheet.getLastRow() >= 2 ? sheet.getRange(2, campaignCol + 1).getValue() : '';
    return normalizeLabel_(row2Value) === normalizeLabel_(eventPearlId);
  };

  const pearlMatched = allSheets.filter(sheetMatchesPearl_);
  const rest = allSheets.filter(function (s) { return pearlMatched.indexOf(s) === -1; });
  if (tracked && pearlMatched.indexOf(tracked) === -1) {
    rest.splice(rest.indexOf(tracked), 1);
    rest.unshift(tracked);
  }
  return pearlMatched.concat(rest);
}

/**
 * אירוע Lead Webhook מפרלה (מזוהה לפי "phoneNumber", בלי "to") - נושא
 * סטטוס-מערכת מספרי (ר' PEARL_LEAD_STATUS_LABELS_). כותבים את התרגום
 * העברי שלו ל"סטטוס שיחה" בלבד ("מה קורה עם הליד עכשיו" - לא ענה/בתור/
 * בשיחה/הושלם), כדי שהלקוחה תראה אצלנו את אותם סטטוסים שהיא רואה במסך
 * של פרלה. לא נוגעים ב"סיכום שיחה" (המצטברת), לא דורסים תוצאה עסקית
 * אמיתית שכבר נכתבה (תגית/סיכום), ולא סופרים את זה כ"פעילות" בגרפים.
 */
function handlePearlLeadStatusEvent_(ss, payload, eventPearlId) {
  const label = PEARL_LEAD_STATUS_LABELS_[Number(payload.status)];
  if (!label) return; // קוד לא מוכר - לא ממציאים תווית

  const incomingPhone = phoneSuffix_(payload.phoneNumber);
  if (!incomingPhone) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = orderedPearlSheets_(ss, incomingPhone, eventPearlId);
    for (const sheet of sheets) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
      const statusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
      if (phoneCol === -1 || statusCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          if (isPearlSystemStatus_(data[i][statusCol])) {
            sheet.getRange(rowIndex, statusCol + 1).setValue(label);
            const dateCol = ensureColumn_(sheet, headers, CALL_DATE_HEADER);
            sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());
          }
          return;
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * "תוצאות שיחה" מצטברת (כל שיחה חדשה מתווספת לקיים, לא דורסת) - בדיוק
 * כמו "תשובת איש קשר" בוואטסאפ. "תאריך שיחה" נוצרת לבד בפעם הראשונה שצריך.
 */
function handleNlpearlWebhook_(ss, payload) {
  const eventPearlId = payload.pearlId ? String(payload.pearlId) : '';

  // אירוע Lead Webhook (סטטוס-מערכת: לא ענה/בתור/בשיחה/הושלם) - מטופל
  // בנפרד, כותב רק ל"סטטוס שיחה" בלי לגעת בתוצאות.
  if (!payload.to && payload.phoneNumber) {
    handlePearlLeadStatusEvent_(ss, payload, eventPearlId);
    return;
  }
  if (!payload.to) return;

  const incomingPhone = phoneSuffix_(payload.to);
  if (!incomingPhone) return;

  // מתעלמים מאירועי שיחה בלי טקסט קריא ממשי (רק קוד סטטוס פנימי מספרי
  // של פרלה, בלי Indicator Tag/summary) - כדי שהלקוחה לעולם לא תראה
  // "סטטוס: 5" לא מובן בעמודות. הסטטוסים השוטפים (לא ענה וכו') מגיעים
  // דרך אירועי ה-Lead שמטופלים למעלה.
  const summary = (Array.isArray(payload.tags) && payload.tags.length)
    ? payload.tags.join(', ')
    : payload.summary;
  if (!summary) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = orderedPearlSheets_(ss, incomingPhone, eventPearlId);

    for (const sheet of sheets) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
      const resultCol = findHeaderIndex_(headers, CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY);
      if (phoneCol === -1 || resultCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          const existingResult = data[i][resultCol];
          const combined = existingResult ? (existingResult + '\n' + summary) : summary;
          sheet.getRange(rowIndex, resultCol + 1).setValue(combined);
          const dateCol = ensureColumn_(sheet, headers, CALL_DATE_HEADER);
          sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());
          // "סטטוס שיחה" מוצג כמצב הנוכחי (נדרס בכל שיחה, לא מצטבר כמו
          // "סיכום שיחה" למעלה) - אותו ערך בדיוק (ה-Indicator Tags שהלקוחה
          // מגדירה ומשנה בעצמה בפרלה), בלי מיפוי קבוע בקוד, כי הרשימה
          // משתנה אצלה כל הזמן.
          const statusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
          // "סטטוס שיחה" תמיד מתעגל לערך היחיד הכי קרוב מתוך "רשימת
          // סטטוסים" (matchCallStatus_) - בין אם המקור הוא תגית קצרה
          // שפרלה כבר נתנה (כמו "לא מעוניין") ובין אם זה נרטיב ארוך -
          // כך שהעמודה הזו תמיד מדברת באותה שפה סגורה כמו "סטטוס איש
          // קשר" הידני. "סיכום שיחה" למעלה תמיד מקבל את הטקסט המלא, לא נגוע.
          const statusList = getStatusList_();
          const statusValue = matchCallStatus_(summary, statusList);
          // אחידות מוחלטת: כותבים ל"סטטוס שיחה" **רק** ערך מאוצר המילים
          // הסגור. אם העיגול ב-AI נכשל והוחזר הנרטיב הגולמי - לא כותבים
          // כלום (הסטטוס הקודם נשאר), והטקסט המלא ממילא כבר נשמר
          // ב"סיכום שיחה" למעלה. כך פסקה חופשית לעולם לא נוחתת בעמודת הסטטוס.
          if (statusCol !== -1 && isAllowedStatusValue_(statusValue, statusList)) {
            sheet.getRange(rowIndex, statusCol + 1).setValue(statusValue);
          }
          recordDailyActivity_(sheet.getName());
          return;
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * מנקה תווית לצורך השוואה: מוריד גרשיים/גרש (רגילים ועבריים), רווחים
 * כפולים/ירידות שורה, ורישיות - כדי ש-"דוא\"ל" ו-"טלפון נייד\n" יתאימו
 * גם עם ההבדלים הקטנים ש-Wix מוסיף.
 */
function normalizeLabel_(s) {
  return String(s || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * מוסיף ליד חדש שהגיע מ-Wix Automations (טופס באתר) לטאב WIX_LEADS_SHEET_NAME.
 * מבוסס על מבנה JSON אמיתי שנבדק משני הטפסים באתר (ai2nadlan.co.il).
 * חשוב: contact.name ב-Wix הוא **תמיד** תעתיק לאנגלית (למשל "Tal"), גם
 * כשהוזן שם בעברית בפועל - לכן מעדיפים את הערך האמיתי מתוך ה-submissions
 * (מה שהוקלד בטופס) ורק אם הוא חסר נופלים חזרה ל-contact.name.
 */
function handleWixWebhook_(ss, payload) {
  const sheet = ss.getSheetByName(WIX_LEADS_SHEET_NAME);
  if (!sheet || !isCampaignSheet_(sheet)) return;

  const data = payload.data || {};
  const contact = data.contact || {};
  const submissions = data.submissions || data.submissionData || data.fields || [];

  const bySubmissionLabel_ = function (candidates) {
    const wanted = candidates.map(normalizeLabel_);
    for (let i = 0; i < submissions.length; i++) {
      const item = submissions[i];
      const label = normalizeLabel_(item && (item.label || item.name || item.key));
      if (wanted.indexOf(label) !== -1) return item.value;
    }
    return '';
  };

  const firstName = bySubmissionLabel_(['שם פרטי']) || (contact.name && contact.name.first) || '';
  const lastName = bySubmissionLabel_(['שם משפחה']) || (contact.name && contact.name.last) || '';
  const name = (firstName + ' ' + lastName).trim();

  const company = bySubmissionLabel_(['שם חברה', 'company']);
  const email = contact.email || bySubmissionLabel_(['דואל', 'אימייל', 'מייל', 'email']);
  const phone = contact.phone || bySubmissionLabel_(['טלפון נייד', 'טלפון', 'נייד', 'phone']);

  if (!phone) return; // אין טלפון בליד - אין מה לרשום

  // מוסיפים לתווית המקור גם את שם הטופס הספציפי מ-Wix (formName), כדי
  // להבדיל בין "צרו קשר כללי" ל"רשימת המתנה" וכל טופס עתידי נוסף באתר.
  const formName = data.formName || '';
  const source = formName ? (WIX_SOURCE_LABEL + ' - ' + formName) : WIX_SOURCE_LABEL;

  addContactRow_(sheet, {
    name: name,
    company: company,
    phone: phone,
    email: email,
    source: source
  });
}

/**
 * הדשבורד החזותי (Dashboard.html), מוגש באותה כתובת /exec דרך GET
 * (doPost למעלה ממשיך לטפל בבקשות POST של ה-Webhook באותה כתובת בדיוק).
 * משתמשים בתבנית (לא בקובץ סטטי) כדי להזריק את כתובת ה-/exec האמיתית -
 * הדף עצמו רץ בתוך iframe מבודד בדומיין אחר (googleusercontent.com),
 * כך ש-window.location.href בצד הלקוח לא נותן את הכתובת הציבורית הנכונה
 * לשיתוף.
 */
function doGet(e) {
  // ?pearl=<קוד> מגיש את "מסך פרלה" - חלון חי ל-NLPearl, בלי קשר לגיליון.
  const pearlKey = (e && e.parameter && e.parameter.pearl) ? String(e.parameter.pearl) : '';
  if (pearlKey) {
    const pearlTemplate = HtmlService.createTemplateFromFile('PearlDashboard');
    pearlTemplate.baseUrl = ScriptApp.getService().getUrl();
    pearlTemplate.pearlKey = pearlKey;
    return pearlTemplate.evaluate()
      .setTitle('מסך פרלה')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // ?rep=<קוד אישי> מגיש לנציגה את הדף שלה בלבד. בלי הפרמטר - הדשבורד
  // הראשי, בדיוק כמו עד היום (הלינק הקיים של הלקוחה ממשיך לעבוד).
  const repKey = (e && e.parameter && e.parameter.rep) ? String(e.parameter.rep) : '';
  if (repKey) {
    const repTemplate = HtmlService.createTemplateFromFile('RepDashboard');
    repTemplate.baseUrl = ScriptApp.getService().getUrl();
    repTemplate.repKey = repKey;
    return repTemplate.evaluate()
      .setTitle('הלידים שלי')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const template = HtmlService.createTemplateFromFile('Dashboard');
  template.baseUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('ניהול קמפיינים')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * רשימת שמות הטאבים להצגה כטאבים בדשבורד. טאב שהוסתר בגיליון
 * (לחיצה ימנית על הטאב > הסתרת גיליון) לא יופיע כאן - זו בדרך כלל
 * הכוונה כשמסתירים קמפיין (בלי למחוק אותו). שליחה/שיחה על כל הקמפיינים
 * (sendMessages/startCalls) לא מושפעת מזה ועדיין מריצה גם על טאבים
 * מוסתרים, למקרה שרוצים להמשיך לעבד אותם בלי להציג אותם בדשבורד.
 */
function getCampaignNames() {
  return getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet())
    .filter(function (sheet) { return !sheet.isSheetHidden(); })
    .map(function (sheet) {
      return sheet.getName();
    });
}

/**
 * מוסיפה איש קשר חדש לטאב קמפיין, מהדשבורד (בלי לפתוח את הגיליון).
 * fields = { name, phone, company, title, email, source } - כל שדה נכתב
 * רק אם יש בטאב עמודה מתאימה לו (אם אין, פשוט מתעלמים ממנו).
 * מספר התבנית / מזהה הסוכנת נשארים ריקים בשורה החדשה - הם יורשים
 * אוטומטית את ברירת המחדל של הטאב (שורה 2) כשמריצים שליחה, בדיוק כמו
 * שורה שנוספה ידנית.
 */
function addContact(sheetName, fields) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || !isCampaignSheet_(sheet)) {
    throw new Error('הטאב "' + sheetName + '" לא נמצא או אינו טאב קמפיין');
  }
  addContactRow_(sheet, fields);
  return { success: true };
}

/**
 * הלוגיקה המשותפת שכותבת שורת איש-קשר חדשה לטאב - משמשת גם את addContact
 * (מהדשבורד) וגם את handleWixWebhook_ (לידים אוטומטיים מהאתר).
 */
function addContactRow_(sheet, fields) {
  const headers = headerRow_(sheet);
  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  if (phoneCol === -1) {
    throw new Error('לא נמצאה עמודת "' + PHONE_HEADER + '" בטאב "' + sheet.getName() + '"');
  }

  const digits = String((fields && fields.phone) || '').replace(/\D/g, '');
  if (!digits) {
    throw new Error('מספר טלפון לא תקין');
  }

  const columnByField = {
    name: NAME_HEADER,
    company: COMPANY_HEADER,
    title: TITLE_HEADER,
    email: EMAIL_HEADER,
    source: SOURCE_HEADER
  };

  const row = new Array(headers.length).fill('');
  // מנרמלת לפורמט אחיד "05X-XXXXXXX" תמיד (כדי שפרלה תוכל לחייג בלי
  // תלות באיך הלקוח שלח את המספר) - אם הפורמט לא מזוהה בבירור, נשמר
  // המספר הגולמי כמו שהוא ולא מנוחש/משובש.
  row[phoneCol] = normalizePhoneValue_(fields.phone) || fields.phone;
  Object.keys(columnByField).forEach(function (key) {
    const col = findColumnNormalized_(headers, columnByField[key]);
    if (col !== -1) row[col] = (fields && fields[key]) || '';
  });

  const targetRow = sheet.getLastRow() + 1;
  // כופה פורמט טקסט על תא הטלפון לפני הכתיבה - אחרת גוגל שיטס עלול לפרש
  // מספר שמתחיל ב-"+" (כמו שמגיע מ-Wix, לדוגמה "+972501234567") כניסיון
  // לנוסחה ולזרוק #ERROR!, גם אם עמודת הטלפון לא הוגדרה ידנית כטקסט.
  sheet.getRange(targetRow, phoneCol + 1).setNumberFormat('@');
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

/**
 * מוצאת שורה בטאב לפי מספר טלפון (9 ספרות אחרונות) - משמשת את
 * addUserNote/setUserStatus שמעדכנות שדות CRM פנימיים לפי טלפון (לא
 * לפי מספר שורה, כי בדשבורד הטבלה עשויה להיות ממוינת/מסוננת).
 */
function findRowByPhone_(sheet, phone) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  if (phoneCol === -1) return null;
  const target = phoneSuffix_(phone);
  for (let i = 1; i < data.length; i++) {
    if (phoneSuffix_(data[i][phoneCol]) === target) {
      return { rowIndex: i + 1, headers: headers };
    }
  }
  return null;
}

/**
 * כלי עזר חד-פעמי: משלים רטרואקטיבית את "תגובה ראשונית" לכל מי שכבר
 * לחץ בעבר על כפתור תגובה (לפני שהתיקון ב-handleInforuWebhook_ נכנס),
 * על סמך ה-JSON הגולמי שנשמר בטאב WebhookLog מאז ומתמיד. עוברים על
 * הלוג מהישן לחדש, כך שהעדכון הראשון שנתפס לכל טלפון הוא באמת
 * הלחיצה הראשונה - בדיוק כמו ההתנהגות הרגילה. אפשר להריץ שוב בבטחה,
 * לא דורס ערך שכבר קיים בעמודה.
 */
function backfillFirstReplyFromWebhookLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('WebhookLog');
  if (!logSheet) throw new Error('לא נמצא טאב WebhookLog');

  const rows = logSheet.getDataRange().getValues();
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i][1];
    if (!raw) continue;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    const entry = payload.Data && payload.Data[0];
    if (!entry || !entry.Value) continue;

    const buttonPayload = extractButtonPayload_(entry);
    if (!buttonPayload) continue;

    const phone = phoneSuffix_(entry.Value);
    if (!phone) continue;

    const tracked = lastContactSheet_(ss, phone);
    const sheets = tracked ? [tracked] : getCampaignSheets_(ss);
    for (const sheet of sheets) {
      const found = findRowByPhone_(sheet, phone);
      if (!found) continue;
      const firstReplyCol = ensureColumn_(sheet, found.headers, FIRST_REPLY_HEADER);
      const cell = sheet.getRange(found.rowIndex, firstReplyCol + 1);
      if (!cell.getValue()) {
        cell.setValue(buttonPayload);
        updated++;
      }
      break;
    }
  }

  Logger.log('הושלמו ' + updated + ' עדכונים רטרואקטיביים ל"' + FIRST_REPLY_HEADER + '"');
  return updated;
}

/**
 * כלי ניקוי חד-פעמי: מסירה מ"הערות איש קשר" שורות שהן בעצם הד של לחיצת
 * כפתור (זהות מילה-במילה לערך שנשמר ב"סטטוס") - כדי לתקן נתונים היסטוריים
 * שנכתבו לפני התיקון בהודעה הנכנסת (ר' handleInforuWebhook_), שבו לחיצת
 * כפתור לבדה עדיין הצטרפה גם ל"הערות איש קשר" בטעות. נוגעת אך ורק בשורה
 * שזהה **מילה-במילה** לערך שכבר שמור ב"סטטוס" - שום טקסט חופשי לא נמחק,
 * גם אם הוא דומה או מכיל את אותן מילים בתוך משפט ארוך יותר. אפשר להריץ
 * שוב בבטחה - שורה שכבר נוקתה פשוט לא תשתנה שוב.
 *
 * מריצים קודם את previewCleanupHistoricalButtonEchoes() (לא נוגעת בכלום,
 * רק מדפיסה ליומן מה היא הייתה עושה) כדי לבדוק שהתוצאה נראית נכון, ורק
 * אחר כך את cleanupHistoricalButtonEchoes() שבאמת כותבת את השינוי לגיליון.
 */
function collectButtonEchoCleanup_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);
  let cleaned = 0;

  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const replyCol = findHeaderIndex_(headers, REPLY_HEADER, REPLY_HEADER_LEGACY);
    const firstReplyCol = findColumnNormalized_(headers, FIRST_REPLY_HEADER);
    const nameCol = findColumnNormalized_(headers, NAME_HEADER);
    if (replyCol === -1 || firstReplyCol === -1) return;

    for (let i = 1; i < data.length; i++) {
      const firstReply = String(data[i][firstReplyCol] || '').trim();
      const reply = data[i][replyCol];
      if (!firstReply || !reply) continue;

      const lines = String(reply).split('\n');
      const filtered = lines.filter(function (line) { return line.trim() !== firstReply; });
      if (filtered.length !== lines.length) {
        const name = nameCol !== -1 ? data[i][nameCol] : '';
        Logger.log((dryRun ? '[תצוגה מקדימה] ' : '[שונה] ') + 'טאב "' + sheet.getName() + '", ' + name +
          ': "' + String(reply) + '" -> "' + filtered.join('\n') + '"');
        if (!dryRun) sheet.getRange(i + 1, replyCol + 1).setValue(filtered.join('\n'));
        cleaned++;
      }
    }
  });

  Logger.log((dryRun ? 'תצוגה מקדימה: ' : 'בוצע בפועל: ') + cleaned + ' שורות ב"' + REPLY_HEADER + '" ' +
    (dryRun ? 'ישתנו אם תריצי את cleanupHistoricalButtonEchoes' : 'נוקו') + '.');
  return cleaned;
}

/** מריצים את זו קודם - לא נוגעת בגיליון, רק מראה מה היה משתנה. */
function previewCleanupHistoricalButtonEchoes() {
  return collectButtonEchoCleanup_(true);
}

/** מריצים את זו רק אחרי שבדקת את הפלט של הפונקציה הקודמת ואת מרוצה ממנו. */
function cleanupHistoricalButtonEchoes() {
  return collectButtonEchoCleanup_(false);
}

/**
 * כלי חד-פעמי: מתקנת את עמודת "טלפון נייד" בכל טאבי הקמפיינים לפורמט
 * אחיד "05X-XXXXXXX" (ר' normalizePhoneValue_) - כדי שפרלה תמיד תוכל
 * לחייג, בלי קשר לאיך הלקוח שלח את המספר במקור. שורות עתידיות (הוספה
 * מהדשבורד/לידים מ-Wix) מתוקנות אוטומטית כבר ב-addContactRow_ - הכלי
 * הזה רק לניקוי מה שכבר קיים בגיליון. נוגעת אך ורק במספרים שמזוהים
 * בבירור כמספר ישראלי תקין - מספר בפורמט לא ברור נשאר כמו שהוא (מודפס
 * ליומן כ"לא זוהה"), לא מנוחש/משובש.
 *
 * מריצים קודם את previewNormalizePhoneNumbers() (לא נוגעת בכלום) ורק
 * אחר כך את normalizePhoneNumbers() שבאמת כותבת לגיליון.
 */
function collectPhoneNormalization_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);
  let changed = 0;
  let unrecognized = 0;

  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
    const nameCol = findColumnNormalized_(headers, NAME_HEADER);
    if (phoneCol === -1) return;

    if (!dryRun) sheet.getRange(2, phoneCol + 1, data.length - 1, 1).setNumberFormat('@');

    for (let i = 1; i < data.length; i++) {
      const raw = data[i][phoneCol];
      if (!raw) continue;
      const name = nameCol !== -1 ? data[i][nameCol] : '';
      const normalized = normalizePhoneValue_(raw);

      if (!normalized) {
        Logger.log('[לא זוהה - לא שונה] טאב "' + sheet.getName() + '", ' + name + ': "' + raw + '"');
        unrecognized++;
        continue;
      }
      if (String(raw).trim() === normalized) continue;

      if (dryRun) {
        Logger.log('[תצוגה מקדימה] טאב "' + sheet.getName() + '", ' + name + ': "' + raw + '" -> "' + normalized + '"');
      } else {
        sheet.getRange(i + 1, phoneCol + 1).setValue(normalized);
      }
      changed++;
    }
  });

  Logger.log((dryRun ? 'תצוגה מקדימה: ' : 'בוצע בפועל: ') + changed + ' מספרים ' +
    (dryRun ? 'ישתנו אם תריצי את normalizePhoneNumbers' : 'תוקנו') +
    '. ' + unrecognized + ' מספרים לא זוהו בבירור ולא נגעו בהם (ר\' פירוט למעלה ביומן).');
  return changed;
}

/** מריצים את זו קודם - לא נוגעת בגיליון, רק מראה מה היה משתנה. */
function previewNormalizePhoneNumbers() {
  return collectPhoneNormalization_(true);
}

/** מריצים את זו רק אחרי שבדקת את הפלט של הפונקציה הקודמת ואת מרוצה ממנו. */
function normalizePhoneNumbers() {
  return collectPhoneNormalization_(false);
}

/**
 * כלי חד-פעמי: מנקה נתוני פרלה היסטוריים שנכתבו **לפני** התיקון ל-
 * handleNlpearlWebhook_ (שמונע כתיבת קודי סטטוס מספריים לא קריאים כמו
 * "סטטוס: 5"). מסירה מ"סיכום שיחה" (המצטברת) כל שורה שהיא בדיוק "סטטוס:
 * N" בלי שום טקסט אמיתי לידה, ומעדכנת את "סטטוס שיחה" (הנדרסת) לשורה
 * הקריאה **האחרונה** שנשארת אחרי הניקוי - אם לא נשארה אף שורה קריאה
 * (השיחה מעולם לא קיבלה תגית/סיכום אמיתי מפרלה), משאירה אותה ריקה
 * במקום להמציא טקסט. לא נוגעת בשורות בלי בעיה כזו כלל.
 *
 * מריצים קודם את previewCleanupPearlNumericStatuses() (לא נוגעת בכלום)
 * ורק אחר כך את cleanupPearlNumericStatuses() שבאמת כותבת לגיליון.
 */
function collectPearlNumericCleanup_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);
  const NUMERIC_ONLY_RE = /^סטטוס: \d+$/;
  let changed = 0;

  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const nameCol = findColumnNormalized_(headers, NAME_HEADER);
    const resultCol = findHeaderIndex_(headers, CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY);
    const statusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
    if (resultCol === -1) return;

    for (let i = 1; i < data.length; i++) {
      const rawResult = String(data[i][resultCol] || '');
      if (!rawResult) continue;

      const lines = rawResult.split('\n');
      const cleanLines = lines.filter(function (line) { return !NUMERIC_ONLY_RE.test(line.trim()); });
      if (cleanLines.length === lines.length) continue; // אין כאן שום שורת "סטטוס: N" לנקות

      const newResult = cleanLines.join('\n');
      const newStatus = cleanLines.length ? cleanLines[cleanLines.length - 1] : '';
      const name = nameCol !== -1 ? data[i][nameCol] : '';

      if (dryRun) {
        Logger.log('[תצוגה מקדימה] טאב "' + sheet.getName() + '", ' + name +
          ': סיכום שיחה "' + rawResult + '" -> "' + newResult + '", סטטוס שיחה -> "' + newStatus + '"');
      } else {
        sheet.getRange(i + 1, resultCol + 1).setValue(newResult);
        if (statusCol !== -1) sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
      }
      changed++;
    }
  });

  Logger.log((dryRun ? 'תצוגה מקדימה: ' : 'בוצע בפועל: ') + changed + ' שורות ' +
    (dryRun ? 'ינוקו אם תריצי את cleanupPearlNumericStatuses' : 'נוקו') + '.');
  return changed;
}

/** מריצים את זו קודם - לא נוגעת בגיליון, רק מראה מה היה משתנה. */
function previewCleanupPearlNumericStatuses() {
  return collectPearlNumericCleanup_(true);
}

/** מריצים את זו רק אחרי שבדקת את הפלט של הפונקציה הקודמת ואת מרוצה ממנו. */
function cleanupPearlNumericStatuses() {
  return collectPearlNumericCleanup_(false);
}

/**
 * כלי חד-פעמי: מעגלת ב-AI (Gemini) שורות "סטטוס שיחה" היסטוריות שהערך
 * שלהן **לא** תואם בדיוק ערך מתוך "רשימת סטטוסים" (בין אם זה נרטיב ארוך
 * שפרלה כתבה, ובין אם זו תגית שהניסוח שלה קצת שונה מהרשימה) - לערך היחיד
 * הכי קרוב מהרשימה, כדי שהעמודה כולה תדבר באותה שפה סגורה. כותבת **רק**
 * ל"סטטוס שיחה" - "סיכום שיחה" (הטקסט המלא) לעולם לא נגעת. אם Gemini
 * נכשל/מחזירה ערך שלא נמצא ברשימה, השורה נשארת בדיוק כמו שהיתה (לא
 * נמחק/מומצא דבר). דורשת שהטאב "רשימת סטטוסים" כבר קיים - ר' setupStatusListSheet.
 *
 * מריצים קודם את previewDistillCallStatuses() (לא נוגעת בכלום) ורק אחר
 * כך את distillCallStatuses() שבאמת כותבת לגיליון.
 */
function collectDistillCallStatuses_(dryRun) {
  const statusList = getStatusList_();
  if (!statusList.length) {
    Logger.log('הטאב "' + STATUS_LIST_SHEET_NAME + '" עדיין ריק/לא קיים - יש להריץ קודם setupStatusListSheet() פעם אחת.');
    return 0;
  }
  const normalizedList = statusList.map(normalizeLabel_);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);
  let changed = 0;

  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const nameCol = findColumnNormalized_(headers, NAME_HEADER);
    const statusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
    if (statusCol === -1) return;

    for (let i = 1; i < data.length; i++) {
      const rawStatus = String(data[i][statusCol] || '');
      // מדלגים על: ערך שכבר תואם את הרשימה; "שיחה נשלחה" (placeholder
      // בלי תוצאה); וכל סטטוס-מערכת של פרלה ("לא ענה - ינוסה שוב" וכו',
      // ר' isPearlSystemStatus_) - אלה מצבי-חיוג מדויקים כמו שהם, ואין
      // מה "לעגל" אותם לתווית עסקית (AI היה ממציא ערך שרירותי).
      if (!rawStatus || isPearlSystemStatus_(rawStatus) || normalizedList.indexOf(normalizeLabel_(rawStatus)) !== -1) continue;

      const name = nameCol !== -1 ? data[i][nameCol] : '';

      if (dryRun) {
        Logger.log('[תצוגה מקדימה] טאב "' + sheet.getName() + '", ' + name +
          ': סטטוס שיחה לא ברשימה, יעוגל ל-AI: "' + rawStatus + '"');
        changed++;
      } else {
        // עד 3 ניסיונות עם השהייה גוברת (3, 8, 15 שניות) - בפועל נתקלנו
        // בהגבלת קצב (rate limit) של Gemini שמצטברת לאורך הרצה ארוכה עם
        // הרבה שורות ברצף; יותר ניסיונות + השהייה ארוכה יותר בין שורה
        // לשורה מצמצמים משמעותית את הצורך להריץ את הכלי שוב ושוב ידנית.
        const RETRY_DELAYS_MS_ = [3000, 8000, 15000];
        let matched = matchCallStatus_(rawStatus, statusList);
        for (let attempt = 0; attempt < RETRY_DELAYS_MS_.length && normalizeLabel_(matched) === normalizeLabel_(rawStatus); attempt++) {
          Utilities.sleep(RETRY_DELAYS_MS_[attempt]);
          matched = matchCallStatus_(rawStatus, statusList);
        }
        if (normalizeLabel_(matched) !== normalizeLabel_(rawStatus)) {
          sheet.getRange(i + 1, statusCol + 1).setValue(matched);
          Logger.log('טאב "' + sheet.getName() + '", ' + name + ': סטטוס שיחה עודכן -> "' + matched + '" (הטקסט המלא נשאר כמו שהיה בהערות פרלה)');
          changed++;
        } else {
          Logger.log('טאב "' + sheet.getName() + '", ' + name + ': לא הצלחתי לעגל (Gemini לא החזיר תשובה תואמת) - השורה נשארה כמו שהיתה, שום דבר לא נמחק. אפשר להריץ את distillCallStatuses שוב.');
        }
        Utilities.sleep(4000);
      }
    }
  });

  Logger.log((dryRun ? 'תצוגה מקדימה: ' : 'בוצע בפועל: ') + changed + ' שורות ' +
    (dryRun ? 'יעוגלו אם תריצי את distillCallStatuses' : 'עוגלו') + '.');
  return changed;
}

/** מריצים את זו קודם - לא נוגעת בגיליון, רק מראה מה היה משתנה. */
function previewDistillCallStatuses() {
  return collectDistillCallStatuses_(true);
}

/** מריצים את זו רק אחרי שבדקת את הפלט של הפונקציה הקודמת ואת מרוצה ממנו. */
function distillCallStatuses() {
  return collectDistillCallStatuses_(false);
}

/**
 * כלי אבחון חד-פעמי: מדפיסה ליומן הביצוע בדיוק מה הקוד רואה עבור מספר
 * טלפון נתון - שורת הכותרות המדויקת (עם מרכאות, כדי לחשוף רווחים
 * נסתרים), אינדקס העמודות שנמצאו, והערך הגולמי בפועל בתא. סורקת את כל
 * טאבי הקמפיין (לא רק אחד) כדי לגלות גם אם אותו מספר טלפון קיים
 * ביותר מטאב אחד. אין צורך לדעת את שם הטאב המדויק מראש.
 */
function debugContactByPhone(phone) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);
  let found_any = false;

  sheets.forEach(function (sheet) {
    const found = findRowByPhone_(sheet, phone);
    if (!found) return;
    found_any = true;

    Logger.log('=== טאב: "' + sheet.getName() + '" ===');
    Logger.log('כותרות (' + found.headers.length + ' עמודות): ' +
      found.headers.map(function (h) { return '"' + h + '"'; }).join(' | '));

    const firstReplyIdx = findColumnNormalized_(found.headers, FIRST_REPLY_HEADER);
    const notesIdx = findColumnNormalized_(found.headers, USER_NOTES_HEADER);
    const rowValues = sheet.getRange(found.rowIndex, 1, 1, found.headers.length).getValues()[0];

    Logger.log('"' + FIRST_REPLY_HEADER + '" - אינדקס: ' + firstReplyIdx +
      ', כותרת בפועל: "' + (firstReplyIdx !== -1 ? found.headers[firstReplyIdx] : '(לא נמצאה)') + '"' +
      ', ערך: "' + (firstReplyIdx !== -1 ? rowValues[firstReplyIdx] : '(אין עמודה)') + '"');
    Logger.log('"' + USER_NOTES_HEADER + '" - אינדקס: ' + notesIdx +
      ', כותרת בפועל: "' + (notesIdx !== -1 ? found.headers[notesIdx] : '(לא נמצאה)') + '"' +
      ', ערך: "' + (notesIdx !== -1 ? rowValues[notesIdx] : '(אין עמודה)') + '"');
  });

  if (!found_any) Logger.log('המספר ' + phone + ' לא נמצא באף טאב קמפיין.');
}

/**
 * עטיפה נוחה להרצה ישירה מהתפריט - מריצה את האבחון עבור Ishai Waisman.
 */
function debugIshai() {
  debugContactByPhone('532742755');
}

/**
 * כלי אבחון חד-פעמי: עבור **כל** טאב קמפיין, סופרת וכותבת ליומן בדיוק
 * אילו שורות (שם + טלפון) יש להן ערך באחת מעמודות פרלה (סטטוס שיחה/
 * תוצאות שיחה/מזהה ליד NLPearl) - כדי לדעת בוודאות (לא בניחוש) למה
 * עמודות "סטטוס פרלה"/"הערות פרלה" מוצגות או לא מוצגות בדשבורד לטאב
 * מסוים. לא נוגעת בכלום, רק קוראת.
 */
function debugPearlActivity() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getCampaignSheets_(ss);

  sheets.forEach(function (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const nameCol = findColumnNormalized_(headers, NAME_HEADER);
    const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
    const callStatusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
    const callResultCol = findHeaderIndex_(headers, CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY);
    const leadIdCol = findColumnNormalized_(headers, CALL_LEAD_ID_HEADER);

    const found = [];
    for (let i = 1; i < data.length; i++) {
      const status = callStatusCol !== -1 ? data[i][callStatusCol] : '';
      const result = callResultCol !== -1 ? data[i][callResultCol] : '';
      const leadId = leadIdCol !== -1 ? data[i][leadIdCol] : '';
      if (status || result || leadId) {
        const name = nameCol !== -1 ? data[i][nameCol] : '';
        const phone = phoneCol !== -1 ? data[i][phoneCol] : '';
        found.push(name + ' / ' + phone + ' - סטטוס שיחה: "' + status + '", תוצאות שיחה: "' + result + '", מזהה ליד: "' + leadId + '"');
      }
    }
    Logger.log('טאב "' + sheet.getName() + '" - ' + found.length + ' שורות עם נתוני פרלה' + (found.length ? ':\n' + found.join('\n') : ''));
  });
}

function validateTeamUser_(username) {
  if (TEAM_USERS_.indexOf(username) === -1) {
    throw new Error('שם משתמש לא מוכר: ' + username);
  }
}

/**
 * כותבת שורת יומן חדשה לעמודת "הערות משתמש" (המוצגת בדשבורד כ"הערות
 * מיטוב") - יומן הערות ידניות של הצוות בלבד (addUserNote/setUserStatus),
 * תמיד בראש הרשימה - החדש ביותר למעלה. בנוסף מעדכנת את "תאריך תשובה"
 * (מוצגת בדשבורד כ"תאריך") לרגע הזה, כדי שגם עדכון ידני ייחשב "פעילות
 * אחרונה" לצורך הדגשת שורות שהתעדכנו היום/מאז ההורדה האחרונה.
 */
function appendNoteEntry_(sheet, headers, rowIndex, notesCol, username, text) {
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  const entry = username + ' - ' + timestamp + ': ' + text;
  const existing = sheet.getRange(rowIndex, notesCol + 1).getValue();
  const combined = existing ? (entry + '\n' + existing) : entry;
  sheet.getRange(rowIndex, notesCol + 1).setValue(combined);

  const dateCol = findColumnNormalized_(headers, REPLY_DATE_HEADER);
  if (dateCol !== -1) sheet.getRange(rowIndex, dateCol + 1).setValue(now);
}

/**
 * מוסיפה הערה פנימית (CRM) לאיש קשר, מהדשבורד - בלי לפתוח את הגיליון.
 */
function addUserNote(sheetName, phone, username, noteText) {
  validateTeamUser_(username);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('הטאב "' + sheetName + '" לא נמצא');

  const found = findRowByPhone_(sheet, phone);
  if (!found) throw new Error('לא נמצא איש קשר עם הטלפון הזה בטאב');

  const notesCol = ensureColumn_(sheet, found.headers, USER_NOTES_HEADER);
  appendNoteEntry_(sheet, found.headers, found.rowIndex, notesCol, username, noteText);
  return { success: true };
}

/**
 * מעדכנת את "סטטוס איש קשר" - עמודה אחת מובילה שמתחילה עם הערך
 * האוטומטי (מה שהלקוח ענה בפועל, כמו "נשמח להיפגש") אבל ניתנת לדריסה
 * חופשית בכל עת ע"י הצוות (לא כמו הלחיצה האוטומטית על כפתור, שנכתבת רק
 * פעם אחת אם השדה ריק) - כדי שלא יהיו שתי עמודות סטטוס נפרדות ומבלבלות.
 * רושמת את השינוי אוטומטית גם ביומן ההערות (מי קבעה את הסטטוס ומתי).
 */
function setUserStatus(sheetName, phone, username, statusText) {
  validateTeamUser_(username);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('הטאב "' + sheetName + '" לא נמצא');

  const found = findRowByPhone_(sheet, phone);
  if (!found) throw new Error('לא נמצא איש קשר עם הטלפון הזה בטאב');

  const statusCol = ensureColumn_(sheet, found.headers, FIRST_REPLY_HEADER);
  sheet.getRange(found.rowIndex, statusCol + 1).setValue(statusText);

  const notesCol = ensureColumn_(sheet, found.headers, USER_NOTES_HEADER);
  appendNoteEntry_(sheet, found.headers, found.rowIndex, notesCol, username, 'עדכנה סטטוס ל: ' + statusText);
  return { success: true };
}

// ============================================================================
//                        הקצאת לידים לנציגות
// ============================================================================

/**
 * יוצרת (פעם אחת) את טאב "נציגות" עם קוד אישי אקראי לכל נציגה.
 * הקוד הוא מה שמופיע בלינק שלה (?rep=<קוד>) - לא השם, כדי שלא יהיה
 * אפשר לנחש לינק של נציגה אחרת פשוט ע"י שינוי הכתובת.
 * מריצים ידנית פעם אחת מהעורך. לא דורסת טאב קיים.
 */
function setupRepsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(REPS_SHEET_NAME);
  if (sheet && sheet.getLastRow() > 1) {
    Logger.log('הטאב "' + REPS_SHEET_NAME + '" כבר קיים ומכיל נתונים - לא נגעתי בו.');
    logRepLinks();
    return;
  }
  if (!sheet) sheet = ss.insertSheet(REPS_SHEET_NAME);

  const rows = DEFAULT_REPS_.map(function (name) {
    return [name, '', randomRepKey_(), 'כן'];
  });
  sheet.getRange(1, 1, 1, 4).setValues([['שם נציגה', 'אימייל', 'קוד אישי', 'פעילה']])
    .setFontWeight('bold').setBackground('#F3F4F6');
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 130);
  Logger.log('נוצר הטאב "' + REPS_SHEET_NAME + '" עם ' + rows.length + ' נציגות.');
  logRepLinks();
}

function randomRepKey_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/**
 * מדפיסה ללוג את הלינק האישי של כל נציגה - זה מה ששולחים לה פעם אחת
 * והיא נועצת בדפדפן. מריצים ידנית מהעורך בכל פעם שרוצים לראות אותם שוב.
 */
function logRepLinks() {
  const base = ScriptApp.getService().getUrl();
  activeReps_().forEach(function (rep) {
    Logger.log(rep.name + ': ' + base + '?rep=' + rep.key);
  });
}

/** כל הנציגות הפעילות: [{ name, email, key }]. ריק אם הטאב לא נוצר עדיין. */
function activeReps_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REPS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  return values
    .filter(function (r) {
      const active = String(r[3] || '').trim();
      // ברירת המחדל היא "פעילה" - רק "לא" מסתיר נציגה, כדי ששורה שנוספה
      // ידנית בלי למלא את העמודה תעבוד ולא תיעלם בשקט.
      return String(r[0] || '').trim() && normalizeLabel_(active) !== normalizeLabel_('לא');
    })
    .map(function (r) {
      return { name: String(r[0]).trim(), email: String(r[1] || '').trim(), key: String(r[2] || '').trim() };
    });
}

/**
 * הלינק האישי המלא של כל נציגה - מוצג בדשבורד עצמו (כפתור "לינקים
 * לנציגות") כדי שהלקוחה לא תצטרך להרכיב כתובות ידנית או לחפש ביומן
 * הביצוע של העורך. מחזירה גם נציגות שהושבתו, מסומנות ככאלה, כדי שלא
 * ייראה כאילו הלינק "נעלם".
 */
function getRepLinks() {
  const base = ScriptApp.getService().getUrl();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REPS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0] || '').trim(); })
    .map(function (r) {
      const key = String(r[2] || '').trim();
      return {
        name: String(r[0]).trim(),
        email: String(r[1] || '').trim(),
        key: key,
        link: key ? base + '?rep=' + encodeURIComponent(key) : '',
        active: normalizeLabel_(String(r[3] || '')) !== normalizeLabel_('לא')
      };
    });
}

/** שמות הנציגות בלבד - לתפריט "העבר ליד ל..." בדשבורד הראשי. */
function getRepNames() {
  return activeReps_().map(function (r) { return r.name; });
}

function repByKey_(key) {
  const wanted = String(key || '').trim();
  if (!wanted) return null;
  const matches = activeReps_().filter(function (r) { return r.key === wanted; });
  return matches.length ? matches[0] : null;
}

function repByName_(name) {
  const matches = activeReps_().filter(function (r) {
    return normalizeLabel_(r.name) === normalizeLabel_(name);
  });
  return matches.length ? matches[0] : null;
}

/** טאב "הקצאות" - נוצר אוטומטית בהקצאה הראשונה, אין צורך להריץ כלום. */
function assignSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ASSIGN_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ASSIGN_SHEET_NAME);
    sheet.getRange(1, 1, 1, ASSIGN_HEADERS_.length).setValues([ASSIGN_HEADERS_])
      .setFontWeight('bold').setBackground('#F3F4F6');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function assignRows_() {
  const sheet = assignSheet_();
  const lastRow = sheet.getLastRow();
  const headers = headerRow_(sheet);
  if (lastRow < 2) return { sheet: sheet, headers: headers, values: [] };
  return {
    sheet: sheet,
    headers: headers,
    values: sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
  };
}

function assignCol_(headers, name) {
  return findColumnNormalized_(headers, name);
}

function isDoneValue_(v) {
  const s = normalizeLabel_(v);
  return s === normalizeLabel_('כן') || s === 'true' || s === 'yes';
}

/**
 * מקצה ליד לנציגה. הליד נשמר כ**צילום מצב** - כולל כל התיעוד עד הרגע
 * הזה - כי לפי ההחלטה של הלקוחה הליד "סופי" ברגע ההעברה. עדיין שומרים
 * את הקמפיין+הטלפון כמצביע, כדי שנדע לאן להחזיר את הסטטוס בסיום.
 * ליד אחד = נציגה אחת: אם כבר יש לו הקצאה פתוחה, נזרקת שגיאה ברורה.
 */
function assignLead(sheetName, phone, repName) {
  const rep = repByName_(repName);
  if (!rep) throw new Error('נציגה לא מוכרת: ' + repName);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('הטאב "' + sheetName + '" לא נמצא');

  const found = findRowByPhone_(sheet, phone);
  if (!found) throw new Error('לא נמצא איש קשר עם הטלפון הזה בטאב');

  const open = openAssignmentFor_(sheetName, phone);
  if (open) {
    throw new Error('הליד כבר מוקצה ל' + open.rep + ' וטרם טופל. יש לסיים את הטיפול לפני העברה מחדש.');
  }

  const rowValues = sheet.getRange(found.rowIndex, 1, 1, found.headers.length).getValues()[0];
  const get_ = function (header, legacy) {
    const col = legacy ? findHeaderIndex_(found.headers, header, legacy)
                       : findColumnNormalized_(found.headers, header);
    return col !== -1 ? String(rowValues[col] || '') : '';
  };

  // התיעוד עובר יחד עם הליד - בלעדיו הנציגה מתקשרת בלי לדעת מה כבר
  // נאמר, וגם כפתור ה-AI לא יוכל לסכם כלום.
  const snapshot = [
    get_(USER_NOTES_HEADER),
    get_(REPLY_HEADER, REPLY_HEADER_LEGACY),
    get_(CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY)
  ].filter(function (s) { return !!s.trim(); }).join('\n');

  // דרך איזה ערוץ פנינו לליד - כדי שהנציגה תדע אם הוא כבר דיבר עם
  // פרלה או רק קיבל וואטסאפ, לפני שהיא מרימה טלפון.
  const channels = [];
  if (normalizeLabel_(get_(STATUS_HEADER, STATUS_HEADER_LEGACY)) === normalizeLabel_(SENT_STATUS) ||
      get_(REPLY_HEADER, REPLY_HEADER_LEGACY) || get_(FIRST_REPLY_HEADER)) {
    channels.push('וואטסאפ');
  }
  if (get_(CALL_LEAD_ID_HEADER) || get_(CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY) ||
      get_(CALL_STATUS_HEADER)) {
    channels.push('פרלה');
  }

  const assignSheet = assignSheet_();
  const id = 'A' + Date.now();
  assignSheet.appendRow([
    id,
    new Date(),
    rep.name,
    sheetName,
    String(phone),
    get_(COMPANY_HEADER),
    get_(NAME_HEADER),
    get_(TITLE_HEADER),
    get_(EMAIL_HEADER),
    channels.join(' + '),
    snapshot,
    'לא', '', '', ''
  ]);

  // מתעדים גם בשורת הליד עצמה, כדי שיהיה גלוי בדשבורד ובאקסל.
  const notesCol = ensureColumn_(sheet, found.headers, USER_NOTES_HEADER);
  appendNoteEntry_(sheet, found.headers, found.rowIndex, notesCol, 'מיטוב', 'הליד הועבר ל' + rep.name);

  notifyRepOfNewLead_(rep, get_(NAME_HEADER), get_(COMPANY_HEADER));
  return { success: true, rep: rep.name };
}

/** ההקצאה הפתוחה (לא טופלה) של ליד מסוים, או null. */
function openAssignmentFor_(sheetName, phone) {
  const data = assignRows_();
  const campCol = assignCol_(data.headers, 'קמפיין');
  const phoneCol = assignCol_(data.headers, 'טלפון נייד');
  const repCol = assignCol_(data.headers, 'נציגה');
  const doneCol = assignCol_(data.headers, 'טופל');
  const suffix = phoneSuffix_(phone);

  for (let i = 0; i < data.values.length; i++) {
    const row = data.values[i];
    if (isDoneValue_(row[doneCol])) continue;
    if (normalizeLabel_(row[campCol]) !== normalizeLabel_(sheetName)) continue;
    if (phoneSuffix_(row[phoneCol]) !== suffix) continue;
    return { rowIndex: i + 2, rep: String(row[repCol] || '') };
  }
  return null;
}

/** מייל לנציגה ברגע ההקצאה. כישלון במייל לעולם לא מפיל את ההקצאה עצמה. */
function notifyRepOfNewLead_(rep, leadName, company) {
  if (!rep.email) return;
  try {
    const link = ScriptApp.getService().getUrl() + '?rep=' + rep.key;
    MailApp.sendEmail({
      to: rep.email,
      subject: 'ליד חדש הועבר אלייך: ' + (leadName || ''),
      htmlBody: '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">' +
        '<p>היי ' + escapeHtmlServer_(rep.name) + ',</p>' +
        '<p>הועבר אלייך ליד חדש: <b>' + escapeHtmlServer_(leadName || '') + '</b>' +
        (company ? ' מ<b>' + escapeHtmlServer_(company) + '</b>' : '') + '</p>' +
        '<p><a href="' + link + '" style="background:#116dff;color:#fff;padding:10px 18px;' +
        'border-radius:8px;text-decoration:none;display:inline-block">פתיחת הלידים שלי</a></p>' +
        '</div>'
    });
  } catch (err) {
    Logger.log('שליחת מייל לנציגה נכשלה (ההקצאה עצמה בוצעה): ' + err.message);
  }
}

function escapeHtmlServer_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * מחזירה לדשבורד של הנציגה את הלידים שלה - הפתוחים והטופלו בנפרד.
 * מזוהה **רק** לפי הקוד האישי שבלינק; קוד לא מוכר מחזיר שגיאה ולא רשימה ריקה,
 * כדי שלא ייראה כאילו "אין לך לידים" כשבעצם הלינק שגוי.
 */
function getRepData(repKey) {
  const rep = repByKey_(repKey);
  if (!rep) throw new Error('לינק לא מזוהה. יש לפנות לטליה לקבלת לינק חדש.');

  const data = assignRows_();
  const H = data.headers;
  const idx = {
    id: assignCol_(H, 'מזהה הקצאה'), date: assignCol_(H, 'תאריך הקצאה'),
    rep: assignCol_(H, 'נציגה'), camp: assignCol_(H, 'קמפיין'),
    phone: assignCol_(H, 'טלפון נייד'), company: assignCol_(H, 'שם חברה'),
    name: assignCol_(H, 'איש קשר'), title: assignCol_(H, 'תפקיד'),
    email: assignCol_(H, 'אימייל'), channel: assignCol_(H, 'ערוץ'),
    snapshot: assignCol_(H, 'תיעוד בעת ההעברה'),
    done: assignCol_(H, 'טופל'), status: assignCol_(H, 'סטטוס שסומן'),
    note: assignCol_(H, 'הערת נציגה'), doneDate: assignCol_(H, 'תאריך טיפול')
  };

  const tz = Session.getScriptTimeZone();
  const fmt = function (v) {
    return (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'dd/MM/yyyy HH:mm') : '';
  };
  const ms = function (v) {
    return (v instanceof Date && !isNaN(v.getTime())) ? v.getTime() : 0;
  };

  const open = [], done = [];
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  let doneToday = 0;

  data.values.forEach(function (row) {
    if (normalizeLabel_(row[idx.rep]) !== normalizeLabel_(rep.name)) return;
    const item = {
      id: String(row[idx.id] || ''),
      assignedAt: fmt(row[idx.date]),
      assignedAtMs: ms(row[idx.date]),
      campaign: String(row[idx.camp] || ''),
      phone: String(row[idx.phone] || ''),
      company: String(row[idx.company] || ''),
      name: String(row[idx.name] || ''),
      title: String(row[idx.title] || ''),
      email: String(row[idx.email] || ''),
      // idx.channel === -1 בטאב "הקצאות" שנוצר לפני שהעמודה נוספה -
      // מוחזר ריק ופשוט לא מוצג אייקון, בלי לשבור כלום.
      channel: idx.channel !== -1 ? String(row[idx.channel] || '') : '',
      history: String(row[idx.snapshot] || ''),
      status: String(row[idx.status] || ''),
      note: String(row[idx.note] || ''),
      doneAt: fmt(row[idx.doneDate])
    };
    if (isDoneValue_(row[idx.done])) {
      done.push(item);
      const d = row[idx.doneDate];
      if (d instanceof Date && !isNaN(d.getTime()) && d.getTime() >= todayMidnight.getTime()) doneToday++;
    } else {
      open.push(item);
    }
  });

  open.sort(function (a, b) { return b.assignedAtMs - a.assignedAtMs; });
  done.sort(function (a, b) { return b.assignedAtMs - a.assignedAtMs; });

  return {
    repName: rep.name,
    open: open,
    done: done,
    doneToday: doneToday,
    doneTotal: done.length,
    quickStatuses: REP_QUICK_STATUSES_,
    celebrateStatus: REP_CELEBRATE_STATUS_,
    statusList: getStatusList_()
  };
}

/**
 * הנציגה סימנה "סיימתי לטפל" ובחרה סטטוס.
 * שני דברים קורים: ההקצאה נסגרת אצלה, **והסטטוס נכתב חזרה** לשורת הליד
 * בטאב הקמפיין ("סטטוס איש קשר") + נרשם ביומן ההערות - כך שאצל הלקוחה
 * זה מופיע בדשבורד ובאקסל בלי שתצטרך לעשות כלום.
 */
function completeAssignment(repKey, assignmentId, statusText, noteText) {
  const rep = repByKey_(repKey);
  if (!rep) throw new Error('לינק לא מזוהה');
  if (!statusText) throw new Error('יש לבחור סטטוס');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = assignRows_();
    const H = data.headers;
    const idCol = assignCol_(H, 'מזהה הקצאה');
    const repCol = assignCol_(H, 'נציגה');
    const doneCol = assignCol_(H, 'טופל');
    const statusCol = assignCol_(H, 'סטטוס שסומן');
    const noteCol = assignCol_(H, 'הערת נציגה');
    const dateCol = assignCol_(H, 'תאריך טיפול');
    const campCol = assignCol_(H, 'קמפיין');
    const phoneCol = assignCol_(H, 'טלפון נייד');

    for (let i = 0; i < data.values.length; i++) {
      const row = data.values[i];
      if (String(row[idCol]) !== String(assignmentId)) continue;
      if (normalizeLabel_(row[repCol]) !== normalizeLabel_(rep.name)) {
        throw new Error('ההקצאה הזו שייכת לנציגה אחרת');
      }
      if (isDoneValue_(row[doneCol])) return { success: true, alreadyDone: true };

      const rowIndex = i + 2;
      data.sheet.getRange(rowIndex, doneCol + 1).setValue('כן');
      data.sheet.getRange(rowIndex, statusCol + 1).setValue(statusText);
      data.sheet.getRange(rowIndex, noteCol + 1).setValue(noteText || '');
      data.sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());

      writeBackRepStatus_(String(row[campCol]), String(row[phoneCol]), rep.name, statusText, noteText);
      return {
        success: true,
        celebrate: normalizeLabel_(statusText) === normalizeLabel_(REP_CELEBRATE_STATUS_)
      };
    }
    throw new Error('ההקצאה לא נמצאה');
  } finally {
    lock.releaseLock();
  }
}

/**
 * כותבת את הסטטוס שהנציגה בחרה חזרה לשורת הליד בטאב הקמפיין.
 * נכשלת בשקט (עם לוג) ולא מפילה את סגירת ההקצאה - אם הטאב נמחק או השורה
 * הוסרה, עדיף שהנציגה תסיים את הטיפול מאשר שתיתקע מול שגיאה.
 */
function writeBackRepStatus_(sheetName, phone, repName, statusText, noteText) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const found = findRowByPhone_(sheet, phone);
    if (!found) return;

    const statusCol = ensureColumn_(sheet, found.headers, FIRST_REPLY_HEADER);
    sheet.getRange(found.rowIndex, statusCol + 1).setValue(statusText);

    const notesCol = ensureColumn_(sheet, found.headers, USER_NOTES_HEADER);
    const text = 'סיימה לטפל · סטטוס: ' + statusText + (noteText ? ' · ' + noteText : '');
    appendNoteEntry_(sheet, found.headers, found.rowIndex, notesCol, repName, text);
  } catch (err) {
    Logger.log('כתיבת הסטטוס חזרה לטאב הקמפיין נכשלה: ' + err.message);
  }
}

/** מפה של טלפון -> שם הנציגה שהליד מוקצה לה כרגע (פתוח בלבד). */
function openAssignmentsByPhone_() {
  const data = assignRows_();
  const map = {};
  if (!data.values.length) return map;
  const phoneCol = assignCol_(data.headers, 'טלפון נייד');
  const repCol = assignCol_(data.headers, 'נציגה');
  const doneCol = assignCol_(data.headers, 'טופל');
  data.values.forEach(function (row) {
    if (isDoneValue_(row[doneCol])) return;
    map[phoneSuffix_(row[phoneCol])] = String(row[repCol] || '');
  });
  return map;
}

/** ספירת לידים פתוחים/סה"כ לכל נציגה - לסרגל הצד של הדשבורד הראשי. */
function repWorkload_() {
  const data = assignRows_();
  const repCol = assignCol_(data.headers, 'נציגה');
  const doneCol = assignCol_(data.headers, 'טופל');
  const counts = {};
  activeReps_().forEach(function (r) { counts[r.name] = { name: r.name, open: 0, total: 0 }; });
  data.values.forEach(function (row) {
    const name = String(row[repCol] || '').trim();
    if (!name) return;
    if (!counts[name]) counts[name] = { name: name, open: 0, total: 0 };
    counts[name].total++;
    if (!isDoneValue_(row[doneCol])) counts[name].open++;
  });
  return Object.keys(counts).map(function (k) { return counts[k]; });
}

/**
 * מועד ההורדה הקודמת של קובץ האקסל לקמפיין הזה (ISO string), או null אם
 * מעולם לא הורד. משמש את getCampaignData כדי לסמן שורות שהתעדכנו מאז.
 */
function lastExportTime_(sheetName) {
  return PropertiesService.getScriptProperties().getProperty('LAST_EXPORT_' + sheetName) || null;
}

/**
 * נקראת מהדשבורד בכל פעם שלוחצים "ייצוא לאקסל" - שומרת את הרגע הזה,
 * כדי שבפעם הבאה נדע לסמן מה השתנה מאז.
 */
function recordExportTime(sheetName) {
  PropertiesService.getScriptProperties().setProperty('LAST_EXPORT_' + sheetName, new Date().toISOString());
}

/**
 * גיליון "ייצוא זמני" אחד קבוע (לא נוצר/נמחק בכל ייצוא - למחיקת קובץ נדרשת
 * הרשאת Drive רחבה שלא מאושרת בפרויקט הזה). ה-ID נשמר ב-Script Properties;
 * בכל ייצוא נעשה שימוש חוזר באותו קובץ, ומנקים את תוכנו לפני כתיבה מחדש.
 * הקובץ הזה הוא תשתית פנימית בלבד - אין למחוק אותו ידנית מה-Drive.
 */
function getOrCreateExportSheet_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('EXPORT_TEMP_SS_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      // הקובץ נמחק/לא נגיש - ניצור אחד חדש במקומו.
    }
  }
  const created = SpreadsheetApp.create('ייצוא זמני - תשתית פנימית של הדשבורד (נא לא למחוק)');
  props.setProperty('EXPORT_TEMP_SS_ID', created.getId());
  return created;
}

/**
 * קובע כיווניות מימין-לשמאל לגיליון - גיליון שנוצר עם SpreadsheetApp.create
 * ברירת המחדל שלו LTR (משמאל לימין), ואין ל-SpreadsheetApp פונקציה ישירה
 * לשנות זאת. דורש הפעלת שירות מתקדם (ר' הודעת השגיאה אם לא מופעל):
 * בעורך הסקריפטים - "שירותים" (Services, ה-"+" בתפריט הצד) -> להוסיף
 * "Google Sheets API" (זה מפעיל את זה אוטומטית, בלי לצאת ל-Cloud Console).
 */
function setSheetRtl_(spreadsheetId, sheetId) {
  try {
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: sheetId, rightToLeft: true },
          fields: 'rightToLeft'
        }
      }]
    }, spreadsheetId);
  } catch (e) {
    throw new Error('כדי שהאקסל ייצא מימין-לשמאל צריך להוסיף שירות בעורך הסקריפטים: ' +
      'משמאל, ליד "שירותים" (Services) ללחוץ על ה-"+", לבחור "Google Sheets API" וללחוץ הוסף. ' +
      'שגיאה מקורית: ' + e.message);
  }
}

/**
 * מייצרת קובץ אקסל (xlsx) אמיתי מהשורות שכבר סוננו בדשבורד (headers + rows
 * מגיעים מהלקוח - כדי שהייצוא יכבד בדיוק את מה שמסונן על המסך). בעבר הקובץ
 * שהורד היה טבלת HTML "מחופשת" ל-xls, ואצל חלק ממשתמשות אקסל זה גרם לתאים
 * להיראות "ממוזגים" וחסם סינון (Data > Filter). כאן במקום זה נכתבים הנתונים
 * לגיליון זמני (getOrCreateExportSheet_) כתאים אמיתיים, ואז הוא מיוצא
 * ל-xlsx אמיתי דרך ה-export endpoint של גוגל דוקס (עם טוקן ה-OAuth של
 * הסקריפט עצמו). מחזירה בסיס-64 של קובץ ה-xlsx, שהלקוח הופך ל-Blob ומוריד.
 */
function exportCampaignExcel(sheetName, headers, rows) {
  const tempSs = getOrCreateExportSheet_();
  const sheet = tempSs.getSheets()[0];
  sheet.clear();
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  const numCols = headers.length;
  const numRows = rows.length;

  sheet.getRange(1, 1, 1, numCols).setValues([headers]);
  sheet.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#F3F4F6');

  if (numRows > 0) {
    // עמודת הטלפון - setNumberFormat('@') לבדו לא מספיק כשכותבים ערך
    // שה-JS רואה כ-Number: הגיליון עדיין שומר אותו כמספר, ובאקסל זה מוצג
    // ב"כתיב מדעי" (למשל 972544701930 -> 9.72544E+11). גרש מוביל (')
    // מכריח פירוש כטקסט, ממש כמו הקלדה ידנית בגיליון.
    // האינדקס נמצא לפי **שם הכותרת** ולא מקובע - סדר העמודות בייצוא
    // משתנה מדי פעם לפי בקשות הלקוחה, ואינדקס קשיח נשבר בשקט בכל שינוי כזה.
    const PHONE_COL_INDEX = (function () {
      for (let i = 0; i < headers.length; i++) {
        const h = normalizeLabel_(headers[i]);
        if (h === normalizeLabel_(PHONE_HEADER) || h === normalizeLabel_('נייד')) return i;
      }
      return -1;
    })();
    const values = rows.map(function (r) {
      return r.values.map(function (v, idx) {
        if (idx === PHONE_COL_INDEX && v !== '' && v !== null && v !== undefined) {
          return "'" + String(v);
        }
        return v;
      });
    });
    const dataRange = sheet.getRange(2, 1, numRows, numCols);
    dataRange.setNumberFormat('@'); // כל התאים כטקסט - מונע "מספר מדעי" בטלפונים ותאריכים שמתפרשים לא נכון
    dataRange.setValues(values);

    // שתי רמות הדגשה: צהוב = התעדכן היום (מנצח), ירוק חלש = התעדכן מאז
    // ההורדה הקודמת של האקסל (אבל לא בהכרח היום) - ר' updatedToday/
    // recentlyUpdated ב-getCampaignData.
    rows.forEach(function (r, i) {
      if (r.updatedToday) sheet.getRange(i + 2, 1, 1, numCols).setBackground('#FEF3C7');
      else if (r.recentlyUpdated) sheet.getRange(i + 2, 1, 1, numCols).setBackground('#DCFCE7');
    });
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, numRows + 1, numCols).createFilter();
  for (let c = 1; c <= numCols; c++) sheet.autoResizeColumn(c);
  setSheetRtl_(tempSs.getId(), sheet.getSheetId());
  SpreadsheetApp.flush();

  const fileId = tempSs.getId();
  const url = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  return Utilities.base64Encode(response.getBlob().getBytes());
}

/**
 * מסכמת ב-AI (Google Gemini) את ההתכתבות בפועל עם הליד - היסטוריית
 * וואטסאפ + היסטוריית שיחות (לא הערות הצוות הפנימיות) - למספר משפטים
 * קצרים, כדי לדעת במבט אחד על מה מדובר בלי לקרוא את כל השרשור. בנוסף
 * מבקשת מ-Gemini טיפ מכירה ממוקד (sales_tip) - Gemini מתבקש להחזיר
 * JSON מובנה (responseMimeType), ומחזירה לדשבורד { summary, salesTip }.
 * דורש GEMINI_API_KEY ב-Script Properties (מ-aistudio.google.com).
 */
function summarizeContact(sheetName, phone) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('חסר מפתח GEMINI_API_KEY ב-Script Properties (Project Settings)');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('הטאב "' + sheetName + '" לא נמצא');

  const found = findRowByPhone_(sheet, phone);
  if (!found) throw new Error('לא נמצא איש קשר עם הטלפון הזה בטאב');

  const rowValues = sheet.getRange(found.rowIndex, 1, 1, found.headers.length).getValues()[0];
  const get_ = function (header) {
    const col = findColumnNormalized_(found.headers, header);
    return col !== -1 ? rowValues[col] : '';
  };

  const name = get_(NAME_HEADER);
  const whatsappHistory = get_(REPLY_HEADER) || get_(REPLY_HEADER_LEGACY);
  const callHistory = get_(CALL_RESULT_HEADER) || get_(CALL_RESULT_HEADER_LEGACY);

  if (!whatsappHistory && !callHistory) {
    throw new Error('אין עדיין שיחה עם הליד הזה לסכם');
  }

  return geminiSummarize_(name, whatsappHistory, callHistory);
}

/**
 * הקריאה בפועל ל-Gemini - משותפת לדשבורד הראשי (summarizeContact) ולדשבורד
 * הנציגה (getRepAiSummary), כדי שהסיכום והטיפ יהיו זהים בשני המקומות.
 */
function geminiSummarize_(name, whatsappHistory, callHistory) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('חסר מפתח GEMINI_API_KEY ב-Script Properties (Project Settings)');
  }

  const prompt = `
You are an expert sales strategist and psychologist. Analyze the following lead details, WhatsApp history, and call history.

Your goal is to extract two things:
1. A concise summary of the conversation history in Hebrew.
2. A golden, juicy sales insight/tip for the sales representative (in Hebrew) that helps maximize the closing rate.

Look for hidden clues between the lines:
- If the contact says "not right now", translate that into the underlying motivation (e.g., "They are hesitant but interested, give them a strong push").
- Analyze the company profile based on the text/domain (e.g., "Note: This is a global corporation, long closing cycles" or "High budget potential, likes end-of-year spending").
- Keep the sales tip punchy, direct, and actionable, starting with words like "שימי לב:" or "טיפ זהב:".

You must respond ONLY with a valid JSON object matching this structure:
{
  "summary": "הסיכום של השיחה כאן...",
  "sales_tip": "הטיפ העסיסי והממוקד לנציגה כאן..."
}

Lead Information:
${name ? 'Name: ' + name + '\n' : ''}
${whatsappHistory ? 'WhatsApp History:\n' + whatsappHistory + '\n' : ''}
${callHistory ? 'Call History:\n' + callHistory + '\n' : ''}
`;

  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  const rawText = result.candidates && result.candidates[0] && result.candidates[0].content &&
    result.candidates[0].content.parts && result.candidates[0].content.parts[0] &&
    result.candidates[0].content.parts[0].text;

  if (!rawText) {
    throw new Error('לא התקבל סיכום מ-Gemini: ' + response.getContentText());
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new Error('Gemini החזיר תשובה שאינה JSON תקין: ' + rawText);
  }

  return {
    summary: (parsed.summary || '').trim(),
    salesTip: (parsed.sales_tip || '').trim()
  };
}

/**
 * אותו סיכום AI, לנציגה - אבל על **צילום המצב** שנשמר בהקצאה ולא על
 * שורת הקמפיין החיה, כי אצל הנציגה הליד קפוא מרגע ההעברה.
 * התוצאה נשמרת בשורת ההקצאה: לחיצה חוזרת מחזירה את מה שכבר נוצר, בלי
 * קריאה נוספת ל-Gemini (מהיר יותר לנציגה, וזול יותר ככל שיש יותר נציגות).
 */
function getRepAiSummary(repKey, assignmentId) {
  const rep = repByKey_(repKey);
  if (!rep) throw new Error('לינק לא מזוהה');

  const data = assignRows_();
  const H = data.headers;
  const idCol = assignCol_(H, 'מזהה הקצאה');
  const repCol = assignCol_(H, 'נציגה');
  const snapCol = assignCol_(H, 'תיעוד בעת ההעברה');
  const nameCol = assignCol_(H, 'איש קשר');

  for (let i = 0; i < data.values.length; i++) {
    const row = data.values[i];
    if (String(row[idCol]) !== String(assignmentId)) continue;
    if (normalizeLabel_(row[repCol]) !== normalizeLabel_(rep.name)) {
      throw new Error('ההקצאה הזו שייכת לנציגה אחרת');
    }

    const cacheCol = ensureColumn_(data.sheet, H, 'סיכום AI');
    const cached = data.sheet.getRange(i + 2, cacheCol + 1).getValue();
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* מטמון פגום - ניצור מחדש */ }
    }

    const history = String(row[snapCol] || '').trim();
    if (!history) throw new Error('אין תיעוד שיחה לסכם עבור הליד הזה');

    const result = geminiSummarize_(String(row[nameCol] || ''), history, '');
    data.sheet.getRange(i + 2, cacheCol + 1).setValue(JSON.stringify(result));
    return result;
  }
  throw new Error('ההקצאה לא נמצאה');
}

function classifyStatus_(value) {
  if (!value) return 'pending';
  if (String(value).indexOf('שגיאה') === 0) return 'bad';
  return 'good';
}

/**
 * בודק אם תאריך נתון (אובייקט Date מהגיליון) חל היום, לפי לוח השנה של
 * אזור הזמן של הסקריפט.
 */
function isToday_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

/**
 * כמה ימים עברו מאז שהקמפיין (הטאב) הופעל לראשונה (ראו recordCampaignStart_).
 * מחזיר null אם הקמפיין עדיין לא רץ אף פעם.
 */
function daysActive_(sheetName) {
  const startIso = PropertiesService.getScriptProperties().getProperty('CAMPAIGN_START_' + sheetName);
  if (!startIso) return null;
  const start = new Date(startIso);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - start.getTime()) / msPerDay) + 1;
}

/**
 * קוראת טאב אופציונלי "צבעי סטטוס" (אם קיים) - כדי שהלקוחה תוכל לשלוט
 * בעצמה על צבע הסטטוסים בדשבורד, בלי לגעת בקוד: עמודה א' = טקסט הסטטוס
 * (בדיוק כמו שהוא כתוב בפועל בעמודת "סטטוס"), עמודה ב' = הצבע - נלקח
 * מצבע הרקע של התא עצמו, שאותו צובעים עם כלי הצביעה הרגיל של הגיליון
 * (בדיוק כמו ה-Indicator Tags שלה בפרלה) - לא מקלידים קוד צבע. תא בעמודה
 * ב' בלי צבע רקע (לבן/ריק) מתעלם ממנו - הסטטוס ימשיך לקבל את הצבע
 * האוטומטי הרגיל. קוראת **מהשורה הראשונה** (אין הנחה של שורת כותרת -
 * אפשר להתחיל להקליד ישר מהשורה הראשונה; אם כן מוסיפים בעתיד כותרת
 * כמו "סטטוס"/"צבע", היא פשוט תתעלם ממנה כי אין לה צבע רקע). אם הטאב
 * לא קיים בכלל, מחזירה אובייקט ריק.
 */
function getStatusColors_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STATUS_COLORS_SHEET_NAME);
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return {};

  const statuses = sheet.getRange(1, 1, lastRow, 1).getValues();
  const backgrounds = sheet.getRange(1, 2, lastRow, 1).getBackgrounds();
  const colors = {};
  for (let i = 0; i < statuses.length; i++) {
    const status = String(statuses[i][0] || '').trim();
    const color = backgrounds[i][0];
    // מפתח מנורמל (findColumnNormalized_/normalizeLabel_) - כדי שרווח
    // נסתר/גרש/רישיות בטאב "צבעי סטטוס" לא ישברו את ההתאמה בשקט, בדיוק
    // כמו כותרות עמודות בשאר הקוד.
    if (status && color && color.toLowerCase() !== '#ffffff') colors[normalizeLabel_(status)] = color;
  }
  return colors;
}

/**
 * קוראת את הרשימה הסגורה של "רשימת סטטוסים" (טאב שהלקוחה שולטת בו
 * ישירות, כמו "צבעי סטטוס") - עמודה A, ללא הנחת שורת כותרת (מאותה
 * סיבה כמו getStatusColors_ - לא להניח שיש כותרת). מחזירה [] אם הטאב
 * עדיין לא נוצר (ר' setupStatusListSheet) - כל תלוי-רשימה (matchCallStatus_
 * וכו') חייב להתנהג בביטחון גם כשזה ריק.
 */
function getStatusList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STATUS_LIST_SHEET_NAME);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  return sheet.getRange(1, 1, lastRow, 1).getValues()
    .map(function (r) { return String(r[0] || '').trim(); })
    .filter(function (s) { return !!s; });
}

/**
 * יוצרת את טאב "רשימת סטטוסים" ומזריעה אותה ברשימה שהלקוחה נתנה
 * (DEFAULT_STATUS_LIST_) - **פעם אחת בלבד**, כשהטאב עוד לא קיים או ריק
 * לגמרי. אם כבר יש בו ערכים (הלקוחה כבר ערכה אותו), לא נוגעת בכלל -
 * לעולם לא דורסת עריכה ידנית קיימת. מריצים ידנית פעם אחת מהעורך.
 */
function setupStatusListSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STATUS_LIST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATUS_LIST_SHEET_NAME);
  } else if (sheet.getLastRow() > 0) {
    Logger.log('הטאב "' + STATUS_LIST_SHEET_NAME + '" כבר קיים ומכיל נתונים - לא נגעתי בו.');
    return;
  }
  sheet.getRange(1, 1, DEFAULT_STATUS_LIST_.length, 1)
    .setValues(DEFAULT_STATUS_LIST_.map(function (s) { return [s]; }));
  // עמודה B - "פתוח להתקשרות חוזרת" - תיבות סימון (checkbox) שהלקוחה
  // עצמה מסמנת ✓ ליד כל סטטוס שנחשב "עדיין פתוח" (לא ענה/ממתין/ביקש
  // שנחזור וכו') - לא ניחוש שלי, כי אין לי דרך לדעת מה נכון עסקית.
  const openRange = sheet.getRange(1, 2, DEFAULT_STATUS_LIST_.length, 1);
  openRange.insertCheckboxes();
  openRange.setValue(false);
  sheet.getRange(1, 3).setValue('← סמני כאן ✓ לכל סטטוס "פתוח" שצריך להתקשר אליו שוב אוטומטית');
  Logger.log('הטאב "' + STATUS_LIST_SHEET_NAME + '" נוצר והוזרע ב-' + DEFAULT_STATUS_LIST_.length + ' סטטוסים.');
}

/**
 * מוסיפה ערך חדש ל"רשימת סטטוסים" אם הוא עוד לא קיים בה (השוואה מנורמלת,
 * כמו כל התאמת טקסט אחרת בקוד הזה) - נקראת מ-handleInforuWebhook_ כשליד
 * לוחץ על כפתור וואטסאפ חדש שלא הוגדר מראש. לא נוגעת בטאב אם הוא עדיין
 * לא נוצר (setupStatusListSheet לא רץ) - כדי לא ליצור טאב לא-מתוכנן.
 */
function addStatusIfMissing_(text) {
  if (!text) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STATUS_LIST_SHEET_NAME);
  if (!sheet) return;

  const existing = getStatusList_();
  const normalized = normalizeLabel_(text);
  if (existing.some(function (s) { return normalizeLabel_(s) === normalized; })) return;

  sheet.getRange(sheet.getLastRow() + 1, 1).setValue(text);
}

/**
 * "מעגלת" טקסט חופשי (תגית ישירה מפרלה, או נרטיב ארוך) לערך היחיד
 * הכי מתאים מתוך "רשימת סטטוסים" - כדי ש"סטטוס שיחה" תמיד ידבר באותה
 * שפה בדיוק כמו "סטטוס איש קשר" (בקשת הלקוחה: "יתעגלו לערך הכי קרוב").
 * אם עדיין אין רשימה מוגדרת (הטאב לא נוצר) - מחזירה את הטקסט המקורי
 * כמו שהוא, בלי לנסות לעגל (שום דבר לעיגול). אם ל-AI אין מפתח/יש כשל/
 * מחזיר ערך שלא נמצא ברשימה בדיוק - נופלת בחזרה לטקסט המקורי, לעולם לא
 * זורקת שגיאה ולעולם לא ממציאה ערך שלא ברשימה.
 */
/**
 * חמשת המצבים שהלקוחה הגדירה, לפי **מה שקרה בשיחה** - לא לפי הקוד
 * המספרי של פרלה (הקוד לא מבחין בין "ניתק לי" ל"ביקש שנחזור מחר";
 * שניהם 110 אצלה). הסדר קריטי: "לא מעוניין" נבדק לפני "מעוניין",
 * ו"מועד מאוחר יותר" לפני "ליד", אחרת ביטוי מוכל היה גובר.
 */
const CALL_OUTCOME_RULES_ = [
  { status: 'לא מעוניין', words: ['לא מעוניין', 'לא מעונין', 'לא רלוונטי', 'לא רוצה', 'ניתק',
      'סגר את הטלפון', 'להסיר', 'אל תתקשר', 'לא לפנות', 'מרוצה מהספק', 'יש לנו ספק'] },
  { status: 'תואמה פגישה', words: ['פגישה', 'ניפגש', 'נפגש', 'זימון', 'תואמה', 'קבע תאריך',
      'נקבע ל', 'ביומן'] },
  { status: 'בתהליך', words: ['מאוחר יותר', 'בהמשך', 'בשבוע הבא', 'בחודש הבא', 'רבעון',
      'לחזור בעוד', 'נחזור בעוד', 'עסוק כרגע', 'בפגישה כרגע', 'בנהיגה', 'תתקשרו ב'] },
  { status: 'ליד הועבר ללקוח', words: ['שנחזור אליו', 'לחזור אליו', 'שיחזרו אליו', 'נציגה',
      'נציג אנושי', 'השאיר פרטים', 'מעוניין', 'מעונין', 'מתעניין', 'ביקש חומר', 'ביקש מידע',
      'הצעת מחיר', 'ביקש הצעה', 'רוצה לשמוע'] },
  { status: 'אין מענה', words: ['לא ענה', 'אין מענה', 'תא קולי', 'הודעה קולית', 'נותק לפני',
      'לא זמין', 'המספר תפוס'] }
];

/**
 * סיווג מהיר לפי מילות מפתח - רץ **לפני** ה-AI: הוא דטרמיניסטי, מיידי,
 * לא עולה כלום ולא נחשף למגבלות קצב. ה-AI נכנס רק כשזה לא הכריע.
 */
function classifyCallOutcome_(text) {
  const normalized = normalizeLabel_(text);
  if (!normalized) return '';
  for (let i = 0; i < CALL_OUTCOME_RULES_.length; i++) {
    const rule = CALL_OUTCOME_RULES_[i];
    for (let j = 0; j < rule.words.length; j++) {
      if (normalized.indexOf(normalizeLabel_(rule.words[j])) !== -1) return rule.status;
    }
  }
  return '';
}

function matchCallStatus_(text, statusList) {
  if (!text) return '';

  // קודם כל הכללים של הלקוחה - רק אם הסטטוס שיצא באמת קיים ברשימה שלה.
  const byRule = classifyCallOutcome_(text);
  if (byRule && isAllowedStatusValue_(byRule, statusList)) return byRule;

  if (!statusList || !statusList.length) return text;

  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return text;

    const prompt = 'להלן רשימה סגורה של סטטוסים אפשריים, ותקציר של שיחת מכירה. ' +
      'בחרי בדיוק ערך אחד מהרשימה שהכי מתאים, והחזירי אותו בדיוק כפי שהוא כתוב ' +
      'ברשימה (אות באות, בלי לשנות ניסוח ובלי להוסיף שום דבר).\n\n' +
      'כללי ההחלטה, לפי סדר עדיפות:\n' +
      '1. אם נקבעה פגישה או תאריך - בחרי סטטוס של פגישה.\n' +
      '2. אם הוא ניתק, אמר שאינו מעוניין או שאינו רוצה - בחרי "לא מעוניין".\n' +
      '3. אם ביקש שנתקשר במועד מאוחר יותר - בחרי "בתהליך".\n' +
      '4. אם ביקש שנחזור אליו, ביקש נציגה, השאיר פרטים או הביע עניין - ' +
      'בחרי סטטוס של ליד.\n' +
      '5. אם לא ענה או שלא התקיימה שיחה - בחרי "אין מענה".\n\n' +
      'הרשימה:\n' + statusList.join('\n') + '\n\nהשיחה:\n' + text;

    const response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        muteHttpExceptions: true
      }
    );

    const result = JSON.parse(response.getContentText());
    const rawText = result.candidates && result.candidates[0] && result.candidates[0].content &&
      result.candidates[0].content.parts && result.candidates[0].content.parts[0] &&
      result.candidates[0].content.parts[0].text;
    if (!rawText) return text;

    const normalized = normalizeLabel_(rawText.trim());
    const match = statusList.find(function (s) { return normalizeLabel_(s) === normalized; });
    return match || text;
  } catch (e) {
    return text;
  }
}

/**
 * אוצר המילים הסגור של הסטטוסים - כל ערך שמותר להופיע בעמודת הסטטוס:
 * הרשימה שהלקוחה מנהלת ("רשימת סטטוסים") + סטטוסי המערכת הקבועים שלנו
 * (נשלח וואטסאפ / שיחה נשלחה / מאושר לשליחה) + סטטוסי הליד של פרלה
 * (PEARL_LEAD_STATUS_LABELS_). כל ערך אחר - טקסט חופשי/נרטיב - נחשב
 * "לא אחיד" ולעולם לא ייכתב לעמודת הסטטוס (הוא הולך להערות בלבד).
 */
function allowedStatusValues_(statusList) {
  const list = (statusList || []).slice();
  [SENT_STATUS, CALL_SENT_STATUS, APPROVED_STATUS, SCHEDULED_STATUS, SCHEDULED_CALL_STATUS]
    .forEach(function (s) { list.push(s); });
  Object.keys(PEARL_LEAD_STATUS_LABELS_).forEach(function (code) {
    list.push(PEARL_LEAD_STATUS_LABELS_[code]);
  });
  return list;
}

/** true אם הערך שייך לאוצר המילים הסגור (השוואה מנורמלת). */
function isAllowedStatusValue_(value, statusList) {
  if (!value) return false;
  const normalized = normalizeLabel_(value);
  return allowedStatusValues_(statusList).some(function (s) {
    return normalizeLabel_(s) === normalized;
  });
}

/**
 * הסטטוס האחיד היחיד שמוצג בדשבורד, לפי סדר עדיפויות:
 * 1. "סטטוס איש קשר" - התוצאה העסקית (לחיצת כפתור בוואטסאפ או עדכון
 *    ידני של הצוות). מנצח תמיד - הצוות/הליד קובעים.
 * 2. "סטטוס שיחה" - מה שפרלה דיווחה (תגית או סטטוס-ליד).
 * 3. "סטטוס דיוור" - סטטוס השליחה ("נשלח וואטסאפ"/"מאושר לשליחה"/שגיאה).
 * ערך שאינו באוצר המילים הסגור מדולג (כדי לשמור על אחידות מוחלטת) -
 * חוץ משגיאות שליחה, שחשוב שיוצגו כמו שהן.
 */
function unifiedStatus_(contactStatus, callStatus, sendStatus, statusList) {
  const candidates = [contactStatus, callStatus, sendStatus];
  for (let i = 0; i < candidates.length; i++) {
    const value = String(candidates[i] || '').trim();
    if (!value) continue;
    if (value.indexOf('שגיאה') === 0) return value;
    if (isAllowedStatusValue_(value, statusList)) return value;
  }
  // אף אחד מהערכים אינו תווית מוכרת - אבל אם בפועל התנהלה שיחה (נשאר
  // בעמודה נרטיב ארוך מלפני כלל האחידות, או תגית שפרלה לא סיווגה),
  // המשמעות היא "השיחה עוד לא הסתיימה בתוצאה ברורה". מציגים את תווית
  // ההמתנה האחידה. זה קורה **בזמן קריאה**, ולכן חל מיד גם על שיחות
  // שכבר התקיימו - בלי צורך בכלי ניקוי או בהרצה חד-פעמית כלשהי.
  if (String(callStatus || '').trim()) return PEARL_PENDING_LABEL_;
  return '';
}

/**
 * בונה את יומן ההערות המאוחד שמוצג בעמודה אחת - כל התיעוד יחד, החדש
 * למעלה, כשלכל שורה מסומן מי כתב אותה:
 *   lead  - מה שהליד כתב בוואטסאפ
 *   team  - מה שהצוות כתב (ידנית ב-CRM, או תשובה ידנית מה-Inbox של InforU)
 *   pearl - סיכומי השיחות מפרלה
 * מחזיר מערך [{ who, text }] - הפורמט עצמו נקבע בצד הלקוח.
 */
function buildNotesEntries_(reply, callResult, userNotes) {
  const entries = [];
  const pushLines_ = function (raw, who) {
    String(raw || '').split('\n').forEach(function (line) {
      const text = line.trim();
      if (text) entries.push({ who: who, text: text });
    });
  };

  // הערות ידניות של הצוות - כבר שמורות "החדשה למעלה" (ר' appendNoteEntry_).
  pushLines_(userNotes, 'team');

  // שיחת הוואטסאפ - מצטברת "הישן למעלה", אז הופכים לסדר החדש-קודם.
  // שורות שנמשכו מה-Inbox של InforU מסומנות מראש ב-"👤 מיטוב:" (ר'
  // pullOutgoingWhatsAppMessages) - הן של הצוות, לא של הליד.
  const replyEntries = [];
  String(reply || '').split('\n').forEach(function (line) {
    const text = line.trim();
    if (!text) return;
    if (text.indexOf('👤 מיטוב:') === 0) {
      replyEntries.push({ who: 'team', text: text.replace('👤 מיטוב:', '').trim() });
    } else {
      replyEntries.push({ who: 'lead', text: text });
    }
  });
  replyEntries.reverse().forEach(function (e) { entries.push(e); });

  // סיכומי פרלה - גם הם מצטברים "הישן למעלה", אז אותו היפוך.
  const callEntries = [];
  String(callResult || '').split('\n').forEach(function (line) {
    const text = line.trim();
    if (text) callEntries.push({ who: 'pearl', text: text });
  });
  callEntries.reverse().forEach(function (e) { entries.push(e); });

  return entries;
}

function getCampaignData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  const nameCol = findColumnNormalized_(headers, NAME_HEADER);
  const companyCol = findColumnNormalized_(headers, COMPANY_HEADER);
  const titleCol = findColumnNormalized_(headers, TITLE_HEADER);
  const emailCol = findColumnNormalized_(headers, EMAIL_HEADER);
  const sourceCol = findColumnNormalized_(headers, SOURCE_HEADER);
  const statusCol = findHeaderIndex_(headers, STATUS_HEADER, STATUS_HEADER_LEGACY);
  const replyCol = findHeaderIndex_(headers, REPLY_HEADER, REPLY_HEADER_LEGACY);
  const firstReplyCol = findColumnNormalized_(headers, FIRST_REPLY_HEADER);
  const replyDateCol = findColumnNormalized_(headers, REPLY_DATE_HEADER);
  const callStatusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
  const callResultCol = findHeaderIndex_(headers, CALL_RESULT_HEADER, CALL_RESULT_HEADER_LEGACY);
  const callFirstResultCol = findColumnNormalized_(headers, CALL_FIRST_RESULT_HEADER);
  const callDateCol = findColumnNormalized_(headers, CALL_DATE_HEADER);
  const callLeadIdCol = findColumnNormalized_(headers, CALL_LEAD_ID_HEADER);
  const userNotesCol = findColumnNormalized_(headers, USER_NOTES_HEADER);
  const scheduleCol = findColumnNormalized_(headers, SCHEDULE_HEADER);

  const lastExportIso = lastExportTime_(sheetName);
  const lastExportMs = lastExportIso ? new Date(lastExportIso).getTime() : null;
  const statusList = getStatusList_();
  // מי מוקצה למי - נקרא פעם אחת לכל הקמפיין, לא פר שורה.
  const assignedMap = openAssignmentsByPhone_();

  let sent = 0, errors = 0, replies = 0, callsSent = 0, activityToday = 0;
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = phoneCol !== -1 ? row[phoneCol] : '';
    if (!phone) continue;

    const status = statusCol !== -1 ? String(row[statusCol] || '') : '';
    const reply = replyCol !== -1 ? row[replyCol] : '';
    const firstReply = firstReplyCol !== -1 ? row[firstReplyCol] : '';
    const replyDate = replyDateCol !== -1 ? row[replyDateCol] : null;
    const callStatus = callStatusCol !== -1 ? String(row[callStatusCol] || '') : '';
    const callResult = callResultCol !== -1 ? row[callResultCol] : '';
    const callFirstResult = callFirstResultCol !== -1 ? row[callFirstResultCol] : '';
    const callDate = callDateCol !== -1 ? row[callDateCol] : null;
    const userNotes = userNotesCol !== -1 ? row[userNotesCol] : '';
    const scheduleAt = scheduleCol !== -1 ? parseScheduleValue_(row[scheduleCol]) : null;

    // "שיחות בוצעו" נספר לפי קיום מזהה ליד (leadId) - לא לפי טקסט "סטטוס
    // שיחה", כי העמודה הזו מוצגת עכשיו כתגית האמיתית מ-NLPearl ולא נשארת
    // "שיחה נשלחה" לצמיתות (ר' handleNlpearlWebhook_/startCallsInSheet_).
    const callWasSent = callLeadIdCol !== -1 && !!row[callLeadIdCol];

    if (status === SENT_STATUS) sent++;
    if (status.indexOf('שגיאה') === 0) errors++;
    if (reply) replies++;
    if (callWasSent) callsSent++;
    if (isToday_(replyDate) || isToday_(callDate)) activityToday++;

    const replyMs = (replyDate instanceof Date && !isNaN(replyDate.getTime())) ? replyDate.getTime() : 0;
    const callMs = (callDate instanceof Date && !isNaN(callDate.getTime())) ? callDate.getTime() : 0;
    const lastActivityMs = Math.max(replyMs, callMs);
    // שתי רמות הדגשה בדשבורד/באקסל: "היום" (צהוב, המנצחת אם שתיהן
    // מתקיימות) ו"מאז ההורדה האחרונה של האקסל" (ירוק חלש).
    const updatedToday = lastActivityMs > 0 && isToday_(new Date(lastActivityMs));
    const recentlyUpdated = lastExportMs !== null && lastActivityMs > lastExportMs;

    rows.push({
      name: nameCol !== -1 ? row[nameCol] : '',
      phone: phone,
      company: companyCol !== -1 ? row[companyCol] : '',
      title: titleCol !== -1 ? row[titleCol] : '',
      email: emailCol !== -1 ? row[emailCol] : '',
      source: sourceCol !== -1 ? row[sourceCol] : '',
      status: status,
      statusClass: classifyStatus_(status),
      reply: reply,
      replyDate: (replyDate instanceof Date && !isNaN(replyDate.getTime()))
        ? Utilities.formatDate(replyDate, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '',
      firstReply: firstReply,
      callStatus: callStatus,
      callStatusClass: classifyStatus_(callStatus),
      callResult: callResult,
      callFirstResult: callFirstResult,
      callDate: (callDate instanceof Date && !isNaN(callDate.getTime()))
        ? Utilities.formatDate(callDate, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '',
      userNotes: userNotes,
      // --- השדות המאוחדים שהדשבורד מציג בפועל (עמודת סטטוס אחת + הערות אחת) ---
      unifiedStatus: unifiedStatus_(firstReply, callStatus, status, statusList),
      notesEntries: buildNotesEntries_(reply, callResult, userNotes),
      lastActivity: lastActivityMs > 0
        ? Utilities.formatDate(new Date(lastActivityMs), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '',
      lastActivityMs: lastActivityMs,
      // "הגיב" = יצר איתנו אינטראקציה אמיתית: כתב/לחץ כפתור בוואטסאפ, או
      // שפרלה החזירה תוצאה. סטטוס-מערכת ("לא ענה") לבדו אינו תגובה.
      hasResponded: !!(reply || firstReply || callResult),
      // תזמון: התאריך שנקבע לשליחה/שיחה, ודגל לשורה שסומנה כמתוזמנת
      // אבל נשארה בלי תאריך - כזו לא תצא לעולם, ולכן היא חייבת להיות
      // גלויה לעין בדשבורד ולא להיתקע בשקט.
      scheduledAt: scheduleAt
        ? Utilities.formatDate(scheduleAt, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '',
      scheduledAtMs: scheduleAt ? scheduleAt.getTime() : 0,
      scheduleMissingDate: isScheduledStatus_(status) && !scheduleAt,
      // שם הנציגה שהליד מוקצה לה כרגע (ריק אם פנוי או שכבר טופל).
      assignedTo: assignedMap[phoneSuffix_(phone)] || '',
      // דרך איזה ערוץ פנינו לליד בפועל - כדי שיהיה אפשר לדעת במבט אחד
      // אם הוא קיבל וואטסאפ, שיחת פרלה, או את שניהם. נגזר מנתונים
      // שכבר קיימים בשורה, בלי עמודה חדשה בגיליון.
      viaWhatsapp: normalizeLabel_(status) === normalizeLabel_(SENT_STATUS) || !!reply || !!firstReply,
      viaPearl: callWasSent || !!callResult || !!callStatus,
      updatedToday: updatedToday,
      recentlyUpdated: recentlyUpdated
    });
  }

  const total = rows.length;
  const pending = Math.max(total - sent - errors, 0);

  return {
    total: total,
    sent: sent,
    errors: errors,
    replies: replies,
    callsSent: callsSent,
    pending: pending,
    activityToday: activityToday,
    daysActive: daysActive_(sheetName),
    rows: rows,
    replyBreakdown: replyBreakdown_(rows),
    trend: dailyActivityTrend_(sheetName),
    teamUsers: TEAM_USERS_,
    statusColors: getStatusColors_(),
    statusList: getStatusList_(),
    repNames: getRepNames(),
    repWorkload: repWorkload_()
  };
}

/**
 * מפלח את אנשי הקשר לפי תוכן התגובה (לא לפי סטטוס שליחה) - כמה ענו
 * "פגישה", כמה "לא מעוניין" וכו', לצורך גרף הפילוח בדשבורד. מבוסס על
 * "תגובה ראשונית" (הלחיצה הראשונה), עם נפילה חזרה לשורה הראשונה של
 * "תשובת איש קשר" לשורות ישנות שנכתבו לפני שהעמודה הזו נוספה. מי שעדיין
 * לא ענה בכלל מקובץ בנפרד תחת "טרם ענו". יותר מ-6 קטגוריות שונות
 * מתקפלות ל"אחר", כדי שהגרף יישאר קריא.
 */
function replyBreakdown_(rows) {
  const NO_REPLY_LABEL = 'טרם ענו';
  const MAX_CATEGORIES = 6;

  const counts = {};
  rows.forEach(function (r) {
    const key = r.firstReply || (r.reply ? String(r.reply).split('\n')[0] : '');
    const label = key || NO_REPLY_LABEL;
    counts[label] = (counts[label] || 0) + 1;
  });

  const noReplyCount = counts[NO_REPLY_LABEL] || 0;
  delete counts[NO_REPLY_LABEL];

  let entries = Object.keys(counts).map(function (label) {
    return { label: label, count: counts[label] };
  });
  entries.sort(function (a, b) { return b.count - a.count; });

  if (entries.length > MAX_CATEGORIES) {
    const top = entries.slice(0, MAX_CATEGORIES - 1);
    const otherCount = entries.slice(MAX_CATEGORIES - 1).reduce(function (s, e) { return s + e.count; }, 0);
    entries = top.concat([{ label: 'אחר', count: otherCount }]);
  }

  if (noReplyCount) {
    entries.push({ label: NO_REPLY_LABEL, count: noReplyCount, muted: true });
  }

  return entries;
}

/* ==========================================================================
 * מסך פרלה - חלון חי ל-NLPearl (?pearl=<קוד>)
 * --------------------------------------------------------------------------
 * זהו דף **נפרד לגמרי** מהדשבורד הראשי: הוא לא קורא ולא כותב לגיליון,
 * אלא מדבר ישירות מול ה-API של NLPearl ומציג את הסטטוסים והתגיות של
 * פרלה עצמה (New / NeedRetry / Unreachable וכו') - בשונה מהסטטוסים
 * העסקיים שלנו בגיליון. המטרה המרכזית: לזהות את מי שפרלה ניסתה עד
 * שנגמרו לה הניסיונות ולא השיגה, ולהחזיר אותו לחיוג.
 *
 * ההחזרה לחיוג היא PUT /v2/Outbound/{pearlId}/Lead/{leadId} עם
 * {"status": 1} - כלומר הליד חוזר להיות "חדש" והקמפיין מרים אותו שוב
 * לתור. שום דבר לא נמחק בדרך.
 * ========================================================================== */

const PEARL_API_V2_ = 'https://api.nlpearl.ai/v2';
const PEARL_VIEW_KEY_PROP_ = 'PEARL_VIEW_KEY';

// טבלת "Lead Statuses" הרשמית של NLPearl, בעברית. אלה הסטטוסים של
// פרלה עצמה - לא רשימת הסטטוסים של הלקוחה - ולכן הם מוצגים כאן כמו
// שהם, בלי העיגול שנעשה בגיליון (matchCallStatus_).
const PEARL_STATUS_NAMES_ = {
  1: 'חדש',
  10: 'ממתין לניסיון נוסף',
  20: 'בתור לחיוג',
  30: 'מספר שגוי',
  40: 'בשיחה כרגע',
  70: 'הושארה הודעה בתא קולי',
  100: 'הסתיים בהצלחה',
  110: 'הסתיים ללא הצלחה',
  130: 'הסתיים',
  150: 'לא הצליחה להשיג',
  220: 'ברשימה השחורה',
  300: 'ננטש בתור',
  500: 'שגיאה'
};

// מה נחשב "לא ענו" ומסומן אוטומטית להחזרה לחיוג - לפי בחירת הלקוחה:
// 150 = פרלה ניסתה עד הסוף ולא השיגה, 70 = הגיעה רק לתא קולי.
const PEARL_RETRY_STATUSES_ = [150, 70];
const PEARL_NEW_STATUS_ = 1;

// תקרות בטיחות: Apps Script עוצר אחרי 6 דקות, וכל החזרה לחיוג היא
// קריאת רשת נפרדת. עדיף להחזיר "הוחזרו 300, נשארו עוד" מאשר ליפול באמצע.
const PEARL_MAX_RESET_ = 300;
const PEARL_LEADS_PAGE_ = 200;
const PEARL_LEADS_MAX_ = 2000;
const PEARL_CALLS_PAGE_ = 200;
const PEARL_CALLS_MAX_ = 600;
const PEARL_CALLS_DAYS_BACK_ = 90;

/** קריאה גנרית ל-API של פרלה. לעולם לא זורקת - מחזירה תמיד אובייקט. */
function pearlFetch_(method, path, payload) {
  const options = {
    method: method,
    headers: { Authorization: getNlpearlAuthHeader_() },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  let response;
  try {
    response = UrlFetchApp.fetch(PEARL_API_V2_ + path, options);
  } catch (err) {
    return { ok: false, code: 0, data: null, text: String(err) };
  }

  const code = response.getResponseCode();
  const text = response.getContentText();
  let data = null;
  try { data = JSON.parse(text); } catch (err) { data = null; }
  return { ok: code < 300, code: code, data: data, text: text };
}

/**
 * הקוד שמופיע בכתובת של מסך פרלה. נוצר פעם אחת ונשמר ב-Script
 * Properties - בדיוק כמו הקוד האישי של נציגה, כדי שמי שאין לו את
 * הלינק לא יוכל להחזיר לידים לחיוג.
 */
function pearlViewKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty(PEARL_VIEW_KEY_PROP_);
  if (!key) {
    key = randomRepKey_() + randomRepKey_();
    props.setProperty(PEARL_VIEW_KEY_PROP_, key);
  }
  return key;
}

/**
 * מדפיסה ללוג את הלינק המלא למסך פרלה - זה מה שנועצים בדפדפן.
 * להרצה ידנית מהעורך (מופיעה ברשימת הפונקציות כי אין קו תחתון בסוף).
 */
function getPearlViewLink() {
  const link = ScriptApp.getService().getUrl() + '?pearl=' + pearlViewKey_();
  Logger.log('מסך פרלה: ' + link);
  return link;
}

function assertPearlKey_(key) {
  if (String(key || '').trim() !== pearlViewKey_()) {
    throw new Error('אין הרשאה למסך פרלה. יש להיכנס דרך הלינק המלא.');
  }
}

/** שם הסטטוס בעברית, גם לקוד שלא מוכר לנו (כדי שלא ייראה ריק). */
function pearlStatusName_(status) {
  const code = Number(status);
  return PEARL_STATUS_NAMES_[code] || ('סטטוס ' + (isNaN(code) ? '?' : code));
}

/**
 * שמות השדות שפרלה מחזירה עשויים להשתנות בין גרסאות ה-API, ולכן כל
 * שדה נקרא מכמה מועמדים אפשריים. אם משהו יופיע ריק - debugPearlLead()
 * מדפיס את האובייקט הגולמי ואפשר להוסיף כאן את השם החסר.
 */
function pearlFirst_(obj, names) {
  for (let i = 0; i < names.length; i++) {
    const value = obj[names[i]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

/** מוציא מערך תוצאות מתשובה של פרלה, בלי להניח מבנה אחד קבוע. */
function pearlResults_(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const candidates = ['results', 'items', 'data', 'leads', 'calls'];
  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(data[candidates[i]])) return data[candidates[i]];
  }
  return [];
}

function pearlNormalizeLead_(lead) {
  const callData = lead.callData || lead.CallData || {};
  const name = pearlFirst_(lead, ['name', 'fullName', 'leadName']) ||
    pearlFirst_(callData, ['name', 'fullName', 'firstName', 'שם']);
  const status = Number(pearlFirst_(lead, ['status', 'leadStatus', 'statusCode']) || 0);
  return {
    id: String(pearlFirst_(lead, ['id', 'leadId', '_id'])),
    phone: String(pearlFirst_(lead, ['phoneNumber', 'phone', 'to'])),
    externalId: String(pearlFirst_(lead, ['externalId', 'external_id'])),
    name: String(name || ''),
    status: status,
    statusName: pearlStatusName_(status),
    attempts: Number(pearlFirst_(lead, ['callCount', 'attempts', 'retryCount', 'numberOfCalls', 'callsCount']) || 0),
    lastCallAt: pearlIsoToMs_(pearlFirst_(lead, ['lastCallDate', 'lastCallTime', 'updatedAt', 'modifiedAt'])),
    createdAt: pearlIsoToMs_(pearlFirst_(lead, ['createdAt', 'creationDate', 'createdOn'])),
    tags: [],
    summary: ''
  };
}

/** תאריך ISO של פרלה -> מילישניות. מחזיר 0 אם אין/לא ניתן לפענוח. */
function pearlIsoToMs_(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value));
  const ms = parsed.getTime();
  return isNaN(ms) ? 0 : ms;
}

/** רשימת הקמפיינים (Pearls) מהחשבון עצמו - לא רשימה קשיחה בקוד. */
function getPearlCampaigns(key) {
  assertPearlKey_(key);
  const res = pearlFetch_('get', '/Pearl');
  if (!res.ok) throw new Error('פרלה החזירה שגיאה (' + res.code + '): ' + res.text);

  return pearlResults_(res.data).map(function (p) {
    return {
      id: String(pearlFirst_(p, ['id', 'pearlId', '_id'])),
      name: String(pearlFirst_(p, ['name', 'title']) || 'ללא שם'),
      active: p.isActive !== false
    };
  }).filter(function (p) { return p.id; });
}

/**
 * כל הלידים של קמפיין אחד, עם התגית והסיכום של השיחה האחרונה שלהם.
 * התגית יושבת על ה**שיחה** ולא על הליד, ולכן היא נשלפת בנפרד
 * (Calls/Bulk עם fields) ומוצמדת לפי leadId.
 */
function getPearlBoard(key, pearlId) {
  assertPearlKey_(key);
  const id = String(pearlId || '').trim();
  if (!id) throw new Error('לא נבחר קמפיין.');

  const leads = [];
  let skip = 0;
  while (leads.length < PEARL_LEADS_MAX_) {
    const res = pearlFetch_('post', '/Outbound/' + encodeURIComponent(id) + '/Leads', {
      skip: skip, limit: PEARL_LEADS_PAGE_, isAscending: false
    });
    if (!res.ok) throw new Error('פרלה החזירה שגיאה (' + res.code + '): ' + res.text);

    const page = pearlResults_(res.data);
    page.forEach(function (lead) { leads.push(pearlNormalizeLead_(lead)); });
    if (page.length < PEARL_LEADS_PAGE_) break;
    skip += PEARL_LEADS_PAGE_;
  }

  const meta = pearlCallMetaByLead_(id);
  leads.forEach(function (lead) {
    const info = meta[lead.id];
    if (!info) return;
    lead.tags = info.tags;
    lead.summary = info.summary;
    if (!lead.lastCallAt && info.startedAt) lead.lastCallAt = info.startedAt;
    if (!lead.name && info.name) lead.name = info.name;
  });

  const counts = {};
  const tagCounts = {};
  leads.forEach(function (lead) {
    counts[lead.status] = (counts[lead.status] || 0) + 1;
    lead.tags.forEach(function (tag) { tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
  });

  return {
    pearlId: id,
    leads: leads,
    counts: counts,
    statusNames: PEARL_STATUS_NAMES_,
    retryStatuses: PEARL_RETRY_STATUSES_,
    tags: Object.keys(tagCounts).sort(function (a, b) { return tagCounts[b] - tagCounts[a]; }),
    tagCounts: tagCounts,
    maxReset: PEARL_MAX_RESET_,
    truncated: leads.length >= PEARL_LEADS_MAX_,
    updatedAt: new Date().getTime()
  };
}

/**
 * מיפוי leadId -> { tags, summary, name, startedAt } מתוך השיחות של
 * 90 הימים האחרונים. אם הקריאה נכשלת פשוט אין תגיות - זה לא מפיל את
 * המסך, כי הסטטוסים (העיקר) מגיעים מהלידים עצמם.
 */
function pearlCallMetaByLead_(pearlId) {
  const map = {};
  const to = new Date();
  const from = new Date(to.getTime() - PEARL_CALLS_DAYS_BACK_ * 24 * 60 * 60 * 1000);

  let skip = 0;
  while (skip < PEARL_CALLS_MAX_) {
    const res = pearlFetch_('post', '/Pearl/' + encodeURIComponent(pearlId) + '/Calls/Bulk', {
      skip: skip,
      limit: PEARL_CALLS_PAGE_,
      isAscending: false,
      fromDate: pearlIsoDate_(from),
      toDate: pearlIsoDate_(to),
      fields: ['Tags', 'Name', 'Summary', 'LeadId']
    });
    if (!res.ok) {
      Logger.log('שליפת תגיות נכשלה (' + res.code + '): ' + res.text);
      return map;
    }

    const page = pearlResults_(res.data);
    page.forEach(function (call) {
      const leadId = String(pearlFirst_(call, ['leadId', 'lead_id', 'leadID']));
      if (!leadId || map[leadId]) return;   // השיחה הראשונה = האחרונה בזמן
      const tags = pearlFirst_(call, ['tags', 'Tags']);
      map[leadId] = {
        tags: Array.isArray(tags) ? tags.map(String) : (tags ? [String(tags)] : []),
        summary: String(pearlFirst_(call, ['summary', 'Summary']) || ''),
        name: String(pearlFirst_(call, ['name', 'Name']) || ''),
        startedAt: pearlIsoToMs_(pearlFirst_(call, ['startTime', 'startedAt', 'date', 'createdAt']))
      };
    });
    if (page.length < PEARL_CALLS_PAGE_) break;
    skip += PEARL_CALLS_PAGE_;
  }
  return map;
}

/** התאריך בפורמט שפרלה דורשת: 2026-08-03T00:00:00.000Z */
function pearlIsoDate_(date) {
  return Utilities.formatDate(date, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
}

/**
 * מחזירה לידים לחיוג: מעדכנת את הסטטוס שלהם בפרלה חזרה ל"חדש" (1).
 * לא מוחקת כלום, לא נוגעת בגיליון. מחזירה דיווח מדויק - כמה הצליחו,
 * ומי נכשל ולמה - כדי שלא ייראה כאילו הכל עבר כשחלק לא.
 */
function resetPearlLeads(key, pearlId, leadIds) {
  assertPearlKey_(key);
  const id = String(pearlId || '').trim();
  if (!id) throw new Error('לא נבחר קמפיין.');
  if (!leadIds || !leadIds.length) throw new Error('לא נבחרו לידים.');

  const wanted = leadIds.map(String).filter(function (v) { return v; });
  const batch = wanted.slice(0, PEARL_MAX_RESET_);
  const done = [];
  const failed = [];

  batch.forEach(function (leadId) {
    const res = pearlFetch_('put', '/Outbound/' + encodeURIComponent(id) + '/Lead/' + encodeURIComponent(leadId), {
      status: PEARL_NEW_STATUS_
    });
    if (res.ok) done.push(leadId);
    else failed.push({ id: leadId, error: '(' + res.code + ') ' + String(res.text || '').slice(0, 160) });
  });

  Logger.log('החזרה לחיוג בקמפיין ' + id + ': הצליחו ' + done.length + ', נכשלו ' + failed.length);
  return {
    done: done,
    failed: failed,
    remaining: wanted.length - batch.length,
    maxReset: PEARL_MAX_RESET_
  };
}

/**
 * כלי אבחון: מדפיס ללוג את האובייקט הגולמי של הליד הראשון בקמפיין -
 * כדי לראות בדיוק אילו שמות שדות פרלה מחזירה בפועל. להריץ אם משהו
 * במסך מופיע ריק (שם/מספר ניסיונות/תאריך).
 */
function debugPearlLead() {
  const pearlId = DEFAULT_OUTBOUND_ID;
  const res = pearlFetch_('post', '/Outbound/' + pearlId + '/Leads', {
    skip: 0, limit: 3, isAscending: false
  });
  Logger.log('קוד תשובה: ' + res.code);
  Logger.log(res.text.slice(0, 4000));
}

/**
 * כל הלינקים שמוצגים בחלון "לינקים" בדשבורד הראשי: מסך פרלה בשורה
 * הראשונה, ואחריו הלינק האישי של כל נציגה. מרוכז בפונקציה אחת כדי
 * שהלקוחה לא תצטרך להריץ שום דבר בעורך כדי למצוא כתובת.
 */
function getDashboardLinks() {
  const pearlRow = {
    name: '🤖 מסך פרלה',
    email: '',
    key: '',
    link: ScriptApp.getService().getUrl() + '?pearl=' + pearlViewKey_(),
    active: true,
    kind: 'pearl'
  };
  return [pearlRow].concat(getRepLinks().map(function (rep) {
    rep.kind = 'rep';
    return rep;
  }));
}
