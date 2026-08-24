/**
 * Stable webhook relay.
 *
 * Deploy this as its OWN separate Apps Script project (standalone, not bound
 * to any spreadsheet) and NEVER touch its deployment again after the first
 * time. External services (InforU, NLPearl) always POST to THIS project's
 * stable /exec URL.
 *
 * If the real webhook handler's URL changes later (e.g. Code.gs gets
 * redeployed under a new URL), update the TARGET_URL script property here -
 * no redeploy needed, and no need to tell InforU/NLPearl anything.
 *
 * Setup:
 * 1. script.google.com -> New project, paste this file as Code.gs.
 * 2. Project Settings -> Script Properties -> add TARGET_URL = the real
 *    webhook /exec URL (from the main integration project).
 * 3. Deploy -> New deployment -> Web app: Execute as "Me", Who has access
 *    "Anyone". Give the resulting /exec URL to InforU and NLPearl - once,
 *    for good.
 */
function doPost(e) {
  const targetUrl = PropertiesService.getScriptProperties().getProperty('TARGET_URL');
  Logger.log('incoming: ' + e.postData.contents.slice(0, 300));
  Logger.log('forwarding to: ' + targetUrl);

  const response = UrlFetchApp.fetch(targetUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: e.postData.contents,
    muteHttpExceptions: true
  });

  Logger.log('target response code: ' + response.getResponseCode());
  Logger.log('target response: ' + response.getContentText().slice(0, 300));

  return ContentService.createTextOutput(response.getContentText())
    .setMimeType(ContentService.MimeType.JSON);
}
