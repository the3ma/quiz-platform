/**
 * quiz-platform — Google Apps Script results receiver (no backend server).
 *
 * Deploy as a Web App (Deploy ▸ New deployment ▸ Web app):
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the /exec URL into each quiz's config.submit.url.
 *
 * The quiz page POSTs a `quiz-result/2` payload as text/plain (NOT
 * application/json — a JSON content-type triggers a CORS preflight that Apps
 * Script cannot answer, so the request would fail before reaching doPost).
 * This script parses the text body as JSON and appends one row per submission.
 *
 * Set the target sheet: Project Settings ▸ Script Properties ▸ add
 *   SHEET_ID = <the spreadsheet id from its URL>
 * (Optional) SHEET_NAME = <tab name>, defaults to "Results".
 * Or leave SHEET_ID unset and bind this script to a Sheet (Extensions ▸
 * Apps Script from the sheet) — it then uses the active spreadsheet.
 */

var HEADERS = [
  'takenAt', 'course', 'schema', 'score', 'passScore', 'passed',
  'correct', 'total', 'unanswered', 'earned', 'elapsedSeconds', 'seed',
  'mode', 'retryWrongOnly', 'bySection', 'missed', 'perQuestion', 'rawPayload'
];

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var name = props.getProperty('SHEET_NAME') || 'Results';
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: set SHEET_ID script property or bind to a Sheet');
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function json_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Health check / deployment probe. */
function doGet() {
  return json_({ ok: true, service: 'quiz-platform receiver', schema: 'quiz-result/2' });
}

/** Receive one quiz result and append a row. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty body' });
    }
    var p = JSON.parse(e.postData.contents);
    if (p.schema !== 'quiz-result/2') {
      // still store it, but flag the unexpected schema rather than silently dropping
      p.__schemaWarning = 'expected quiz-result/2, got ' + String(p.schema);
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);                 // serialize appends — concurrent submits
    try {
      var sheet = getSheet_();
      sheet.appendRow([
        p.takenAt || new Date().toISOString(),
        p.course || '',
        p.schema || '',
        p.score, p.passScore, p.passed,
        p.correct, p.total, p.unanswered, p.earned, p.elapsedSeconds, p.seed,
        p.attempt ? p.attempt.mode : '',
        p.attempt ? p.attempt.retryWrongOnly : '',
        JSON.stringify(p.bySection || []),
        JSON.stringify(p.missed || []),
        JSON.stringify(p.perQuestion || []),
        e.postData.contents
      ]);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
