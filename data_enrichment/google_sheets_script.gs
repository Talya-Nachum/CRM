/**
 * טיוב נתונים אוטומטי - השלמת ח"פ מרשם החברות הישראלי, בתוך Google Sheets.
 *
 * התקנה: Extensions > Apps Script, להדביק את כל הקובץ הזה, לשמור,
 * לרענן את הגיליון, ואז לבחור מהתפריט "טיוב נתונים - ח\"פ".
 */

const DATASTORE_URL = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = 'f00517d5-6f43-474c-879e-5a1e74b1267b';

const AUTO_ACCEPT_THRESHOLD = 90;
const REVIEW_THRESHOLD = 65;
const AMBIGUITY_GAP = 8;
const MAX_CANDIDATES = 5;

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'walla.co.il', 'walla.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com',
  'protonmail.com', 'zoho.com', 'mail.com', '015.net.il', '013.net', 'bezeqint.net'
]);

const LEGAL_SUFFIXES = ['בע"מ', 'בעמ', "בע''מ", 'ltd.', 'ltd', 'inc.', 'inc', 'corp.', 'corp', 'llc', 'co.'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('טיוב נתונים - ח"פ')
    .addItem('הרץ טיוב על הגיליון הפעיל', 'enrichActiveSheet')
    .addItem('הגדר מפתח Anthropic (ל-AI, אופציונלי)', 'promptForApiKey')
    .addToUi();
}

function promptForApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('מפתח Anthropic API', 'הדביקי כאן את המפתח (sk-ant-...):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() == ui.Button.OK) {
    PropertiesService.getUserProperties().setProperty('ANTHROPIC_API_KEY', res.getResponseText().trim());
    ui.alert('נשמר.');
  }
}

function normalizeName(name) {
  if (!name) return '';
  let text = String(name).trim();
  text = text.replace(/["'׳״]/g, '');
  LEGAL_SUFFIXES.forEach(suffix => {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'gi'), '');
  });
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractDomain(email) {
  if (!email || String(email).indexOf('@') === -1) return '';
  return String(email).trim().toLowerCase().split('@').pop();
}

function isCorporateDomain(domain) {
  return !!domain && !GENERIC_DOMAINS.has(domain);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function ratio(a, b) {
  if (!a.length && !b.length) return 100;
  const dist = levenshtein(a, b);
  return (1 - dist / Math.max(a.length, b.length)) * 100;
}

function partialRatio(a, b) {
  if (a.length > b.length) { const t = a; a = b; b = t; }
  if (a.length === 0) return 0;
  let best = 0;
  for (let i = 0; i <= b.length - a.length; i++) {
    best = Math.max(best, ratio(a, b.substr(i, a.length)));
  }
  return best;
}

/** ציון דמיון 0-100 בין שם מהקובץ לשם מועמד מהרשם, סובלני לשמות מקוצרים כמו "טבע" מול "טבע תעשיות פרמצבטיות". */
function similarityScore(query, candidate) {
  const q = normalizeName(query), c = normalizeName(candidate);
  if (!q || !c) return 0;
  const lenRatio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
  const full = ratio(q, c);
  if (lenRatio > 0.7) return full;
  return Math.max(full, partialRatio(q, c) * 0.9);
}

function searchCompany(query, limit) {
  if (!query) return [];
  const url = DATASTORE_URL + '?resource_id=' + encodeURIComponent(RESOURCE_ID) +
    '&q=' + encodeURIComponent(query) + '&limit=' + limit;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const payload = JSON.parse(resp.getContentText());
    return payload.success ? (payload.result.records || []) : [];
  } catch (e) {
    Logger.log('API error for "' + query + '": ' + e);
    return [];
  }
}

function discoverFieldMap() {
  const url = DATASTORE_URL + '?resource_id=' + encodeURIComponent(RESOURCE_ID) + '&limit=1';
  const payload = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  const fields = payload.result.fields.map(f => f.id).filter(id => id !== '_id');

  let hpField = fields.find(f => f.indexOf('מספר חברה') !== -1 || f.indexOf('ח"פ') !== -1);
  if (!hpField) hpField = fields.find(f => f.indexOf('מספר') !== -1) || fields[0];

  let nameFields = fields.filter(f => f.indexOf('שם') !== -1 || f.toLowerCase().indexOf('name') !== -1);
  if (nameFields.length === 0) nameFields = fields;

  return { hpField: hpField, nameFields: nameFields };
}

function findColumnIndex(headers, aliases) {
  const lowered = headers.map(h => String(h).trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lowered.indexOf(alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function aiDisambiguate(row, headers, candidates, fieldMap, apiKey) {
  const rowSummary = headers
    .map((h, i) => h + ': ' + row[i])
    .filter(s => s.split(': ')[1])
    .join('\n');

  const candidatesText = candidates.map((c, i) => {
    const names = fieldMap.nameFields.map(f => c[f]).filter(Boolean).join(' / ');
    return (i + 1) + ') ח"פ=' + c[fieldMap.hpField] + ' | ' + names;
  }).join('\n');

  const prompt = 'אתה מסייע להתאים רשומת לקוח לחברה הנכונה ברשם החברות הישראלי.\n\n' +
    'נתוני הלקוח:\n' + rowSummary + '\n\n' +
    'מועמדים אפשריים:\n' + candidatesText + '\n\n' +
    'החזר אך ורק JSON תקני, ללא טקסט נוסף, בפורמט: {"חפ": "מספר חפ" או null}';

  try {
    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 60,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    const text = (data.content || []).map(b => b.text || '').join('').trim();
    const parsed = JSON.parse(text);
    return parsed['חפ'] ? String(parsed['חפ']) : null;
  } catch (e) {
    Logger.log('AI error: ' + e);
    return null;
  }
}

function enrichActiveSheet() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    ui.alert('לא נמצאו נתונים בגיליון.');
    return;
  }

  const headers = values[0];
  const nameIdx = findColumnIndex(headers, ['שם חברה', 'שם החברה', 'company', 'company_name', 'name']);
  const emailIdx = findColumnIndex(headers, ['אימייל', 'מייל', 'email']);

  if (nameIdx === -1) {
    ui.alert('לא נמצאה עמודת "שם חברה" בשורת הכותרות. יש לוודא שיש עמודה בשם כזה.');
    return;
  }

  const fieldMap = discoverFieldMap();
  const apiKey = PropertiesService.getUserProperties().getProperty('ANTHROPIC_API_KEY');

  const outHeaders = ['ח"פ', 'סטטוס_התאמה', 'שם_חברה_תואם_ברשם', 'ציון_התאמה', 'דומיין_אימייל'];
  let startCol = findColumnIndex(headers, ['ח"פ']);
  if (startCol === -1) {
    startCol = headers.length;
    sheet.getRange(1, startCol + 1, 1, outHeaders.length).setValues([outHeaders]);
  }

  const cache = {};
  let processed = 0;
  let foundCount = 0;

  try {
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const companyName = String(row[nameIdx] || '').trim();
      const email = emailIdx !== -1 ? row[emailIdx] : '';
      const domain = extractDomain(email);

      let result;

      if (!companyName) {
        result = ['', 'לבדיקה - אין שם חברה', '', '', domain];
      } else {
        const cacheKey = normalizeName(companyName);
        if (cache[cacheKey]) {
          result = cache[cacheKey];
        } else {
          let records = searchCompany(companyName, MAX_CANDIDATES);
          Utilities.sleep(150);
          if (records.length === 0 && isCorporateDomain(domain)) {
            records = searchCompany(domain.split('.')[0], MAX_CANDIDATES);
            Utilities.sleep(150);
          }

          const scored = records
            .map(rec => ({ score: Math.max(...fieldMap.nameFields.map(f => similarityScore(companyName, rec[f] || ''))), record: rec }))
            .sort((a, b) => b.score - a.score);

          let hp = '', status = 'לא נמצא', matchedName = '', score = '';

          if (scored.length > 0) {
            const top = scored[0];
            const second = scored.length > 1 ? scored[1].score : 0;
            const ambiguous = scored.length > 1 && (top.score - second) < AMBIGUITY_GAP;

            if (top.score >= AUTO_ACCEPT_THRESHOLD && !ambiguous) {
              hp = String(top.record[fieldMap.hpField] || '');
              status = 'אוטומטי';
              matchedName = String(top.record[fieldMap.nameFields[0]] || '');
              score = Math.round(top.score * 10) / 10;
            } else if (top.score >= REVIEW_THRESHOLD) {
              matchedName = String(top.record[fieldMap.nameFields[0]] || '');
              score = Math.round(top.score * 10) / 10;
              if (apiKey) {
                const aiHp = aiDisambiguate(row, headers, scored.slice(0, 3).map(s => s.record), fieldMap, apiKey);
                if (aiHp) { hp = aiHp; status = 'הוכרע ע"י AI'; } else { status = 'לבדיקה - ספק'; }
              } else {
                status = 'לבדיקה - ספק';
              }
            }
          }

          result = [hp, status, matchedName, score, domain];
          cache[cacheKey] = result;
        }
      }

      // כתיבה מיידית שורה-שורה, כדי שרואים התקדמות בזמן אמת ולא מאבדים כלום אם משהו נכשל באמצע
      sheet.getRange(r + 1, startCol + 1, 1, outHeaders.length).setValues([result]);
      SpreadsheetApp.flush();
      processed++;
      if (result[0]) foundCount++;
    }

    ui.alert('הושלם! ' + foundCount + ' מתוך ' + processed + ' שורות קיבלו ח"פ.');
  } catch (e) {
    ui.alert('הריצה נעצרה בשגיאה אחרי ' + processed + ' שורות (התוצאות עד כה נשמרו).\n\nהשגיאה: ' + e.message);
    throw e;
  }
}
