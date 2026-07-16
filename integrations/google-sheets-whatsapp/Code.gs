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
 * סטטוס, תשובת לקוח, תאריך תשובה, מזהה קמפיין, סטטוס שיחה, מזהה ליד NLPearl,
 * תוצאות שיחה, תאריך שיחה.
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
const STATUS_HEADER = 'סטטוס';
const REPLY_HEADER = 'תשובת לקוח';
const FIRST_REPLY_HEADER = 'תגובה ראשונית';
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
const CALL_DATE_HEADER = 'תאריך שיחה';
const CALL_SENT_STATUS = 'שיחה נשלחה';

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
  return headers.indexOf(PHONE_HEADER) !== -1;
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

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const statusCol = headers.indexOf(STATUS_HEADER);
  const templateCol = headers.indexOf(TEMPLATE_HEADER);

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

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const campaignCol = headers.indexOf(CAMPAIGN_HEADER);
  const callStatusCol = headers.indexOf(CALL_STATUS_HEADER);
  const leadIdCol = headers.indexOf(CALL_LEAD_ID_HEADER);

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
 * לעמודת "תשובת לקוח" (עם שעה) במקום לדרוס את הקודמת - כדי לשמור את
 * כל השיחה, לא רק את ההודעה האחרונה.
 *
 * מחפשים קודם כל רק בטאב שאליו נשלחה לאחרונה הודעה למספר הזה
 * (lastContactSheet_) - כדי שתשובה תעדכן אך ורק את הקמפיין הרלוונטי,
 * גם אם באותו מספר טלפון נעשה שימוש (למשל לבדיקות) בכמה טאבים במקביל.
 * רק אם אין מיפוי כזה (למשל שורה שנוספה ידנית ומעולם לא נשלחה אליה
 * הודעה מהמערכת) נופלים חזרה לחיפוש בכל טאבי הקמפיינים.
 */
function handleInforuWebhook_(ss, payload) {
  const entry = payload.Data && payload.Data[0];
  if (!entry) return;

  const incomingPhone = phoneSuffix_(entry.Value);
  const incomingText = entry.Message;
  if (!incomingPhone) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const tracked = lastContactSheet_(ss, incomingPhone);
    const sheets = tracked ? [tracked] : getCampaignSheets_(ss);
    for (const sheet of sheets) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const phoneCol = headers.indexOf(PHONE_HEADER);
      const replyCol = headers.indexOf(REPLY_HEADER);
      const replyDateCol = headers.indexOf(REPLY_DATE_HEADER);
      const firstReplyCol = headers.indexOf(FIRST_REPLY_HEADER);
      if (phoneCol === -1 || replyCol === -1) continue;

      for (let i = 1; i < data.length; i++) {
        const sheetPhone = phoneSuffix_(data[i][phoneCol]);
        if (sheetPhone && sheetPhone === incomingPhone) {
          const rowIndex = i + 1;
          const existingReply = data[i][replyCol];
          // בלי חותמת זמן בתוך הטקסט - כדי שהעמודה תישאר טקסט נקי שאפשר
          // לסנן/למיין (גם בגיליון עצמו וגם בייצוא לאקסל). מועד התשובה
          // האחרונה נשמר בנפרד בעמודת "תאריך תשובה".
          const combined = existingReply ? (existingReply + '\n' + incomingText) : incomingText;
          sheet.getRange(rowIndex, replyCol + 1).setValue(combined);
          if (replyDateCol !== -1) sheet.getRange(rowIndex, replyDateCol + 1).setValue(new Date());
          recordDailyActivity_(sheet.getName());
          // התגובה הראשונה של הלקוח (למשל לחיצה על "פגישה" / "לא מעוניין"
          // בתפריט הראשוני) נשמרת פעם אחת בלבד בעמודה נפרדת - לא נדרסת
          // בהמשך השיחה עם הבוט האוטומטי, כדי שיהיה אפשר לראות אותה
          // במבט אחד בדשבורד, בלי כל השרשור.
          if (firstReplyCol !== -1 && !data[i][firstReplyCol]) {
            sheet.getRange(rowIndex, firstReplyCol + 1).setValue(incomingText);
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
 */
function handleNlpearlWebhook_(ss, payload) {
  // מטפלים רק באירועי Call Webhook (מזוהים לפי "to") לצורך עמודת התוצאה -
  // אירועי Lead Webhook (מזוהים לפי "phoneNumber" במקום) לא נושאים את
  // התוצאה הקריאה (tags/summary) ורק היו דורסים תוצאה טובה בנתונים גולמיים פחות שימושיים.
  if (!payload.to) return;

  const incomingPhone = phoneSuffix_(payload.to);
  if (!incomingPhone) return;

  const tracked = lastContactSheet_(ss, incomingPhone);
  const sheets = tracked ? [tracked] : getCampaignSheets_(ss);
  for (const sheet of sheets) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneCol = headers.indexOf(PHONE_HEADER);
    const resultCol = headers.indexOf(CALL_RESULT_HEADER);
    const dateCol = headers.indexOf(CALL_DATE_HEADER);
    if (phoneCol === -1 || resultCol === -1) continue;

    for (let i = 1; i < data.length; i++) {
      const sheetPhone = phoneSuffix_(data[i][phoneCol]);
      if (sheetPhone && sheetPhone === incomingPhone) {
        const rowIndex = i + 1;
        const summary = (Array.isArray(payload.tags) && payload.tags.length)
          ? payload.tags.join(', ')
          : (payload.summary || 'סטטוס: ' + payload.status);
        sheet.getRange(rowIndex, resultCol + 1).setValue(summary);
        if (dateCol !== -1) sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());
        recordDailyActivity_(sheet.getName());
        return;
      }
    }
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

function getCampaignNames() {
  return getCampaignSheets_(SpreadsheetApp.getActiveSpreadsheet()).map(function (sheet) {
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
  const phoneCol = headers.indexOf(PHONE_HEADER);
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
    const col = headers.indexOf(columnByField[key]);
    if (col !== -1) row[col] = (fields && fields[key]) || '';
  });

  const targetRow = sheet.getLastRow() + 1;
  // כופה פורמט טקסט על תא הטלפון לפני הכתיבה - אחרת גוגל שיטס עלול לפרש
  // מספר שמתחיל ב-"+" (כמו שמגיע מ-Wix, לדוגמה "+972501234567") כניסיון
  // לנוסחה ולזרוק #ERROR!, גם אם עמודת הטלפון לא הוגדרה ידנית כטקסט.
  sheet.getRange(targetRow, phoneCol + 1).setNumberFormat('@');
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
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

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const companyCol = headers.indexOf(COMPANY_HEADER);
  const titleCol = headers.indexOf(TITLE_HEADER);
  const emailCol = headers.indexOf(EMAIL_HEADER);
  const sourceCol = headers.indexOf(SOURCE_HEADER);
  const statusCol = headers.indexOf(STATUS_HEADER);
  const replyCol = headers.indexOf(REPLY_HEADER);
  const firstReplyCol = headers.indexOf(FIRST_REPLY_HEADER);
  const replyDateCol = headers.indexOf(REPLY_DATE_HEADER);
  const callStatusCol = headers.indexOf(CALL_STATUS_HEADER);
  const callResultCol = headers.indexOf(CALL_RESULT_HEADER);
  const callDateCol = headers.indexOf(CALL_DATE_HEADER);

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
    const callDate = callDateCol !== -1 ? row[callDateCol] : null;

    if (status === SENT_STATUS) sent++;
    if (status.indexOf('שגיאה') === 0) errors++;
    if (reply) replies++;
    if (callStatus === CALL_SENT_STATUS) callsSent++;
    if (isToday_(replyDate) || isToday_(callDate)) activityToday++;

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
      callResult: callResult
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
    trend: dailyActivityTrend_(sheetName)
  };
}

/**
 * מפלח את אנשי הקשר לפי תוכן התגובה (לא לפי סטטוס שליחה) - כמה ענו
 * "פגישה", כמה "לא מעוניין" וכו', לצורך גרף הפילוח בדשבורד. מבוסס על
 * "תגובה ראשונית" (הלחיצה הראשונה), עם נפילה חזרה לשורה הראשונה של
 * "תשובת לקוח" לשורות ישנות שנכתבו לפני שהעמודה הזו נוספה. מי שעדיין
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
