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
 *
 * Shared-secret guard (recommended — this is an unauthenticated write endpoint):
 *   Script Properties ▸ add  SECRET = <a long random string>
 * Then the quiz must submit to  .../exec?token=<SECRET>  (a query param, NOT a
 * header — a custom header would trigger a CORS preflight that Apps Script can't
 * answer). If SECRET is unset, no token is required (open endpoint).
 */

var HEADERS = [
  'takenAt', 'name', 'email', 'role', 'course', 'result', 'score', 'passScore',
  'correct', 'total', 'unanswered', 'earned', 'elapsedSeconds', 'seed', 'schema',
  'mode', 'retryWrongOnly', 'bySection', 'missed', 'perQuestion', 'rawPayload'
];
var ROLES = ['Developer', 'Quality Assurance', 'Business Analyst'];

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var name = props.getProperty('SHEET_NAME') || 'Results';
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: set SHEET_ID script property or bind to a Sheet');
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    formatSheet_(sheet);
  }
  return sheet;
}

/**
 * One-time styling so the sheet reads like a dashboard, not a CSV dump:
 *  - frozen, colored, bold header row
 *  - banded rows for readability
 *  - a filter across all columns (sort/filter from the header dropdowns)
 *  - date/time format on takenAt, integer/percent formats on the numeric columns
 *  - conditional colors: result Pass=green / Fail=red; score gradient
 *  - a data-validation dropdown on role
 * Safe to re-run; called once when the header row is first written.
 */
function formatSheet_(sheet) {
  var lastCol = HEADERS.length;
  var col = function (name) { return HEADERS.indexOf(name) + 1; };  // 1-based

  // header
  var header = sheet.getRange(1, 1, 1, lastCol);
  header.setBackground('#1f6f54').setFontColor('#ffffff').setFontWeight('bold')
        .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);

  // banded rows (skip if the sheet already has a banding)
  try {
    if (!sheet.getBandings || sheet.getBandings().length === 0) {
      sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), lastCol)
           .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
    }
  } catch (e) { /* banding optional */ }

  // filter across everything
  try {
    if (sheet.getFilter()) sheet.getFilter().remove();
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), lastCol).createFilter();
  } catch (e) { /* filter optional */ }

  var BIG = 5000;  // format a generous number of future rows
  // date/time
  sheet.getRange(2, col('takenAt'), BIG, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  // numbers
  ['score', 'passScore'].forEach(function (c) {
    sheet.getRange(2, col(c), BIG, 1).setNumberFormat('0.0"%"');
  });
  ['correct', 'total', 'unanswered', 'seed', 'elapsedSeconds'].forEach(function (c) {
    sheet.getRange(2, col(c), BIG, 1).setNumberFormat('0');
  });
  sheet.getRange(2, col('earned'), BIG, 1).setNumberFormat('0.00');

  // role dropdown validation
  var roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ROLES, true).setAllowInvalid(true).build();
  sheet.getRange(2, col('role'), BIG, 1).setDataValidation(roleRule);

  // conditional formatting: result Pass/Fail, and score gradient
  var rules = [];
  var resultRange = sheet.getRange(2, col('result'), BIG, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Pass').setBackground('#d6f5e3').setFontColor('#0b6b3a').setBold(true)
    .setRanges([resultRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Fail').setBackground('#fde2e7').setFontColor('#a11133').setBold(true)
    .setRanges([resultRange]).build());
  var scoreRange = sheet.getRange(2, col('score'), BIG, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .setGradientMaxpointWithValue('#57bb8a', SpreadsheetApp.InterpolationType.NUMBER, '100')
    .setGradientMidpointWithValue('#ffd666', SpreadsheetApp.InterpolationType.NUMBER, '70')
    .setGradientMinpointWithValue('#e67c73', SpreadsheetApp.InterpolationType.NUMBER, '0')
    .setRanges([scoreRange]).build());
  sheet.setConditionalFormatRules(rules);

  // column widths
  var widths = { takenAt: 140, name: 150, email: 210, role: 140, course: 200, result: 70,
                 bySection: 240, missed: 260, perQuestion: 320, rawPayload: 320 };
  Object.keys(widths).forEach(function (k) {
    if (col(k) > 0) sheet.setColumnWidth(col(k), widths[k]);
  });
}

function json_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Health check / deployment probe.  ?reformat=1 re-applies the styling. */
function doGet(e) {
  if (e && e.parameter && e.parameter.reformat) {
    try { reformat(); return json_({ ok: true, reformatted: true }); }
    catch (err) { return json_({ ok: false, error: String(err) }); }
  }
  return json_({ ok: true, service: 'quiz-platform receiver', schema: 'quiz-result/2' });
}

/** Re-apply styling to the existing sheet without clearing data. Run from the
    editor, or hit  .../exec?reformat=1 . Assumes the header row already matches
    HEADERS; if your sheet still has the OLD header, clear it once instead. */
function reformat() {
  formatSheet_(getSheet_());
}

/** Receive one quiz result and append a row. */
function doPost(e) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (secret) {
      var token = e && e.parameter ? e.parameter.token : null;
      if (token !== secret) return json_({ ok: false, error: 'unauthorized' });
    }
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
      var takenAt = p.takenAt ? new Date(p.takenAt) : new Date();
      if (isNaN(takenAt.getTime())) takenAt = new Date();
      sheet.appendRow([
        takenAt,                                   // real Date → the number format renders it
        p.name || '',
        p.email || '',
        p.role || '',
        p.course || '',
        p.passed ? 'Pass' : 'Fail',                // human result for the conditional colors
        p.score, p.passScore,
        p.correct, p.total, p.unanswered, p.earned, p.elapsedSeconds, p.seed,
        p.schema || '',
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
