/**
 * דף לידים חכם – ארז קדם אקדמיה
 * גיליון Google Sheets נפרד + Apps Script Web App:
 *  - doPost: קליטת לידים אוטומטית מדף הנחיתה (Webhook) - יחובר בפועל כשתיסגר הפלטפורמה
 *  - doGet:  ממשק ניהול לידים (הוספה/עריכה/סינון/סטטוסים/שליחת וואטסאפ מרובה-נמענים)
 *
 * שליחת הוואטסאפ משתמשת באותו API של אינפוריו כמו במערכת הראשית של מיטוב
 * (capi.inforu.co.il) - להעתיק את אותם ערכי INFORU_USERNAME / INFORU_TOKEN
 * מה-Script Properties של הפרויקט הראשי לתוך ה-Script Properties של הפרויקט
 * הזה (ר' README.md).
 */

// --- מיתוג ותוכן ה-header (לערוך כאן בשורה אחת בכל שינוי) ---
var ACADEMY_START_DATE = '2026-10-05T00:00:00+03:00'; // עדכני כשהתאריך הסופי ייקבע
var PAYMENT_URL = 'https://secure.cardcom.solutions/EA/EA5/CiU4xYNnWESl4SB3eC41WA/PaymentSP';
var INFO_URL = 'https://mituv-my.sharepoint.com/:w:/g/personal/talya_mituvforsales_co_il/IQABdIuj-z2ARa0e62zQT_GcASfM8lFLchL1dppcar53EhI?e=xnAbWP';

// --- אינפוריו (וואטסאפ) - אותו endpoint ואותו פורמט כמו במערכת הראשית ---
var INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';

var LEADS_SHEET_NAME = 'לידים';
var STATUSES_SHEET_NAME = 'רשימת סטטוסים';
var TEMPLATES_SHEET_NAME = 'תבניות';

var DEFAULT_STATUSES = ['חדש', 'בתהליך', 'נרשם לבד', 'נרשם ע"י מיטוב', 'בטיפול ארז', 'לא מעוניין', 'נשלח וואטסאפ'];

// הסטטוס שנקבע אוטומטית לכל ליד שנבחר בשליחת וואטסאפ מוצלחת (ר' sendWhatsApp)
var WHATSAPP_SENT_STATUS = 'נשלח וואטסאפ';

// שמות תבניות לדוגמה בלבד - להחליף את "מספר תבנית" בטאב "תבניות" במספרים
// האמיתיים מאינפוריו (אפשר גם לשנות/להוסיף/למחוק שורות שם בלי לגעת בקוד)
var DEFAULT_TEMPLATES = [
  ['הזמנה לאקדמיה', 'להשלים'],
  ['תזכורת תשלום', 'להשלים'],
  ['מידע נוסף', 'להשלים']
];

// סדר העמודות בגיליון "לידים" - מקור אמת יחיד לכל הקוד וה-UI
var LEAD_FIELDS = [
  { key: 'id', label: 'מזהה' },
  { key: 'createdAt', label: 'תאריך יצירה' },
  { key: 'updatedAt', label: 'עדכון אחרון' },
  { key: 'source', label: 'מקור הליד' },
  { key: 'company', label: 'שם חברה' },
  { key: 'companyId', label: 'ח.פ' },
  { key: 'contactName', label: 'שם איש קשר' },
  { key: 'role', label: 'תפקיד' },
  { key: 'phone', label: 'נייד' },
  { key: 'email', label: 'אימייל' },
  { key: 'notes', label: 'הערות' },
  { key: 'status', label: 'סטטוס' },
  { key: 'lastWhatsAppSentAt', label: 'וואטסאפ נשלח לאחרונה' },
  { key: 'replyText', label: 'תשובת ליד' },
  { key: 'replyAt', label: 'תאריך תשובה' }
];

// מיפוי שמות שדות אפשריים שיגיעו מדף הנחיתה (בעברית/אנגלית) לשדות שלנו
var FIELD_ALIASES = {
  source: ['מקור', 'מקור הליד', 'source', 'utm_source', 'lead_source'],
  company: ['חברה', 'שם חברה', 'company', 'company_name', 'organization'],
  companyId: ['חפ', 'ח.פ', 'חפ חברה', 'company_id', 'tax_id', 'vat'],
  contactName: ['שם', 'שם מלא', 'שם איש קשר', 'name', 'full_name', 'fullname', 'contact_name'],
  role: ['תפקיד', 'role', 'position', 'job_title'],
  phone: ['טלפון', 'נייד', 'טלפון נייד', 'phone', 'mobile', 'tel', 'phone_number'],
  email: ['אימייל', 'מייל', 'email', 'email_address'],
  notes: ['הערות', 'notes', 'message', 'comment', 'comments']
};

/* ============================== Web entry points ============================== */

function doGet(e) {
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ניהול לידים – ארז קדם אקדמיה')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getConfig() {
  return {
    academyStartDate: ACADEMY_START_DATE,
    paymentUrl: PAYMENT_URL,
    infoUrl: INFO_URL
  };
}

/**
 * נקודת קצה ל-Webhook מדף הנחיתה. תומך ב-JSON וגם בטופס רגיל (form-urlencoded).
 * לחבר בפועל לכתובת ה-/exec כשתיסגר פלטפורמת דף הנחיתה.
 */
function doPost(e) {
  try {
    ensureSheets_();
    var payload = parseIncomingPayload_(e);
    logWebhook_(payload);

    // תשובת ליד נכנסת מאינפוריו (וואטסאפ) מגיעה בצורה שונה לגמרי מליד חדש
    // מדף הנחיתה: { "Data": [ { "Value": "<טלפון>", "Message": "<תשובה>" } ] }
    // - אותו מבנה בדיוק כמו במערכת הראשית. מזהים לפי זה ומפנים לטיפול נפרד.
    if (payload && Array.isArray(payload.Data)) {
      handleInforuReply_(payload.Data);
      return jsonResponse_({ ok: true });
    }

    var requiredToken = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
    if (requiredToken && payload.token !== requiredToken) {
      return jsonResponse_({ ok: false, error: 'טוקן לא תקין' });
    }

    var mapped = mapIncomingFields_(payload);
    if (!mapped.contactName && !mapped.phone && !mapped.email && !mapped.company) {
      return jsonResponse_({ ok: false, error: 'לא נמצאו פרטי ליד בבקשה (שם/טלפון/אימייל/חברה)' });
    }

    mapped.status = getDefaultStatus_();
    if (!mapped.source) mapped.source = 'דף נחיתה';

    var lead = addLead(mapped);
    return jsonResponse_({ ok: true, id: lead.id });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/* ============================== Sheets bootstrap ============================== */

function ensureSheets_() {
  // כשהדף נטען, לפעמים הדפדפן שולח כמה בקשות כמעט בו-זמנית (למשל טעינה
  // כפולה/רענון מהיר) - בלי הנעילה כאן, שתי הרצות מקבילות יכולות שתיהן
  // "לראות" שטאב מסוים עדיין לא קיים ולנסות ליצור אותו פעמיים, מה שגורם
  // לשגיאת "כבר קיים גיליון בשם...". הנעילה מבטיחה שרק הרצה אחת יוצרת
  // טאבים בכל רגע נתון.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheetsLocked_();
  } finally {
    lock.releaseLock();
  }
}

function ensureSheetsLocked_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var headers = LEAD_FIELDS.map(function (f) { return f.label; });
  var leadsSheet = ss.getSheetByName(LEADS_SHEET_NAME);
  if (!leadsSheet) {
    leadsSheet = ss.insertSheet(LEADS_SHEET_NAME);
    leadsSheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#16213a')
      .setFontColor('#ffffff');
    leadsSheet.setFrozenRows(1);
    leadsSheet.autoResizeColumns(1, headers.length);
  } else if (leadsSheet.getLastColumn() < headers.length) {
    // הוספת שדות חדשים ל-LEAD_FIELDS (כמו "תשובת ליד") אחרי שהגיליון כבר
    // קיים בשימוש - משלימה רק את הכותרות החסרות בסוף, בלי לגעת בעמודות
    // ובנתונים הקיימים.
    var existingCols = leadsSheet.getLastColumn();
    var missingHeaders = headers.slice(existingCols);
    leadsSheet.getRange(1, existingCols + 1, 1, missingHeaders.length)
      .setValues([missingHeaders])
      .setFontWeight('bold')
      .setBackground('#16213a')
      .setFontColor('#ffffff');
  }

  // "רשימת סטטוסים" - את שולטת בה ישירות מהגיליון (להוסיף/להסיר שורות בעמודה A).
  // הדשבורד רק קורא ממנה, אין כפתור עריכה בממשק בכוונה - הגישה לגיליון
  // עצמו היא ההרשאה היחידה. חריג יחיד: WHATSAPP_SENT_STATUS - סטטוס שהקוד
  // עצמו קובע אוטומטית אחרי שליחה מוצלחת (ר' sendWhatsApp), אז הוא חייב
  // להיות ברשימה כדי שיוצג נכון בתפריטים, גם אם הטאב כבר היה קיים לפני
  // שהתכונה הזו נוספה.
  var statusesSheet = ss.getSheetByName(STATUSES_SHEET_NAME);
  if (!statusesSheet) {
    statusesSheet = ss.insertSheet(STATUSES_SHEET_NAME);
    statusesSheet.getRange(1, 1).setValue('סטטוס').setFontWeight('bold');
    statusesSheet.getRange(2, 1, DEFAULT_STATUSES.length, 1)
      .setValues(DEFAULT_STATUSES.map(function (s) { return [s]; }));
  } else {
    var existingStatuses = getStatusesFromSheet_(statusesSheet);
    if (existingStatuses.indexOf(WHATSAPP_SENT_STATUS) === -1) {
      statusesSheet.getRange(statusesSheet.getLastRow() + 1, 1).setValue(WHATSAPP_SENT_STATUS);
    }
  }

  var templatesSheet = ss.getSheetByName(TEMPLATES_SHEET_NAME);
  if (!templatesSheet) {
    templatesSheet = ss.insertSheet(TEMPLATES_SHEET_NAME);
    templatesSheet.getRange(1, 1, 1, 2).setValues([['שם תבנית', 'מספר תבנית']]).setFontWeight('bold');
    templatesSheet.getRange(2, 1, DEFAULT_TEMPLATES.length, 2).setValues(DEFAULT_TEMPLATES);
  }
}

function getLeadsSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEADS_SHEET_NAME);
}

function getStatusesSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATUSES_SHEET_NAME);
}

function getTemplatesSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TEMPLATES_SHEET_NAME);
}

function logWebhook_(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('WebhookLog');
  if (!sheet) {
    sheet = ss.insertSheet('WebhookLog');
    sheet.getRange(1, 1, 1, 2).setValues([['תאריך קבלה', 'JSON גולמי']]).setFontWeight('bold');
  }
  sheet.appendRow([new Date(), JSON.stringify(payload)]);
}

/* ============================== Leads CRUD ============================== */

/**
 * קוראת את כל הלידים, כולל שורות שנוספו ידנית ישירות בגיליון (לא רק
 * דרך כפתור "הוספת ליד" או ה-webhook) - כדי שאפשר יהיה להזין רשומות
 * גם ישירות באקסל. שורה ידנית לרוב לא תמלא "מזהה"/"תאריך יצירה"/"סטטוס"
 * (עמודות שהדשבורד מנהל לבד) - הפונקציה משלימה אותן אוטומטית בפעם
 * הראשונה שהיא נקראת, כדי שעריכה/מחיקה/שליחת וואטסאפ מהדשבורד יעבדו
 * גם על שורה כזו מכאן ואילך.
 */
function getLeads() {
  ensureSheets_();
  var sheet = getLeadsSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var idIdx = fieldIndex_('id');
  var createdIdx = fieldIndex_('createdAt');
  var updatedIdx = fieldIndex_('updatedAt');
  var statusIdx = fieldIndex_('status');
  var leads = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (isRowEmpty_(row)) continue;

    var now = new Date();
    var needsWriteBack = false;
    if (!row[idIdx]) { row[idIdx] = Utilities.getUuid(); needsWriteBack = true; }
    if (!row[createdIdx]) { row[createdIdx] = now; needsWriteBack = true; }
    if (!row[updatedIdx]) { row[updatedIdx] = now; needsWriteBack = true; }
    if (!row[statusIdx]) { row[statusIdx] = getDefaultStatus_(); needsWriteBack = true; }

    if (needsWriteBack) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
    }

    leads.push(rowToLead_(row));
  }

  return leads.reverse();
}

function fieldIndex_(key) {
  return LEAD_FIELDS.map(function (f) { return f.key; }).indexOf(key);
}

function isRowEmpty_(row) {
  return row.every(function (cell) { return cell === '' || cell === null || cell === undefined; });
}

function addLead(leadData) {
  ensureSheets_();
  var sheet = getLeadsSheet_();
  var id = Utilities.getUuid();
  var now = new Date();

  var row = LEAD_FIELDS.map(function (f) {
    if (f.key === 'id') return id;
    if (f.key === 'createdAt' || f.key === 'updatedAt') return now;
    if (f.key === 'status') return leadData.status || getDefaultStatus_();
    if (f.key === 'lastWhatsAppSentAt') return '';
    return leadData[f.key] || '';
  });

  sheet.appendRow(row);
  return rowToLead_(row);
}

function updateLead(id, leadData) {
  ensureSheets_();
  var sheet = getLeadsSheet_();
  var rowIndex = findLeadRow_(sheet, id);
  if (rowIndex === -1) throw new Error('ליד לא נמצא');

  var now = new Date();
  LEAD_FIELDS.forEach(function (f, i) {
    if (f.key === 'id' || f.key === 'createdAt' || f.key === 'lastWhatsAppSentAt' ||
        f.key === 'replyText' || f.key === 'replyAt') return;
    if (f.key === 'updatedAt') {
      sheet.getRange(rowIndex, i + 1).setValue(now);
      return;
    }
    if (leadData[f.key] !== undefined) {
      sheet.getRange(rowIndex, i + 1).setValue(leadData[f.key]);
    }
  });

  var updatedRow = sheet.getRange(rowIndex, 1, 1, LEAD_FIELDS.length).getValues()[0];
  return rowToLead_(updatedRow);
}

function deleteLead(id) {
  ensureSheets_();
  var sheet = getLeadsSheet_();
  var rowIndex = findLeadRow_(sheet, id);
  if (rowIndex === -1) throw new Error('ליד לא נמצא');
  sheet.deleteRow(rowIndex);
  return true;
}

function findLeadRow_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function rowToLead_(row) {
  var obj = {};
  LEAD_FIELDS.forEach(function (f, i) {
    var value = row[i];
    obj[f.key] = value instanceof Date ? formatDate_(value) : value;
  });
  return obj;
}

function formatDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

/* ============================== Statuses & Templates (read-only from UI) ============================== */

function getStatuses() {
  ensureSheets_();
  return getStatusesFromSheet_(getStatusesSheet_());
}

function getStatusesFromSheet_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function (r) { return r[0]; })
    .filter(String);
}

function getDefaultStatus_() {
  var statuses = getStatuses();
  return statuses[0] || 'חדש';
}

function getTemplates() {
  ensureSheets_();
  var sheet = getTemplatesSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { name: String(r[0]), templateId: String(r[1] || '') }; });
}

/* ============================== WhatsApp (Inforu) ============================== */

function getInforuAuthHeader_() {
  var props = PropertiesService.getScriptProperties();
  // trim() בכוונה - העתקה/הדבקה מתוך טבלת Script Properties בדפדפן נוטה
  // להוסיף רווח מוביל/נגרר בשקט, שגורם ל-"Authentication failed" באינפוריו
  // גם כששני הערכים "נראים" נכונים.
  var username = (props.getProperty('INFORU_USERNAME') || '').trim();
  var token = (props.getProperty('INFORU_TOKEN') || '').trim();
  return 'Basic ' + Utilities.base64Encode(username + ':' + token);
}

/**
 * הרצה ידנית מהעורך (בחירת הפונקציה בתפריט העליון + Run) כדי לבדוק בלי
 * לחשוף את הסודות עצמם אם יש רווחים חבויים ב-Script Properties שגרמו
 * ל-"Authentication failed or illegal IP address" מאינפוריו - לפתוח
 * אחר כך View > Logs (או Executions) כדי לראות את הפלט.
 */
function debugInforuCredentials() {
  var props = PropertiesService.getScriptProperties();
  var rawUsername = props.getProperty('INFORU_USERNAME') || '';
  var rawToken = props.getProperty('INFORU_TOKEN') || '';
  Logger.log('INFORU_USERNAME: אורך=%s, התחיל/הסתיים ברווח=%s, ערך=%s',
    rawUsername.length, rawUsername !== rawUsername.trim(), rawUsername);
  Logger.log('INFORU_TOKEN: אורך=%s, התחיל/הסתיים ברווח=%s',
    rawToken.length, rawToken !== rawToken.trim());
}

/**
 * שליחת וואטסאפ לרשימת לידים נבחרת (checkbox בטבלה) עם תבנית מאושרת אחת.
 * שולחת קריאה אחת לאינפוריו עם כל הנמענים יחד (Recipients תומך במערך).
 */
function sendWhatsApp(leadIds, templateId) {
  ensureSheets_();
  if (!leadIds || !leadIds.length) throw new Error('לא נבחרו נמענים');
  if (!templateId || templateId === 'להשלים') {
    throw new Error('לתבנית הזו עדיין אין מספר אמיתי - להשלים בטאב "תבניות" בגיליון');
  }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('INFORU_USERNAME') || !props.getProperty('INFORU_TOKEN')) {
    throw new Error('חסרים פרטי חיבור לאינפוריו ב-Script Properties (INFORU_USERNAME / INFORU_TOKEN)');
  }

  var sheet = getLeadsSheet_();
  var all = getLeads();
  var byId = {};
  all.forEach(function (l) { byId[l.id] = l; });

  var recipients = [];
  var missingPhone = [];
  leadIds.forEach(function (id) {
    var lead = byId[id];
    if (!lead) return;
    var digits = String(lead.phone || '').replace(/\D/g, '');
    if (!digits) { missingPhone.push(lead.contactName || lead.company || id); return; }
    recipients.push({ Phone: digits, FirstName: lead.contactName || lead.company || '' });
  });

  if (!recipients.length) throw new Error('לאף אחד מהנבחרים אין מספר טלפון תקין');

  var payload = {
    Data: {
      TemplateId: templateId,
      TemplateParameters: [
        { Name: '[#1#]', Type: 'Contact', Value: 'FirstName' }
      ],
      Recipients: recipients
    }
  };

  var response = UrlFetchApp.fetch(INFORU_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: getInforuAuthHeader_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (result.StatusId !== 1) {
    throw new Error('שליחה נכשלה: ' + (result.StatusDescription || 'שגיאה לא ידועה מאינפוריו'));
  }

  var now = new Date();
  var sentAtCol = fieldIndex_('lastWhatsAppSentAt') + 1;
  var statusCol = fieldIndex_('status') + 1;
  leadIds.forEach(function (id) {
    var rowIndex = findLeadRow_(sheet, id);
    if (rowIndex === -1) return;
    sheet.getRange(rowIndex, sentAtCol).setValue(now);
    sheet.getRange(rowIndex, statusCol).setValue(WHATSAPP_SENT_STATUS);
  });

  return { sent: recipients.length, skipped: missingPhone };
}

/**
 * מטפלת בתשובות נכנסות מוואטסאפ (webhook של אינפוריו) - מאתרת את הליד
 * לפי מספר טלפון (9 ספרות אחרונות, כדי לא להיתקע על "0" מול "+972" בהתחלה)
 * וכותבת את התשובה + מועד הקבלה. תשובה חדשה דורסת קודמת בכוונה (לא
 * מצטברת) - מספיק ל"תיעוד תשובת הלקוח" שהתבקש, בלי היסטוריית שיחה מלאה.
 */
function handleInforuReply_(entries) {
  var sheet = getLeadsSheet_();
  var replyCol = fieldIndex_('replyText') + 1;
  var replyAtCol = fieldIndex_('replyAt') + 1;
  var now = new Date();

  entries.forEach(function (entry) {
    var phone = entry && entry.Value;
    var message = entry && entry.Message;
    if (!phone || !message) return;

    var rowIndex = findLeadRowByPhone_(sheet, phone);
    if (rowIndex === -1) return;

    sheet.getRange(rowIndex, replyCol).setValue(message);
    sheet.getRange(rowIndex, replyAtCol).setValue(now);
  });
}

function findLeadRowByPhone_(sheet, phone) {
  var suffix = onlyDigits_(phone).slice(-9);
  if (!suffix) return -1;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var phoneCol = fieldIndex_('phone') + 1;
  var values = sheet.getRange(2, phoneCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (onlyDigits_(values[i][0]).slice(-9) === suffix) return i + 2;
  }
  return -1;
}

function onlyDigits_(value) {
  return String(value || '').replace(/\D/g, '');
}

/* ============================== Webhook payload parsing ============================== */

function parseIncomingPayload_(e) {
  if (e.postData && e.postData.type === 'application/json' && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      // נופל למטה לניסיון פרסור אחר
    }
  }
  if (e.parameter && Object.keys(e.parameter).length) {
    return e.parameter;
  }
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      return {};
    }
  }
  return {};
}

function mapIncomingFields_(payload) {
  var normalized = {};
  Object.keys(payload || {}).forEach(function (k) {
    normalized[normalizeKey_(k)] = payload[k];
  });

  var result = {};
  Object.keys(FIELD_ALIASES).forEach(function (field) {
    var aliases = FIELD_ALIASES[field];
    for (var i = 0; i < aliases.length; i++) {
      var nk = normalizeKey_(aliases[i]);
      if (normalized[nk] !== undefined && normalized[nk] !== '') {
        result[field] = normalized[nk];
        break;
      }
    }
  });
  return result;
}

function normalizeKey_(k) {
  return String(k).trim().toLowerCase().replace(/[\s._-]/g, '');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
