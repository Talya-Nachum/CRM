/**
 * דף לידים חכם – IBM BOB (כנס עם 3 מסלולים מקבילים: שוק ההון / אנרגיה / בריאות)
 * מבוסס על התבנית ב-templates/client-leads-page (ר' BUILD-GUIDE.md שם).
 *
 * גיליון Google Sheets נפרד + Apps Script Web App:
 *  - doPost: קליטת לידים אוטומטית מדף הנחיתה (Webhook) - יחובר בפועל כשיסגרו את זה מול Blue Solutions
 *  - doGet:  ממשק ניהול לידים (הוספה/עריכה/סינון/סטטוסים/שליחת וואטסאפ מרובה-נמענים), עם 3 באנרי סקטור בראש הדף
 *
 * שליחת הוואטסאפ משתמשת ב-API של אינפוריו (capi.inforu.co.il) - להעתיק
 * INFORU_USERNAME / INFORU_TOKEN מה-Script Properties של המערכת הראשית של
 * מיטוב לתוך ה-Script Properties של הפרויקט הזה (ר' README.md).
 */

var CLIENT_NAME = 'IBM BOB';

// כל סקטור = מסלול מקביל בכנס, עם תאריך/מידע/תבניות משלו.
// כל שלושת המסלולים 09:00-13:00 (שעת הסיום לא מוצגת בדשבורד, רק ההתחלה).
// outboundId - מזהה קמפיין החיוג בפרלה (NLPearl) לסקטור הזה. לא משמש
// לחיוג (זה נשאר פעולה ידנית מהמסך של פרלה) - רק לכלי האבחון debugPearlLead
// למטה. TODO(client): למלא לכל סקטור כשיהיה זמין.
var SECTORS = [
  { key: 'capital', label: 'שוק ההון', icon: '📈', color: 'capital', date: '2026-09-09T09:00:00+03:00', infoUrl: 'https://bluesolutions.co.il/bob_finance_fy26/', outboundId: '' },
  { key: 'energy', label: 'אנרגיה', icon: '⚡', color: 'energy', date: '2026-09-16T09:00:00+03:00', infoUrl: 'https://bluesolutions.co.il/bob_energy_fy26/', outboundId: '' },
  { key: 'health', label: 'בריאות', icon: '🏥', color: 'health', date: '2026-09-15T09:00:00+03:00', infoUrl: 'https://bluesolutions.co.il/bob_healthcare_fy26/', outboundId: '' }
];

// --- אינפוריו (וואטסאפ) - אותו endpoint ואותו פורמט לכל הלקוחות ---
var INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';

var LEADS_SHEET_NAME = 'לידים';
var STATUSES_SHEET_NAME = 'רשימת סטטוסים';
var TEMPLATES_SHEET_NAME = 'תבניות';

// TODO(client): רשימת הסטטוסים הראשונית לתהליך המכירה של הלקוח הזה - לשאול
// אותו מראש (ר' BUILD-GUIDE.md, שאלת "אילו סטטוסים רוצים לכל ליד").
// "נשלח וואטסאפ" חייב להישאר ברשימה - הקוד קובע אותו אוטומטית אחרי שליחה
// מוצלחת (ר' WHATSAPP_SENT_STATUS/sendWhatsApp למטה).
var DEFAULT_STATUSES = ['חדש', 'בתהליך', 'לא מעוניין', 'נשלח וואטסאפ'];

// הסטטוס שנקבע אוטומטית לכל ליד שנבחר בשליחת וואטסאפ מוצלחת (ר' sendWhatsApp)
var WHATSAPP_SENT_STATUS = 'נשלח וואטסאפ';

// שמות תבניות לדוגמה בלבד - להחליף את "מספר תבנית" בטאב "תבניות" במספרים
// האמיתיים מאינפוריו (אפשר גם לשנות/להוסיף/למחוק שורות שם בלי לגעת בקוד).
// עמודה שלישית = מפתח הסקטור (capital/energy/health) - קובעת אילו תבניות
// מוצעות בכפתור הוואטסאפ בתוך המודאל של אותו סקטור. שורה עם עמודת סקטור
// ריקה מוצעת בכל הסקטורים (למשל תבנית כללית).
var DEFAULT_TEMPLATES = [
  ['הזמנה - שוק ההון', 'להשלים', 'capital'],
  ['הזמנה - אנרגיה', 'להשלים', 'energy'],
  ['הזמנה - בריאות', 'להשלים', 'health']
];

// סדר העמודות בגיליון "לידים" - מקור אמת יחיד לכל הקוד וה-UI
var LEAD_FIELDS = [
  { key: 'id', label: 'מזהה' },
  { key: 'createdAt', label: 'תאריך יצירה' },
  { key: 'updatedAt', label: 'עדכון אחרון' },
  { key: 'sector', label: 'סקטור' },
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
  { key: 'replyAt', label: 'תאריך תשובה' },
  // שדות פרלה (NLPearl, חיוג אוטומטי) - מתועדים אוטומטית מ-webhook, לא
  // דרך טופס הוספה/עריכה. תמיד בסוף הרשימה בכוונה (ר' הערה ב-ensureSheetsLocked_
  // על migration של עמודות - הוספה באמצע הייתה שוברת גיליונות קיימים).
  { key: 'pearlTag', label: 'תגית פרלה' },
  { key: 'pearlSummary', label: 'סיכום שיחה' },
  { key: 'pearlTranscript', label: 'תמלול שיחה' },
  { key: 'pearlCallDate', label: 'תאריך שיחה' },
  { key: 'pearlDuration', label: 'משך שיחה' },
  { key: 'pearlSentiment', label: 'רגש שיחה' },
  { key: 'pearlRecording', label: 'הקלטת שיחה' }
];

// מיפוי שמות שדות אפשריים שיגיעו מדף הנחיתה (בעברית/אנגלית) לשדות שלנו
var FIELD_ALIASES = {
  // אם דף הנחיתה של סקטור מסוים לא שולח את השדה הזה בכלל (סביר, כי כל
  // סקטור הוא דף נפרד) - הליד נכנס בלי סקטור משויך, ומשייכים אותו ידנית
  // מעריכת הליד בדשבורד. TODO(client): לוודא איך בדיוק כל דף נחיתה מזהה
  // את עצמו (capital/energy/health) ולעדכן את השדה/ה-alias בהתאם כשיהיה ידוע.
  sector: ['סקטור', 'sector', 'track', 'מסלול'],
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
    .setTitle('ניהול לידים – ' + CLIENT_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * מתוקן אוטומטית: הדבקת תא מאקסל לתוך עמודת "נייד" לפעמים מביאה איתה
 * את הנוסחה המקורית (לא רק את המספר שרואים בה) - ומכיוון שתחביר אקסל
 * שונה מ-Sheets, הנוסחה נופלת ל-#ERROR!. onEdit רץ אוטומטית (Apps Script
 * מפעיל פונקציה בשם הזה לבד, בלי הגדרה) בכל עריכה/הדבקה בגיליון, ומתקן
 * מיד תא כזה: שולף את הספרות מתוך טקסט הנוסחה (הן בד"כ עדיין "שם"),
 * וכותב אותן כטקסט רגיל. אם אין ספרות לשלוף - רק מנקה לתא ריק, כדי שלא
 * ישאר #ERROR! שמפיל את קריאת הגיליון (ר' readSheetValuesResilient_).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== LEADS_SHEET_NAME) return;

    var phoneCol = fieldIndex_('phone') + 1;
    if (e.range.getColumn() > phoneCol || e.range.getColumn() + e.range.getNumColumns() - 1 < phoneCol) return;

    var startRow = e.range.getRow();
    var numRows = e.range.getNumRows();
    for (var r = 0; r < numRows; r++) {
      var row = startRow + r;
      if (row < 2) continue;
      fixErrorPhoneCell_(sheet.getRange(row, phoneCol));
    }
  } catch (err) {
    // onEdit לא אמור להפיל עריכה של המשתמשת בשום מקרה - בולעים שגיאות בשקט.
  }
}

function fixErrorPhoneCell_(cell) {
  var value = cell.getValue();
  if (String(value).indexOf('#ERROR') === -1 && String(value).indexOf('#REF') === -1 &&
      String(value).indexOf('#VALUE') === -1 && String(value).indexOf('#N/A') === -1) return;

  var formulaText = cell.getFormula();
  var digits = String(formulaText || '').replace(/\D/g, '');

  cell.setNumberFormat('@');
  cell.setValue(digits);
}

function getConfig() {
  return {
    clientName: CLIENT_NAME,
    sectors: SECTORS
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

    // webhook מפרלה (NLPearl, חיוג אוטומטי) - payload.pearlId קיים תמיד
    // בבקשות מפרלה, זו הדרך לזהות אותן מול webhooks אחרים שמגיעים לאותו
    // doPost. נבדק לפני הכל, כי לפרלה יש צורה משלה שלא תואמת לאף ענף אחר.
    if (payload && payload.pearlId) {
      handlePearlWebhook_(payload);
      return jsonResponse_({ ok: true });
    }

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
    // הוספת שדות חדשים ל-LEAD_FIELDS אחרי שהגיליון כבר קיים בשימוש -
    // משלימה רק את הכותרות החסרות בסוף, בלי לגעת בעמודות ובנתונים הקיימים.
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
    templatesSheet.getRange(1, 1, 1, 3).setValues([['שם תבנית', 'מספר תבנית', 'סקטור']]).setFontWeight('bold');
    templatesSheet.getRange(2, 1, DEFAULT_TEMPLATES.length, 3).setValues(DEFAULT_TEMPLATES);
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
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // הקריאה עצמה רצה בלי נעילה בכוונה - היא נקראת כל 10 שניות מכל לשונית
  // פתוחה, ונעילה שחוסמת אותה (גם לכמה שניות) יוצרת פקק בין הרבה קריאות
  // מקבילות. את ההשלמות (מזהה/תאריך/סטטוס/סקטור) כותבים בחזרה בבלוק אחד
  // בסוף (במקום שורה-שורה) - זה כשלעצמו מקצר את "חלון הזמן" הפגיע שבו
  // עריכה בגיליון (מחיקת שורה וכו') יכולה להתנגש עם הכתיבה מ-כמה שניות
  // לכמעט רגע אחד. הכתיבה עצמה מוגנת בנעילה קצרה שלא חוסמת - אם היא
  // תפוסה, פשוט מדלגים על הכתיבה הפעם (תיכתב בקריאה הבאה בעוד 10 שניות).
  var values = readSheetValuesResilient_(sheet, lastRow, LEAD_FIELDS.length);

  var idIdx = fieldIndex_('id');
  var createdIdx = fieldIndex_('createdAt');
  var updatedIdx = fieldIndex_('updatedAt');
  var statusIdx = fieldIndex_('status');
  var sectorIdx = fieldIndex_('sector');
  var leads = [];
  var anyWriteBack = false;
  var hasUnreadableRow = false;
  // מחושב פעם אחת מחוץ ללולאה בכוונה - getDefaultStatus_() קוראת שוב ל-
  // ensureSheets_() (שנועלת/משחררת נעילה), וקריאה לה בכל שורה בנפרד (כמו
  // שהיה קודם) יצרה הרבה נעילות ברצף באותה ריצה כשמדביקים הרבה שורות
  // חדשות בבת אחת - עד כדי כך שריצה מקבילה (הרענון האוטומטי) הייתה נתקעת
  // ומקבלת "תום הזמן הקצוב של הנעילה".
  var defaultStatus = getDefaultStatus_();

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row) { hasUnreadableRow = true; continue; }
    if (isRowEmpty_(row)) continue;

    var now = new Date();
    if (!row[idIdx]) { row[idIdx] = Utilities.getUuid(); anyWriteBack = true; }
    if (!row[createdIdx]) { row[createdIdx] = now; anyWriteBack = true; }
    if (!row[updatedIdx]) { row[updatedIdx] = now; anyWriteBack = true; }
    if (!row[statusIdx]) { row[statusIdx] = defaultStatus; anyWriteBack = true; }

    // שורה שנוספה ידנית בגיליון בד"כ תכתוב בעמודת "סקטור" את השם בעברית
    // (למשל "שוק ההון") ולא את המפתח הפנימי ("capital") שהדשבורד מסנן
    // לפיו את הטאבים - בלי הנרמול הזה הליד לא יופיע באף טאב.
    var normalizedSector = normalizeSectorValue_(row[sectorIdx]);
    if (normalizedSector !== row[sectorIdx]) { row[sectorIdx] = normalizedSector; anyWriteBack = true; }

    leads.push(rowToLead_(row));
  }

  if (anyWriteBack) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(2000)) {
      try {
        if (hasUnreadableRow) {
          // נתקלנו בשורה עם שגיאת נוסחה שלא ניתן היה לקרוא (ר' readSheetValuesResilient_) -
          // אי אפשר לכתוב אותה בחזרה כחלק מבלוק אחיד, אז חוזרים לכתיבה שורה-שורה
          // (איטי יותר, אבל זה מקרה קצה נדיר).
          for (var r = 1; r < values.length; r++) {
            if (values[r]) sheet.getRange(r + 1, 1, 1, values[r].length).setValues([values[r]]);
          }
        } else {
          // כתיבה אחת מרוכזת לכל בלוק הנתונים, במקום שורה-שורה - מקצרת
          // דרמטית את משך הריצה (וכך את "חלון הזמן" הפגיע שתואר למעלה),
          // בעיקר כשמדביקים הרבה שורות חדשות בבת אחת.
          sheet.getRange(2, 1, values.length - 1, LEAD_FIELDS.length).setValues(values.slice(1));
        }
      } finally {
        lock.releaseLock();
      }
    }
  }

  return leads.reverse();
}

function fieldIndex_(key) {
  return LEAD_FIELDS.map(function (f) { return f.key; }).indexOf(key);
}

function isRowEmpty_(row) {
  return row.every(function (cell) { return cell === '' || cell === null || cell === undefined; });
}

/**
 * קוראת את טווח הנתונים כולל שורת הכותרות. אם יש בגיליון אפילו תא אחד
 * עם ערך שגיאה של נוסחה (#ERROR!/#REF!/#VALUE! וכו' - קורה בקלות בשורה
 * שהודבקה עם נוסחה מקושרת, למשל ניקוי טלפון) - getRange().getValues()
 * על הטווח כולו נכשל בשקט ונופל לגמרי, מה שגורם לדשבורד להיראות ריק
 * לחלוטין (כל הטאבים מציגים 0, גם לידים תקינים). כשזה קורה, קוראים
 * שורה-שורה במקום, ומדלגים רק על השורה הספציפית שבה יש שגיאה (במקום
 * להפיל את כל הרשימה) - חשובה בעיקר בגיליון שמעודכן ידנית/מהדבקת אקסל.
 */
function readSheetValuesResilient_(sheet, lastRow, numCols) {
  try {
    return sheet.getRange(1, 1, lastRow, numCols).getValues();
  } catch (e) {
    var values = [];
    for (var r = 1; r <= lastRow; r++) {
      try {
        values.push(sheet.getRange(r, 1, 1, numCols).getValues()[0]);
      } catch (rowErr) {
        values.push(null);
      }
    }
    return values;
  }
}

/**
 * ממירה מה שנכתב בעמודת "סקטור" בגיליון (למשל "שוק ההון", שזה הכי טבעי
 * להקליד ידנית) למפתח הפנימי של הסקטור (capital/energy/health) שהדשבורד
 * מסנן לפיו את הטאבים. תומכת גם בהקלדת המפתח עצמו. ערך שלא מזוהה נשאר
 * כמו שהוא (הליד לא יופיע באף טאב, אפשר לתקן מעריכת הליד בדשבורד).
 */
function normalizeSectorValue_(raw) {
  var val = String(raw || '').trim();
  if (!val) return '';
  var lower = val.toLowerCase();
  for (var i = 0; i < SECTORS.length; i++) {
    var s = SECTORS[i];
    if (s.key.toLowerCase() === lower || s.label === val) return s.key;
  }
  return val;
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
        f.key === 'replyText' || f.key === 'replyAt' ||
        f.key === 'pearlTag' || f.key === 'pearlSummary' || f.key === 'pearlTranscript' ||
        f.key === 'pearlCallDate' || f.key === 'pearlDuration' || f.key === 'pearlSentiment' ||
        f.key === 'pearlRecording') return;
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
  return sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { name: String(r[0]), templateId: String(r[1] || ''), sector: String(r[2] || '') };
    });
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

  // אין עמודה נפרדת לתאריך שליחה - מתועד כשורה בהערות (מתווספת לקיים,
  // לא דורסת), כדי לא להעמיס עוד עמודה על הטבלה. TODO(client): לוודא שזה
  // עדיין המבנה שהלקוח רוצה - זו הייתה בקשה מפורשת של ארז קדם, לא בהכרח
  // ברירת מחדל אוניברסלית.
  var now = new Date();
  var stamp = formatDate_(now) + ' - נשלח וואטסאפ';
  var notesCol = fieldIndex_('notes') + 1;
  var statusCol = fieldIndex_('status') + 1;
  leadIds.forEach(function (id) {
    var rowIndex = findLeadRow_(sheet, id);
    if (rowIndex === -1) return;
    var notesCell = sheet.getRange(rowIndex, notesCol);
    var currentNotes = String(notesCell.getValue() || '');
    notesCell.setValue(currentNotes ? (currentNotes + '\n' + stamp) : stamp);
    sheet.getRange(rowIndex, statusCol).setValue(WHATSAPP_SENT_STATUS);
  });

  return { sent: recipients.length, skipped: missingPhone };
}

/**
 * מטפלת בתשובות נכנסות מוואטסאפ (webhook של אינפוריו) - מאתרת את הליד
 * לפי מספר טלפון (9 ספרות אחרונות, כדי לא להיתקע על "0" מול "+972" בהתחלה).
 * שני סוגי תשובה שונים לגמרי:
 *  - לחיצה על כפתור בתבנית: אינפוריו שולחת את טקסט הכפתור בתוך
 *    AdditionalInfo (JSON) במפתח ButtonPayload. הטקסט הזה הופך להיות
 *    הסטטוס של הליד ישירות (לא נכתב ל"תשובת וואטסאפ") - בלי טבלת מיפוי
 *    בכוונה, כי טקסט הכפתור משתנה מעת לעת עם עדכוני תבנית; שואבים אותו
 *    כמו שהוא ומוסיפים לרשימת הסטטוסים אוטומטית אם הוא חדש.
 *  - טקסט חופשי אמיתי שהלקוח הקליד: נכתב ל"תשובת ליד" + מועד הקבלה,
 *    בדיוק כמו קודם. תשובה חדשה דורסת קודמת בכוונה (לא מצטברת) - מספיק
 *    ל"תיעוד תשובת הלקוח", בלי היסטוריית שיחה מלאה.
 */
function handleInforuReply_(entries) {
  var sheet = getLeadsSheet_();
  var replyCol = fieldIndex_('replyText') + 1;
  var replyAtCol = fieldIndex_('replyAt') + 1;
  var statusCol = fieldIndex_('status') + 1;
  var now = new Date();

  entries.forEach(function (entry) {
    var phone = entry && entry.Value;
    if (!phone) return;

    var rowIndex = findLeadRowByPhone_(sheet, phone);
    if (rowIndex === -1) return;

    var buttonPayload = extractButtonPayload_(entry);
    if (buttonPayload) {
      ensureStatusExists_(buttonPayload);
      sheet.getRange(rowIndex, statusCol).setValue(buttonPayload);
      return;
    }

    var message = entry && entry.Message;
    if (!message) return;
    sheet.getRange(rowIndex, replyCol).setValue(message);
    sheet.getRange(rowIndex, replyAtCol).setValue(now);
  });
}

function extractButtonPayload_(entry) {
  try {
    var info = JSON.parse((entry && entry.AdditionalInfo) || '{}');
    return String(info.ButtonPayload || '').trim();
  } catch (e) {
    return '';
  }
}

function ensureStatusExists_(status) {
  var sheet = getStatusesSheet_();
  var existing = getStatusesFromSheet_(sheet);
  if (existing.indexOf(status) === -1) {
    sheet.getRange(sheet.getLastRow() + 1, 1).setValue(status);
  }
}

/* ============================== פרלה (NLPearl - חיוג אוטומטי) ============================== */

/**
 * מטפלת בכל אירועי ה-webhook שמגיעים מ-NLPearl. לא שולחים לידים לחיוג
 * מפה בכלל - זה נשאר פעולה ידנית מהמסך של פרלה; כאן רק מתעדים תוצאות.
 *
 * שני סוגי אירועים שונים לגמרי:
 *  - payload.to קיים = אירוע תוצאת שיחה (סיכום/תמלול/תגית/הקלטה). התגית
 *    (payload.tags) היא המקור האמין ביותר לסטטוס - אם יש תגית היא הופכת
 *    להיות הסטטוס של הליד ישירות, בדיוק כמו כפתורי וואטסאפ (ר' handleInforuReply_).
 *  - אין payload.to = אירוע סטטוס-מערכת (בתור/אין מענה/מספר שגוי וכו') לפי
 *    payload.status (קוד מספרי, ר' pearlStatusLabel_). גם זה מעדכן את
 *    הסטטוס של הליד, כדי שהסטטוס תמיד "יעקוב" אחרי פרלה - חוץ מקודי
 *    100/110 שלא מבדילים בין תוצאות אמיתיות ולכן לא משמשים בכוונה.
 */
function handlePearlWebhook_(payload) {
  var sheet = getLeadsSheet_();
  var phone = payload.to || payload.phoneNumber;
  if (!phone) return;

  var rowIndex = findLeadRowByPhone_(sheet, phone);
  if (rowIndex === -1) return;

  var statusCol = fieldIndex_('status') + 1;

  if (payload.to) {
    var tag = extractPearlTag_(payload);
    if (tag) {
      ensureStatusExists_(tag);
      sheet.getRange(rowIndex, statusCol).setValue(tag);
      sheet.getRange(rowIndex, fieldIndex_('pearlTag') + 1).setValue(tag);
    }

    if (payload.summary) {
      // מצטבר (לא דורס) - זו הייתה בקשה מפורשת, בשונה מתשובת וואטסאפ שדורסת.
      var summaryCol = fieldIndex_('pearlSummary') + 1;
      var summaryCell = sheet.getRange(rowIndex, summaryCol);
      var stamp = formatDate_(new Date()) + ' - ' + String(payload.summary).trim();
      var currentSummary = String(summaryCell.getValue() || '');
      summaryCell.setValue(currentSummary ? (currentSummary + '\n' + stamp) : stamp);
    }

    var transcriptText = pearlTranscriptText_(payload.transcript);
    if (transcriptText) {
      sheet.getRange(rowIndex, fieldIndex_('pearlTranscript') + 1).setValue(transcriptText);
    }

    var callDate = payload.startTime ? new Date(payload.startTime) : new Date();
    sheet.getRange(rowIndex, fieldIndex_('pearlCallDate') + 1).setValue(callDate);

    if (payload.duration !== undefined && payload.duration !== null && payload.duration !== '') {
      sheet.getRange(rowIndex, fieldIndex_('pearlDuration') + 1).setValue(formatDurationSeconds_(payload.duration));
    }
    if (payload.overallSentiment) {
      sheet.getRange(rowIndex, fieldIndex_('pearlSentiment') + 1).setValue(String(payload.overallSentiment));
    }
    if (payload.recording) {
      sheet.getRange(rowIndex, fieldIndex_('pearlRecording') + 1).setValue(String(payload.recording));
    }
  } else if (payload.status !== undefined) {
    var label = pearlStatusLabel_(payload.status);
    if (label) {
      ensureStatusExists_(label);
      sheet.getRange(rowIndex, statusCol).setValue(label);
    }
  }
}

function extractPearlTag_(payload) {
  var tags = payload && payload.tags;
  if (!tags) return '';
  if (Array.isArray(tags)) return String(tags[0] || '').trim();
  return String(tags).trim();
}

/**
 * ממירה payload.transcript (מערך turns, לא מחרוזת!) לטקסט קריא בפורמט
 * "פרלה: ...\nליד: ..." - זה הפורמט שמסך השיחה בדשבורד (JavaScript.html,
 * pearlBubblesHtml_) יודע להפוך לבועות דיבור. שמות השדות בכל turn (מי
 * דיבר/מה נאמר) לא מתועדים רשמית ועלולים להיות שונים בגרסת ה-API - אם
 * שדה מגיע ריק, להריץ debugPearlLead ולבדוק payload.transcript הגולמי
 * ב-Logger לפני שמניחים שהשמות למטה נכונים.
 */
function pearlTranscriptText_(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (!Array.isArray(raw)) return '';
  return raw.map(function (turn) {
    if (typeof turn === 'string') return turn;
    var who = String(pearlFirst_(turn, ['role', 'speaker', 'from', 'participant']) || '').toLowerCase();
    var text = String(pearlFirst_(turn, ['content', 'text', 'message', 'transcript']) || '').trim();
    if (!text) return '';
    var label = (who.indexOf('agent') !== -1 || who.indexOf('assistant') !== -1 ||
      who.indexOf('bot') !== -1 || who.indexOf('pearl') !== -1) ? 'פרלה' : 'ליד';
    return label + ': ' + text;
  }).filter(Boolean).join('\n');
}

function pearlFirst_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (obj && obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
  }
  return '';
}

function formatDurationSeconds_(totalSeconds) {
  var sec = Math.round(Number(totalSeconds) || 0);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/**
 * מיפוי קוד סטטוס מספרי (אירוע סטטוס-מערכת, בלי payload.to) לתווית
 * בעברית. קודים 1/10/20/40/300 כולם "בתור/מחייג/ינוסה שוב" - מאוחדים
 * לתווית אחת כי הניואנס הטכני לא רלוונטי ללקוחה. קודים 100/110 ("הצליח"/
 * "לא הצליח") בכוונה לא בשימוש - הם לא מבדילים בין "ניתק לי" ל"ביקש
 * שנחזור מחר"; לזה יש את התגית/הסיכום מאירוע payload.to.
 */
function pearlStatusLabel_(code) {
  var n = Number(code);
  if ([1, 10, 20, 40, 300].indexOf(n) !== -1) return 'ממתין לשיחה';
  if (n === 30) return 'מספר שגוי';
  if ([70, 130, 150].indexOf(n) !== -1) return 'אין מענה';
  if (n === 220) return 'לא לפנות';
  if (n === 500) return 'שגיאת מערכת בפרלה';
  return '';
}

function getNlpearlAuthHeader_() {
  var props = PropertiesService.getScriptProperties();
  var accountId = (props.getProperty('NLPEARL_ACCOUNT_ID') || '').trim();
  var secretKey = (props.getProperty('NLPEARL_SECRET_KEY') || '').trim();
  return 'Bearer ' + accountId + ':' + secretKey;
}

// TODO(client): לשנות לפי הסקטור שרוצים לבדוק, ואז להריץ debugPearlLead מהעורך.
var SECTOR_KEY_FOR_DEBUG = 'capital';

/**
 * כלי אבחון - מריצים ידנית מהעורך (בחירת debugPearlLead בתפריט העליון +
 * Run, אחר כך View > Logs). מדפיס את ה-JSON הגולמי מפרלה לסקטור שנבחר
 * למעלה - הכלי הראשון להריץ אם שדה כלשהו מגיע ריק מה-webhook, כדי לראות
 * את השמות האמיתיים של השדות בגרסת ה-API במקום לנחש. דורש NLPEARL_ACCOUNT_ID
 * ו-NLPEARL_SECRET_KEY ב-Script Properties, ו-outboundId מוגדר לסקטור ב-SECTORS.
 */
function debugPearlLead() {
  var sector = SECTORS.filter(function (s) { return s.key === SECTOR_KEY_FOR_DEBUG; })[0];
  if (!sector || !sector.outboundId) {
    Logger.log('אין outboundId מוגדר לסקטור ' + SECTOR_KEY_FOR_DEBUG + ' ב-SECTORS');
    return;
  }
  var response = UrlFetchApp.fetch('https://api.nlpearl.ai/v2/Outbound/' + sector.outboundId + '/Leads', {
    headers: { Authorization: getNlpearlAuthHeader_() },
    muteHttpExceptions: true
  });
  Logger.log(response.getContentText());
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

/* ============================== ייצוא לאקסל ============================== */

function getOrCreateExportSheet_() {
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('EXPORT_TEMP_SS_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      // הקובץ נמחק/לא נגיש - ניצור אחד חדש במקומו.
    }
  }
  var created = SpreadsheetApp.create('ייצוא זמני - תשתית פנימית של הדשבורד (נא לא למחוק)');
  props.setProperty('EXPORT_TEMP_SS_ID', created.getId());
  return created;
}

/**
 * קובעת כיווניות מימין-לשמאל לגיליון הזמני - גיליון שנוצר עם SpreadsheetApp.create
 * ברירת המחדל שלו LTR, ואין ל-SpreadsheetApp פונקציה ישירה לשנות זאת. דורש
 * הפעלת שירות מתקדם בעורך: "שירותים" (Services) ← "+" ← Google Sheets API ← Add.
 * חשוב: אחרי הוספת השירות חייבים לפרוס גרסה חדשה (Deploy) כדי שהפריסה
 * הפעילה "תדע" עליו - הוספת השירות לבדה לא מספיקה (ר' BUILD-GUIDE.md).
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
      'משמאל, ליד "שירותים" (Services) ללחוץ על ה-"+", לבחור "Google Sheets API" וללחוץ הוסף - ' +
      'ואז לפרוס גרסה חדשה. שגיאה מקורית: ' + e.message);
  }
}

/**
 * בונה קובץ אקסל (xlsx) אמיתי מהשורות שכבר סוננו בדשבורד (headers + rows
 * מגיעים מהלקוח, כדי שהייצוא יכבד בדיוק את מה שמסונן על המסך) - כותבת
 * לגיליון זמני (getOrCreateExportSheet_) כתאים אמיתיים ואז מייצאת אותו
 * ל-xlsx דרך ה-export endpoint של גוגל דוקס עם טוקן ה-OAuth של הסקריפט
 * עצמו. מחזירה בסיס-64 של קובץ ה-xlsx, שהלקוח הופך ל-Blob ומוריד.
 */
function exportLeadsExcel(headers, rows) {
  var tempSs = getOrCreateExportSheet_();
  var sheet = tempSs.getSheets()[0];
  sheet.clear();
  var existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  var numCols = headers.length;
  var numRows = rows.length;

  sheet.getRange(1, 1, 1, numCols).setValues([headers])
    .setFontWeight('bold').setBackground('#f3f4f6');

  // עמודת הטלפון - גרש מוביל (') מכריח פירוש כטקסט, כדי שמספר טלפון לא
  // יהפוך ל"כתיב מדעי" באקסל (למשל 972544701930 -> 9.72544E+11).
  var phoneCol = headers.indexOf('נייד');

  if (numRows > 0) {
    var values = rows.map(function (row) {
      return row.map(function (v, idx) {
        if (idx === phoneCol && v !== '' && v !== null && v !== undefined) {
          return "'" + String(v);
        }
        return v;
      });
    });
    var dataRange = sheet.getRange(2, 1, numRows, numCols);
    dataRange.setNumberFormat('@');
    dataRange.setValues(values);
  }

  sheet.setFrozenRows(1);
  if (numRows > 0) sheet.getRange(1, 1, numRows + 1, numCols).createFilter();
  for (var c = 1; c <= numCols; c++) sheet.autoResizeColumn(c);
  setSheetRtl_(tempSs.getId(), sheet.getSheetId());
  SpreadsheetApp.flush();

  var fileId = tempSs.getId();
  var url = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  return Utilities.base64Encode(response.getBlob().getBytes());
}
