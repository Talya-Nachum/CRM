/**
 * דף לידים חכם – אגו (CRM Ego)
 * (נבנה מהתבנית הגנרית ב-templates/client-leads-page - ר' BUILD-GUIDE.md שם)
 *
 * גיליון Google Sheets נפרד + Apps Script Web App:
 *  - doPost: קליטת לידים אוטומטית מדף הנחיתה (Webhook), תשובות וואטסאפ,
 *    ותוצאות שיחה מהסוכנת הקולית (ר' "סוכנת קולית" למטה - זה החלק החדש
 *    שלא קיים בתבנית הבסיסית)
 *  - doGet:  ממשק ניהול לידים (הוספה/עריכה/סינון/סטטוסים/שליחת וואטסאפ מרובה-נמענים)
 *
 * שליחת הוואטסאפ משתמשת ב-API של אינפוריו (capi.inforu.co.il) - להעתיק
 * INFORU_USERNAME / INFORU_TOKEN מה-Script Properties של המערכת הראשית של
 * מיטוב לתוך ה-Script Properties של הפרויקט הזה (ר' README.md).
 */

// === התאמה ללקוח ===
var CLIENT_NAME = 'אגו';
var CLIENT_TAGLINE = '';
var INFO_URL = ''; // TODO(client): למלא כשיהיה תוכן ל"מידע נוסף"
// === סוף בלוק ההתאמה הראשי ===

// --- אינפוריו (וואטסאפ) - אותו endpoint ואותו פורמט לכל הלקוחות ---
var INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';

var LEADS_SHEET_NAME = 'לידים';
var STATUSES_SHEET_NAME = 'רשימת סטטוסים';
var TEMPLATES_SHEET_NAME = 'תבניות';

var DEFAULT_STATUSES = ['חדש', 'בתהליך', 'לא מעוניין', 'נשלח וואטסאפ'];

// הסטטוס שנקבע אוטומטית לכל ליד שנבחר בשליחת וואטסאפ מוצלחת (ר' sendWhatsApp)
var WHATSAPP_SENT_STATUS = 'נשלח וואטסאפ';

// TODO(client): למלא מספרי תבנית אמיתיים מאינפוריו כשיהיו
var DEFAULT_TEMPLATES = [
  ['הודעה ראשונית', 'להשלים'],
  ['תזכורת', 'להשלים']
];

// סדר העמודות בגיליון "לידים" - מקור אמת יחיד לכל הקוד וה-UI.
// שדות הסוכנת הקולית (agent*) תמיד בסוף בכוונה - מתועדים אוטומטית
// מה-webhook שלה, לא דרך טופס הוספה/עריכה (ר' handleVoiceAgentWebhook_
// למטה), והוספה באמצע הייתה שוברת עמודות בגיליון קיים (ר' BUILD-GUIDE.md).
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
  { key: 'replyAt', label: 'תאריך תשובה' },
  { key: 'agentTag', label: 'תגית סוכנת' },
  { key: 'agentSummary', label: 'סיכום שיחה' },
  { key: 'agentTranscript', label: 'תמלול שיחה' },
  { key: 'agentCallDate', label: 'תאריך שיחה' },
  { key: 'agentDuration', label: 'משך שיחה' },
  { key: 'agentSentiment', label: 'רגש שיחה' },
  { key: 'agentRecording', label: 'הקלטת שיחה' }
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
    .setTitle('ניהול לידים – ' + CLIENT_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getConfig() {
  return {
    clientName: CLIENT_NAME,
    clientTagline: CLIENT_TAGLINE,
    infoUrl: INFO_URL
  };
}

/**
 * נקודת קצה יחידה לכל ה-webhooks הנכנסים: דף נחיתה (ליד חדש), תשובות
 * וואטסאפ מאינפוריו, ותוצאות שיחה מהסוכנת הקולית. שלושתם מזוהים
 * בנפרד, בסדר הזה:
 *  1. סוכנת קולית - מזוהה לפי פרמטר ה-query  ?source=voiceagent  בכתובת
 *     ה-webhook עצמה (לא לפי צורת ה-body!). זו כתובת ה-webhook שצריך
 *     למסור לספק הסוכנת הקולית: .../exec?source=voiceagent
 *     הזיהוי לפי ה-URL ולא לפי שם שדה בגוף הבקשה בכוונה - הספק הסופי
 *     עדיין לא ידוע, וכך אין תלות בשמות שדות ספציפיים שלו ואין סיכון
 *     להתנגשות עם צורת ה-payload של דף הנחיתה או של אינפוריו.
 *  2. תשובת וואטסאפ מאינפוריו - מזוהה לפי מבנה הגוף: { "Data": [...] }.
 *  3. אחרת - ליד חדש מדף הנחיתה (או כל טופס אחר שמשתמש ב-FIELD_ALIASES).
 */
function doPost(e) {
  try {
    ensureSheets_();
    var payload = parseIncomingPayload_(e);
    logWebhook_(payload);

    if (e.parameter && e.parameter.source === 'voiceagent') {
      handleVoiceAgentWebhook_(payload);
      return jsonResponse_({ ok: true });
    }

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

function getLeads() {
  ensureSheets_();
  var sheet = getLeadsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = readSheetValuesResilient_(sheet, lastRow, LEAD_FIELDS.length);

  var idIdx = fieldIndex_('id');
  var createdIdx = fieldIndex_('createdAt');
  var updatedIdx = fieldIndex_('updatedAt');
  var statusIdx = fieldIndex_('status');
  var leads = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || isRowEmpty_(row)) continue;

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
    // שדות שה-webhook (תשובה/סוכנת קולית) מנהל לבד - לא נדרסים מהטופס.
    if (f.key === 'id' || f.key === 'createdAt' || f.key === 'lastWhatsAppSentAt' ||
        f.key === 'replyText' || f.key === 'replyAt' ||
        f.key === 'agentTag' || f.key === 'agentSummary' || f.key === 'agentTranscript' ||
        f.key === 'agentCallDate' || f.key === 'agentDuration' || f.key === 'agentSentiment' ||
        f.key === 'agentRecording') return;
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
  var username = (props.getProperty('INFORU_USERNAME') || '').trim();
  var token = (props.getProperty('INFORU_TOKEN') || '').trim();
  return 'Basic ' + Utilities.base64Encode(username + ':' + token);
}

function debugInforuCredentials() {
  var props = PropertiesService.getScriptProperties();
  var rawUsername = props.getProperty('INFORU_USERNAME') || '';
  var rawToken = props.getProperty('INFORU_TOKEN') || '';
  Logger.log('INFORU_USERNAME: אורך=%s, התחיל/הסתיים ברווח=%s, ערך=%s',
    rawUsername.length, rawUsername !== rawUsername.trim(), rawUsername);
  Logger.log('INFORU_TOKEN: אורך=%s, התחיל/הסתיים ברווח=%s',
    rawToken.length, rawToken !== rawToken.trim());
}

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

/* ============================== סוכנת קולית (webhook גנרי - ספק עדיין לא סופי) ============================== */

/**
 * מטפלת בתוצאות שיחה שמגיעות מהסוכנת הקולית של הלקוח. מזוהה כבר ב-doPost
 * לפי ?source=voiceagent בכתובת, אז הפונקציה הזו לא צריכה "לנחש" אם
 * ה-payload שייך לה - היא רק צריכה לפרש אותו.
 *
 * שמות השדות בפועל עוד לא ידועים (הספק טרם נבחר) - agentFirst_ בודקת
 * כמה כינויים סבירים לכל שדה (אותו דפוס בדיוק כמו pearlFirst_ שהוכיח
 * את עצמו ב-NLPearl). כשיתברר מי הספק ומה השמות האמיתיים - מוסיפים את
 * השם המדויק לרשימת הכינויים, לא כותבים מחדש.
 *
 * זיהוי הליד: לפי מספר טלפון (9 ספרות אחרונות, כמו בכל שאר הזרמים -
 * ר' findLeadRowByPhone_). אם מגיע payload לטלפון שלא קיים אצלנו כליד -
 * מתעלמים בשקט (מתועד ב-WebhookLog בכל מקרה, ר' logWebhook_ ב-doPost).
 */
function handleVoiceAgentWebhook_(payload) {
  var sheet = getLeadsSheet_();
  var phone = agentFirst_(payload, ['phone', 'phoneNumber', 'to', 'contactPhone', 'Phone']);
  if (!phone) return;

  var rowIndex = findLeadRowByPhone_(sheet, phone);
  if (rowIndex === -1) return;

  var statusCol = fieldIndex_('status') + 1;

  // תגית/תוצאה - כמו אצל פרלה, הופכת להיות הסטטוס של הליד ישירות אם קיימת.
  var tag = agentFirst_(payload, ['tag', 'tags', 'outcome', 'result']);
  if (Array.isArray(tag)) tag = tag[0];
  tag = String(tag || '').trim();
  if (tag) {
    ensureStatusExists_(tag);
    sheet.getRange(rowIndex, statusCol).setValue(tag);
    sheet.getRange(rowIndex, fieldIndex_('agentTag') + 1).setValue(tag);
  }

  // סיכום - מצטבר (לא דורס), כל שורה חדשה עם חותמת זמן, כמו פרלה.
  var summary = agentFirst_(payload, ['summary', 'callSummary', 'notes']);
  if (summary) {
    var summaryCol = fieldIndex_('agentSummary') + 1;
    var summaryCell = sheet.getRange(rowIndex, summaryCol);
    var stamp = formatDate_(new Date()) + ' - ' + String(summary).trim();
    var currentSummary = String(summaryCell.getValue() || '');
    summaryCell.setValue(currentSummary ? (currentSummary + '\n' + stamp) : stamp);
  }

  var transcriptRaw = agentFirst_(payload, ['transcript', 'conversation', 'turns']);
  var transcriptText = agentTranscriptText_(transcriptRaw);
  if (transcriptText) {
    sheet.getRange(rowIndex, fieldIndex_('agentTranscript') + 1).setValue(transcriptText);
  }

  var callDateRaw = agentFirst_(payload, ['startTime', 'callDate', 'startedAt']);
  var callDate = callDateRaw ? new Date(callDateRaw) : new Date();
  sheet.getRange(rowIndex, fieldIndex_('agentCallDate') + 1).setValue(callDate);

  var duration = agentFirst_(payload, ['duration', 'durationSeconds', 'callDuration']);
  if (duration !== '') {
    sheet.getRange(rowIndex, fieldIndex_('agentDuration') + 1).setValue(formatDurationSeconds_(duration));
  }

  var sentiment = agentFirst_(payload, ['sentiment', 'overallSentiment']);
  if (sentiment) {
    sheet.getRange(rowIndex, fieldIndex_('agentSentiment') + 1).setValue(String(sentiment));
  }

  var recording = agentFirst_(payload, ['recording', 'recordingUrl', 'audioUrl']);
  if (recording) {
    sheet.getRange(rowIndex, fieldIndex_('agentRecording') + 1).setValue(String(recording));
  }
}

function agentFirst_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (obj && obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
  }
  return '';
}

/**
 * ממירה תמלול (מערך turns, או מחרוזת מוכנה) לטקסט קריא בפורמט
 * "סוכנת: ...\nליד: ..." - זה הפורמט שמסך השיחה בדשבורד (agentBubblesHtml_
 * ב-JavaScript.html) יודע להפוך לבועות דיבור.
 */
function agentTranscriptText_(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (!Array.isArray(raw)) return '';
  return raw.map(function (turn) {
    if (typeof turn === 'string') return turn;
    var who = String(agentFirst_(turn, ['role', 'speaker', 'from', 'participant']) || '').toLowerCase();
    var text = String(agentFirst_(turn, ['content', 'text', 'message', 'transcript']) || '').trim();
    if (!text) return '';
    var label = (who.indexOf('agent') !== -1 || who.indexOf('assistant') !== -1 ||
      who.indexOf('bot') !== -1) ? 'סוכנת' : 'ליד';
    return label + ': ' + text;
  }).filter(Boolean).join('\n');
}

function formatDurationSeconds_(totalSeconds) {
  var sec = Math.round(Number(totalSeconds) || 0);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
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
