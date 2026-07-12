/**
 * Google Sheets <-> InforU WhatsApp + NLPearl voice call integration.
 *
 * Setup - InforU (WhatsApp):
 * 1. Extensions > Apps Script, paste this file as Code.gs.
 * 2. Project Settings > Script Properties, add:
 *      INFORU_USERNAME    = <the InforU API username>
 *      INFORU_TOKEN       = <the InforU API token>
 *      NLPEARL_ACCOUNT_ID = <NLPearl account id, from platform.nlpearl.ai/app/settings/api>
 *      NLPEARL_SECRET_KEY = <NLPearl API secret key, same settings page>
 * 3. Add new contacts as new rows in the same sheet for future sends - no need
 *    to redeploy or repeat setup. Each row carries its own template id / campaign id
 *    (see TEMPLATE_HEADER / CAMPAIGN_HEADER below), so different campaigns or
 *    different NLPearl Pearls can be used per row without touching the code.
 * 4. Run sendMessages / startCalls (or attach a time-based trigger) to process
 *    any row whose respective status column is still empty.
 * 5. Deploy > Manage deployments > Web app: Execute as "Me", Who has access "Anyone"
 *    (not "Anyone with Google account" - external servers have no Google login).
 *    Give the resulting /exec URL to InforU as their reply webhook, and to NLPearl
 *    as both the Lead Webhook and Call Webhook URL (Pearl settings > Overview > Webhooks).
 *
 * The spreadsheet has a single sheet (tab). Columns are looked up by header
 * name (row 1) rather than fixed position, so column order doesn't matter.
 * Required headers: טלפון נייד, שם פרטי, מספר תבנית, סטטוס, תשובת לקוח, תאריך תשובה,
 * מזהה קמפיין, סטטוס שיחה, מזהה ליד NLPearl, תוצאת שיחה, תאריך שיחה.
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
const CALL_RESULT_HEADER = 'תוצאת שיחה';
const CALL_DATE_HEADER = 'תאריך שיחה';
const CALL_SENT_STATUS = 'שיחה נשלחה';

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
 * Finds the contacts sheet by its header row instead of assuming it's the
 * first tab - helper tabs like WebhookLog/NLPearlCampaigns can otherwise
 * shift which sheet sits at index 0.
 */
function getContactsSheet_(ss) {
  const sheets = ss.getSheets();
  for (let s = 0; s < sheets.length; s++) {
    const headers = sheets[s].getDataRange().getValues()[0] || [];
    if (headers.indexOf(PHONE_HEADER) !== -1) return sheets[s];
  }
  throw new Error('לא נמצא גיליון עם עמודה בשם: ' + PHONE_HEADER);
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
 * One-off helper: checks a specific call's real status directly via GET,
 * to see whether NLPearl actually completed the call even though our
 * Call/Lead webhook never arrived. Paste a call id into CALL_ID_TO_CHECK
 * before running.
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
  const sheet = getContactsSheet_(SpreadsheetApp.getActiveSpreadsheet());
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const statusCol = headers.indexOf(STATUS_HEADER);
  const templateCol = headers.indexOf(TEMPLATE_HEADER);

  if (phoneCol === -1 || nameCol === -1 || statusCol === -1) {
    throw new Error('לא נמצאה אחת העמודות: ' + PHONE_HEADER + ' / ' + NAME_HEADER + ' / ' + STATUS_HEADER);
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).replace(/\D/g, '');
    const name = row[nameCol];
    const status = row[statusCol];
    const templateId = (templateCol !== -1 && row[templateCol]) ? String(row[templateCol]) : DEFAULT_TEMPLATE_ID;
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

/**
 * Starts an NLPearl outbound call per row that hasn't been called yet.
 * Request shape reconstructed from NLPearl's Python wrapper + docs chat
 * (not yet confirmed against raw HTTP docs) - verify with one test row first.
 */
function startCalls() {
  const sheet = getContactsSheet_(SpreadsheetApp.getActiveSpreadsheet());
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const campaignCol = headers.indexOf(CAMPAIGN_HEADER);
  const callStatusCol = headers.indexOf(CALL_STATUS_HEADER);
  const leadIdCol = headers.indexOf(CALL_LEAD_ID_HEADER);

  if (phoneCol === -1 || callStatusCol === -1) {
    throw new Error('לא נמצאה אחת העמודות: ' + PHONE_HEADER + ' / ' + CALL_STATUS_HEADER);
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = row[phoneCol];
    const name = nameCol !== -1 ? row[nameCol] : '';
    const callStatus = row[callStatusCol];
    const outboundId = (campaignCol !== -1 && row[campaignCol]) ? String(row[campaignCol]) : DEFAULT_OUTBOUND_ID;
    const rowIndex = i + 1;

    if (!phone || callStatus === CALL_SENT_STATUS) continue;

    const payload = {
      phoneNumber: String(phone),
      externalId: String(phone).replace(/\D/g, '') + '-' + Date.now(),
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
 * Routes both webhook sources:
 * - InforU posts: { "Data": [ { "Value": "<phone>", "Message": "<reply text>", ... } ] }
 * - NLPearl posts a Lead/Call object directly (has "pearlId"), matched by lead id
 *   captured in CALL_LEAD_ID_HEADER when the call was started.
 * Every call is also appended raw to a WebhookLog tab for troubleshooting.
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('WebhookLog') || ss.insertSheet('WebhookLog');
  logSheet.appendRow([new Date(), e.postData.contents]);

  const payload = JSON.parse(e.postData.contents);

  if (payload.Data) {
    handleInforuWebhook_(ss, payload);
  } else if (payload.pearlId) {
    handleNlpearlWebhook_(ss, payload);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleInforuWebhook_(ss, payload) {
  const entry = payload.Data && payload.Data[0];
  if (!entry) return;

  const incomingPhone = String(entry.Value).replace(/\D/g, '');
  const incomingText = entry.Message;

  const sheet = getContactsSheet_(ss);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const phoneCol = headers.indexOf(PHONE_HEADER);
  const replyCol = headers.indexOf(REPLY_HEADER);
  const replyDateCol = headers.indexOf(REPLY_DATE_HEADER);

  if (phoneCol === -1 || replyCol === -1) return;

  for (let i = 1; i < data.length; i++) {
    const sheetPhone = String(data[i][phoneCol]).replace(/\D/g, '');
    if (sheetPhone && sheetPhone === incomingPhone) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, replyCol + 1).setValue(incomingText);
      if (replyDateCol !== -1) sheet.getRange(rowIndex, replyDateCol + 1).setValue(new Date());
      break;
    }
  }
}

function handleNlpearlWebhook_(ss, payload) {
  // Match by phone ("to") rather than id - the id returned by Make Call
  // and the id in the Call Webhook payload are different NLPearl concepts.
  const incomingPhone = String(payload.to || '').replace(/\D/g, '');
  if (!incomingPhone) return;

  const sheet = getContactsSheet_(ss);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const phoneCol = headers.indexOf(PHONE_HEADER);
  const resultCol = headers.indexOf(CALL_RESULT_HEADER);
  const dateCol = headers.indexOf(CALL_DATE_HEADER);

  if (phoneCol === -1 || resultCol === -1) return;

  for (let i = 1; i < data.length; i++) {
    const sheetPhone = String(data[i][phoneCol]).replace(/\D/g, '');
    if (sheetPhone && sheetPhone === incomingPhone) {
      const rowIndex = i + 1;
      const info = (payload.collectedInfo || []).map(item => item.name + ': ' + item.value).join(', ');
      const summary = info || ('סטטוס: ' + payload.status);
      sheet.getRange(rowIndex, resultCol + 1).setValue(summary);
      if (dateCol !== -1) sheet.getRange(rowIndex, dateCol + 1).setValue(new Date());
      break;
    }
  }
}
