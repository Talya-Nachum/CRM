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
 *    in the Contacts sheet whose status column is still empty.
 * 5. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)
 *    to get a URL. Give that URL to InforU as the reply webhook once they confirm
 *    the incoming payload format - doPost below is a placeholder until then.
 *
 * Contacts sheet columns: A=Name, B=Phone, C=Status, D=SentDate, E=Reply, F=ReplyDate
 */

const SHEET_NAME = 'Contacts';
const INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';
const TEMPLATE_ID = 'PUT_TEMPLATE_ID_HERE';

function getAuthHeader_() {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('INFORU_USERNAME');
  const token = props.getProperty('INFORU_TOKEN');
  return 'Basic ' + Utilities.base64Encode(username + ':' + token);
}

function sendMessages() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const [name, phone, status] = data[i];
    const rowIndex = i + 1;
    if (!phone || status === 'נשלח') continue;

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
    sheet.getRange(rowIndex, 3).setValue(result.StatusId === 1 ? 'נשלח' : 'שגיאה: ' + result.StatusDescription);
    sheet.getRange(rowIndex, 4).setValue(new Date());
  }
}

/**
 * Placeholder webhook receiver for incoming WhatsApp replies.
 * Field names below are guesses - update once InforU confirms the payload shape.
 */
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  const incomingPhone = payload.Phone || payload.PhoneNumber;
  const incomingText = payload.Text || payload.Message;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const sheetPhone = String(data[i][1]).replace(/\D/g, '');
    if (sheetPhone && sheetPhone === String(incomingPhone).replace(/\D/g, '')) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, 5).setValue(incomingText);
      sheet.getRange(rowIndex, 6).setValue(new Date());
      break;
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
