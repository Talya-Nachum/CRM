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
 * מזהה קמפיין, סטטוס שיחה, מזהה ליד NLPearl, תוצאות שיחה.
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

// --- NLPearl (שיחות קוליות) ---
const NLPEARL_API_BASE = 'https://api.nlpearl.ai/v2/Outbound/';
const DEFAULT_OUTBOUND_ID = '6a27be5ae83373643a10ae34'; // מזהה ה-Pearl (הפרמטר שב-v2), לא מזהה קמפיין ה-Outbound

const CAMPAIGN_HEADER = 'מזהה קמפיין';
const CALL_STATUS_HEADER = 'סטטוס שיחה';
const CALL_LEAD_ID_HEADER = 'מזהה ליד NLPearl';
const CALL_RESULT_HEADER = 'תוצאות שיחה';
const CALL_FIRST_RESULT_HEADER = 'תוצאה ראשונית (שיחה)';
const CALL_DATE_HEADER = 'תאריך שיחה';
const CALL_SENT_STATUS = 'שיחה נשלחה';

// --- CRM פנימי (הערות הצוות; הסטטוס הידני משותף עם FIRST_REPLY_HEADER) ---
const USER_NOTES_HEADER = 'הערות משתמש';
const TEAM_USERS_ = ['מזי', 'טליה'];

// טאבים שהם עזר/לוג בלבד, לעולם לא נחשבים קמפיין גם אם במקרה יש בהם
// עמודה שנראית כמו טלפון נייד.
const NON_CAMPAIGN_SHEETS_ = ['WebhookLog', 'NLPearlCampaigns'];

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

function isCampaignSheet_(sheet) {
  if (NON_CAMPAIGN_SHEETS_.indexOf(sheet.getName()) !== -1) return false;
  const headers = sheet.getDataRange().getValues()[0] || [];
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

function sendMessages() {
  getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(sendMessagesInSheet_);
}

function sendMessagesInSheet_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  const nameCol = findColumnNormalized_(headers, NAME_HEADER);
  const statusCol = findHeaderIndex_(headers, STATUS_HEADER, STATUS_HEADER_LEGACY);
  const templateCol = findColumnNormalized_(headers, TEMPLATE_HEADER);

  if (phoneCol === -1 || nameCol === -1 || statusCol === -1) return;

  recordCampaignStart_(sheet.getName());

  // ברירת מחדל לכל הטאב: מה שכתוב בשורה 2 (השורה הראשונה עם נתונים) של הטאב הזה.
  const sheetTemplateId = (templateCol !== -1 && data[1] && data[1][templateCol])
    ? String(data[1][templateCol]) : DEFAULT_TEMPLATE_ID;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).replace(/\D/g, '');
    const name = row[nameCol];
    const status = String(row[statusCol] || '').trim();
    const templateId = (templateCol !== -1 && row[templateCol]) ? String(row[templateCol]) : sheetTemplateId;
    const rowIndex = i + 1;

    // שולחים רק לשורה שסומנה ידנית כ"מאושר לשליחה" - כדי לאפשר להעלות
    // רשימה שלמה (למשל 300 אנשי קשר) ולשלוח בפעימות נשלטות, על ידי
    // שינוי הסטטוס רק לחלק מהשורות בכל פעם. trim() כדי שרווח מיותר
    // בתא (בהקלדה/הדבקה) לא ימנע שליחה.
    if (!phone || status !== APPROVED_STATUS) continue;

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
    sheet.getRange(rowIndex, statusCol + 1).setValue(
      result.StatusId === 1 ? SENT_STATUS : 'שגיאה: ' + result.StatusDescription
    );
  }
}

function startCalls() {
  getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet()).forEach(startCallsInSheet_);
}

function startCallsInSheet_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = findColumnNormalized_(headers, PHONE_HEADER);
  const nameCol = findColumnNormalized_(headers, NAME_HEADER);
  const campaignCol = findColumnNormalized_(headers, CAMPAIGN_HEADER);
  const callStatusCol = findColumnNormalized_(headers, CALL_STATUS_HEADER);
  const leadIdCol = findColumnNormalized_(headers, CALL_LEAD_ID_HEADER);

  if (phoneCol === -1 || callStatusCol === -1) return;

  recordCampaignStart_(sheet.getName());

  // ברירת מחדל לכל הטאב: מה שכתוב בשורה 2 (השורה הראשונה עם נתונים) של הטאב הזה.
  const sheetOutboundId = (campaignCol !== -1 && data[1] && data[1][campaignCol])
    ? String(data[1][campaignCol]) : DEFAULT_OUTBOUND_ID;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = row[phoneCol];
    const name = nameCol !== -1 ? row[nameCol] : '';
    const callStatus = row[callStatusCol];
    const outboundId = (campaignCol !== -1 && row[campaignCol]) ? String(row[campaignCol]) : sheetOutboundId;
    const rowIndex = i + 1;

    if (!phone || callStatus === CALL_SENT_STATUS) continue;

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
  }
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
      const replyCol = findHeaderIndex_(headers, REPLY_HEADER, REPLY_HEADER_LEGACY);
      const replyDateCol = findColumnNormalized_(headers, REPLY_DATE_HEADER);
      if (phoneCol === -1 || replyCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          // "הערות איש קשר" (השרשור המלא) מקבלת רק טקסט חופשי אמיתי -
          // לחיצת כפתור לבדה כבר מתועדת ב"סטטוס" ולא צריכה גם עותק כאן,
          // כדי שמי שרק לחץ כפתור ולא כתב שום דבר בעצמו יישאר עם "הערות
          // איש קשר" ריקות (אין שם שום שיחה אמיתית לתעד).
          if (!buttonPayload) {
            const existingReply = data[i][replyCol];
            // בלי חותמת זמן בתוך הטקסט - כדי שהעמודה תישאר טקסט נקי
            // שאפשר לסנן/למיין. מועד התשובה האחרונה נשמר בנפרד בעמודת
            // "תאריך תשובה".
            const combined = existingReply ? (existingReply + '\n' + incomingText) : incomingText;
            sheet.getRange(rowIndex, replyCol + 1).setValue(combined);
            if (replyDateCol !== -1) sheet.getRange(rowIndex, replyDateCol + 1).setValue(new Date());
          }
          recordDailyActivity_(sheet.getName());
          // "סטטוס" נקבע רק מלחיצה אמיתית על כפתור (למשל "פגישה"/"לא
          // מעוניין" בתפריט הראשוני) - נשמר פעם אחת בלבד, לא נדרס בלחיצה
          // נוספת בהמשך השיחה עם הבוט האוטומטי. העמודה נוצרת לבד בפעם
          // הראשונה שבאמת יש מה לכתוב בה - אין צורך להוסיף אותה ידנית.
          if (buttonPayload) {
            const firstReplyCol = ensureColumn_(sheet, headers, FIRST_REPLY_HEADER);
            if (!data[i][firstReplyCol]) {
              sheet.getRange(rowIndex, firstReplyCol + 1).setValue(buttonPayload);
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

/**
 * כמו ב-handleInforuWebhook_ למעלה: מחפשים קודם רק בטאב שאליו הותחלה
 * לאחרונה שיחה למספר הזה (lastContactSheet_), כדי שתוצאת שיחה תעדכן
 * רק את הקמפיין הרלוונטי ולא כל טאב אחר שבו קיים במקרה אותו מספר.
 * "תוצאות שיחה" מצטברת (כל שיחה חדשה מתווספת לקיים, לא דורסת) - בדיוק
 * כמו "תשובת איש קשר" בוואטסאפ, כדי לשמור היסטוריה אם היו כמה שיחות/ניסיונות.
 * "תאריך שיחה" נוצרת לבד בפעם הראשונה שצריך אותה, כמו "סטטוס איש קשר".
 */
function handleNlpearlWebhook_(ss, payload) {
  // מטפלים רק באירועי Call Webhook (מזוהים לפי "to") לצורך עמודת התוצאה -
  // אירועי Lead Webhook (מזוהים לפי "phoneNumber" במקום) לא נושאים את
  // התוצאה הקריאה (tags/summary) ורק היו דורסים תוצאה טובה בנתונים גולמיים פחות שימושיים.
  if (!payload.to) return;

  const incomingPhone = phoneSuffix_(payload.to);
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
      const resultCol = findColumnNormalized_(headers, CALL_RESULT_HEADER);
      if (phoneCol === -1 || resultCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          const summary = (Array.isArray(payload.tags) && payload.tags.length)
            ? payload.tags.join(', ')
            : (payload.summary || 'סטטוס: ' + payload.status);
          const existingResult = data[i][resultCol];
          const combined = existingResult ? (existingResult + '\n' + summary) : summary;
          sheet.getRange(rowIndex, resultCol + 1).setValue(combined);
          const dateCol = ensureColumn_(sheet, headers, CALL_DATE_HEADER);
          sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());
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
  const headers = sheet.getDataRange().getValues()[0];
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
  row[phoneCol] = fields.phone;
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

function validateTeamUser_(username) {
  if (TEAM_USERS_.indexOf(username) === -1) {
    throw new Error('שם משתמש לא מוכר: ' + username);
  }
}

/**
 * כותבת שורת יומן חדשה לעמודת "הערות משתמש", תמיד בראש הרשימה (החדשה
 * ביותר למעלה - הפוך מ"תשובת איש קשר" של הלקוח, ששם הישנה נשארת למעלה
 * וההודעות מצטרפות למטה). משמשת גם ישירות (addUserNote) וגם אוטומטית
 * כשמעדכנים סטטוס (setUserStatus), כדי ששינויי סטטוס יתועדו גם הם.
 */
function appendNoteEntry_(sheet, rowIndex, notesCol, username, text) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  const entry = username + ' - ' + timestamp + ': ' + text;
  const existing = sheet.getRange(rowIndex, notesCol + 1).getValue();
  const combined = existing ? (entry + '\n' + existing) : entry;
  sheet.getRange(rowIndex, notesCol + 1).setValue(combined);
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
  appendNoteEntry_(sheet, found.rowIndex, notesCol, username, noteText);
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
  appendNoteEntry_(sheet, found.rowIndex, notesCol, username, 'עדכנה סטטוס ל: ' + statusText);
  return { success: true };
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
  const callHistory = get_(CALL_RESULT_HEADER);

  if (!whatsappHistory && !callHistory) {
    throw new Error('אין עדיין שיחה עם הליד הזה לסכם');
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
  const callResultCol = findColumnNormalized_(headers, CALL_RESULT_HEADER);
  const callFirstResultCol = findColumnNormalized_(headers, CALL_FIRST_RESULT_HEADER);
  const callDateCol = findColumnNormalized_(headers, CALL_DATE_HEADER);
  const userNotesCol = findColumnNormalized_(headers, USER_NOTES_HEADER);

  const lastExportIso = lastExportTime_(sheetName);
  const lastExportMs = lastExportIso ? new Date(lastExportIso).getTime() : null;

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

    if (status === SENT_STATUS) sent++;
    if (status.indexOf('שגיאה') === 0) errors++;
    if (reply) replies++;
    if (callStatus === CALL_SENT_STATUS) callsSent++;
    if (isToday_(replyDate) || isToday_(callDate)) activityToday++;

    const replyMs = (replyDate instanceof Date && !isNaN(replyDate.getTime())) ? replyDate.getTime() : 0;
    const callMs = (callDate instanceof Date && !isNaN(callDate.getTime())) ? callDate.getTime() : 0;
    const recentlyUpdated = lastExportMs !== null && Math.max(replyMs, callMs) > lastExportMs;

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
    teamUsers: TEAM_USERS_
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
