/**
 * Google Sheets <-> InforU WhatsApp integration.
 *
 * Setup:
 * 1. Extensions > Apps Script, paste this file as Code.gs.
 * 2. Project Settings > Script Properties, add:
 *      INFORU_USERNAME = <the InforU API username>
 *      INFORU_TOKEN    = <the InforU API token>
 * 3. Set TEMPLATE_ID below to the approved WhatsApp template id from the InforU panel.
 * 4. Run sendMessages (or attach a time-based trigger) to send to any row
 *    whose status column is still empty.
 * 5. Deploy > Manage deployments > Web app: Execute as "Me", Who has access "Anyone"
 *    (not "Anyone with Google account" - InforU's server has no Google login).
 *    Give the resulting /exec URL to InforU as the reply webhook.
 *
 * The spreadsheet has a single sheet (tab). Columns are looked up by header
 * name (row 1) rather than fixed position, so column order doesn't matter.
 * Required headers: טלפון נייד, שם פרטי, סטטוס, תשובת לקוח, תאריך תשובה.
 */

const INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';
const TEMPLATE_ID = '267627';

const PHONE_HEADER = 'טלפון נייד';
const NAME_HEADER = 'שם פרטי';
const STATUS_HEADER = 'סטטוס';
const REPLY_HEADER = 'תשובת לקוח';
const REPLY_DATE_HEADER = 'תאריך תשובה';
const SENT_STATUS = 'נשלח וואטסאפ';

function getAuthHeader_() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('INFORU_USERNAME');
  const token = props.getProperty('INFORU_TOKEN');
  return 'Basic ' + Utilities.base64Encode(username + ':' + token);
}

function sendMessages() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const phoneCol = headers.indexOf(PHONE_HEADER);
  const nameCol = headers.indexOf(NAME_HEADER);
  const statusCol = headers.indexOf(STATUS_HEADER);

  if (phoneCol === -1 || nameCol === -1 || statusCol === -1) {
    throw new Error('לא נמצאה אחת העמודות: ' + PHONE_HEADER + ' / ' + NAME_HEADER + ' / ' + STATUS_HEADER);
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const phone = String(row[phoneCol]).replace(/\D/g, '');
    const name = row[nameCol];
    const status = row[statusCol];
    const rowIndex = i + 1;

    if (!phone || status === SENT_STATUS) continue;

    const payload = {
      Data: {
        TemplateId: TEMPLATE_ID,
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
      headers: { Authorization: getAuthHeader_() },
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
 * InforU posts: { "Data": [ { "Value": "<phone>", "Message": "<reply text>", ... } ] }
 * Every call is also appended raw to a WebhookLog tab for troubleshooting.
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('WebhookLog') || ss.insertSheet('WebhookLog');
  logSheet.appendRow([new Date(), e.postData.contents]);

  const payload = JSON.parse(e.postData.contents);
  const entry = payload.Data && payload.Data[0];

  if (entry) {
    const incomingPhone = String(entry.Value).replace(/\D/g, '');
    const incomingText = entry.Message;

    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneCol = headers.indexOf(PHONE_HEADER);
    const replyCol = headers.indexOf(REPLY_HEADER);
    const replyDateCol = headers.indexOf(REPLY_DATE_HEADER);

    if (phoneCol !== -1 && replyCol !== -1) {
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
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
