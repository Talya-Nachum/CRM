/**
 * Google Sheets <-> InforU WhatsApp + NLPearl voice call integration.
 *
 * Multi-campaign model: every tab (sheet) whose header row includes
 * טלפון נייד is treated as a separate campaign. The template id / outbound
 * (Pearl) id for a tab is taken from its own row 2 (first data row) and
 * applied to every row in that tab, unless a specific row overrides it.
 * To add a new campaign: duplicate a tab, clear the data rows, set the
 * template/campaign id once in row 2, and add contacts - no code changes,
 * no redeploy.
 *
 * Setup:
 * 1. Extensions > Apps Script, paste this file as Code.gs.
 * 2. Project Settings > Script Properties, add:
 *      INFORU_USERNAME    = <the InforU API username>
 *      INFORU_TOKEN       = <the InforU API token>
 *      NLPEARL_ACCOUNT_ID = <NLPearl account id, from platform.nlpearl.ai/app/settings/api>
 *      NLPEARL_SECRET_KEY = <NLPearl API secret key, same settings page>
 * 3. Run sendMessages / startCalls (or attach a time-based trigger) to process
 *    any row whose respective status column is still empty, across every
 *    campaign tab.
 * 4. Deploy > Manage deployments > Web app: Execute as "Me", Who has access "Anyone"
 *    (not "Anyone with Google account" - external servers have no Google login).
 *    Give the resulting /exec URL (or the StableRelay URL in front of it) to
 *    InforU as their reply webhook, and to NLPearl as both the Lead Webhook
 *    and Call Webhook URL (Pearl settings > Overview > Webhooks).
 *
 * Required headers per campaign tab: טלפון נייד, שם פרטי, מספר תבנית, סטטוס,
 * תשובת לקוח, תאריך תשובה, מזהה קמפיין, סטטוס שיחה, מזהה ליד NLPearl,
 * תוצאות שיחה, תאריך שיחה.
 */

// --- InforU (WhatsApp) ---
const INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';
const DEFAULT_TEMPLATE_ID = '267627';

const PHONE_HEADER = 'טלפון נייד';
const NAME_HEADER = 'שם פרטי';
const TEMPLATE_HEADER = 'מספר תבנית';
const STATUS_HEADER = 'סטטוס';
const REPLY_HEADER = 'תשובת לקוח';
const REPLY_DATE_HEADER = 'תאריך תשובה';
const SENT_STATUS = 'נשלח וואטסאפ';

// --- NLPearl (voice calls) ---
const NLPEARL_API_BASE = 'https://api.nlpearl.ai/v2/Outbound/';
const DEFAULT_OUTBOUND_ID = '6a27be5ae83373643a10ae34'; // Pearl id (v2 path param), not the outbound campaign id

const CAMPAIGN_HEADER = 'מזהה קמפיין';
const CALL_STATUS_HEADER = 'סטטוס שיחה';
const CALL_LEAD_ID_HEADER = 'מזהה ליד NLPearl';
const CALL_RESULT_HEADER = 'תוצאות שיחה';
const CALL_DATE_HEADER = 'תאריך שיחה';
const CALL_SENT_STATUS = 'שיחה נשלחה';

// Tabs that are utility/log tabs, never treated as a campaign even if they
// happen to contain a טלפון נייד-like column.
const NON_CAMPAIGN_SHEETS_ = ['WebhookLog', 'NLPearlCampaigns'];

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
 * Custom "קמפיינים" menu, so a single tab can be run on its own instead of
 * always running every campaign tab at once. Appears automatically whenever
 * the spreadsheet is opened (or reloaded).
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
 * Every tab whose header row includes טלפון נייד is a campaign tab.
 */
function getCampaignSheets_(ss) {
  return ss.getSheets().filter(isCampaignSheet_);
}

/**
 * Compares phone numbers by their last 9 digits, so "052-7810099",
 * "0527810099" and "+972527810099" (all the same Israeli number in
 * different formats) are recognized as equal.
 */
function phoneSuffix_(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-9);
}

/**
 * One-off helper: lists NLPearl outbound campaigns (with their real
 * outboundId, distinct from the Pearl/agent id) into a "NLPearlCampaigns"
 * tab, since the Pearl id shown in the platform URL is NOT the outboundId
 * the Make Call API expects.
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
 * One-off helper: checks a specific call's real status directly via GET.
 * Paste a call id into CALL_ID_TO_CHECK before running.
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

  // Tab-wide default: whatever is in row 2 (first data row) of this tab.
  const sheetTemplateId = (templateCol !== -1 && data[1] && data[1][templateCol])
    ? String(data[1][templateCol]) : DEFAULT_TEMPLATE_ID;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).replace(/\D/g, '');
    const name = row[nameCol];
    const status = row[statusCol];
    const templateId = (templateCol !== -1 && row[templateCol]) ? String(row[templateCol]) : sheetTemplateId;
    const rowIndex = i + 1;

    if (!phone || status === SENT_STATUS) continue;

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

  // Tab-wide default: whatever is in row 2 (first data row) of this tab.
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
        // response was plain text (the lead id itself) - use as-is
      }
      sheet.getRange(rowIndex, leadIdCol + 1).setValue(leadId);
    }
  }
}

/**
 * Routes both webhook sources across every campaign tab:
 * - InforU posts: { "Data": [ { "Value": "<phone>", "Message": "<reply text>", ... } ] }
 * - NLPearl posts a Lead/Call object directly (has "pearlId").
 * Every call is also appended raw to a WebhookLog tab for troubleshooting.
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
    }
  } catch (err) {
    logSheet.appendRow([new Date(), 'ERROR: ' + err.message + ' | ' + err.stack]);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleInforuWebhook_(ss, payload) {
  const entry = payload.Data && payload.Data[0];
  if (!entry) return;

  const incomingPhone = phoneSuffix_(entry.Value);
  const incomingText = entry.Message;
  if (!incomingPhone) return;

  const sheets = getCampaignSheets_(ss);
  for (const sheet of sheets) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneCol = headers.indexOf(PHONE_HEADER);
    const replyCol = headers.indexOf(REPLY_HEADER);
    const replyDateCol = headers.indexOf(REPLY_DATE_HEADER);
    if (phoneCol === -1 || replyCol === -1) continue;

    for (let i = 1; i < data.length; i++) {
      const sheetPhone = phoneSuffix_(data[i][phoneCol]);
      if (sheetPhone && sheetPhone === incomingPhone) {
        const rowIndex = i + 1;
        sheet.getRange(rowIndex, replyCol + 1).setValue(incomingText);
        if (replyDateCol !== -1) sheet.getRange(rowIndex, replyDateCol + 1).setValue(new Date());
        return;
      }
    }
  }
}

function handleNlpearlWebhook_(ss, payload) {
  // Only handle Call Webhook events (identified by "to") for the result column -
  // Lead Webhook events (identified by "phoneNumber" instead) don't carry the
  // human-readable outcome (tags/summary) and would overwrite a good result
  // with less useful raw data.
  if (!payload.to) return;

  const incomingPhone = phoneSuffix_(payload.to);
  if (!incomingPhone) return;

  const sheets = getCampaignSheets_(ss);
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
        return;
      }
    }
  }
}
