/**
 * Google Apps Script web app for the Early Modern Lab seminar editor.
 *
 * Required Script Properties:
 *   SHEET_ID  - the Google Spreadsheet ID
 *   API_SECRET - the same value as the Worker's APPS_SCRIPT_SECRET
 * Optional:
 *   SHEET_NAME - defaults to "Seminars"
 */

var EVENT_FIELDS = [
  "date", "speaker", "title", "link", "speaker_detail", "speaker_portfolio",
  "time", "end_time", "timezone", "venue", "abstract", "published"
];

function doGet() {
  return json_({ ok: true, service: "early-modern-lab-seminars" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty("API_SECRET");
    if (!expectedSecret || !secureEqual_(String(payload.secret || ""), expectedSecret)) {
      throw new Error("Unauthorized");
    }

    lock.waitLock(10000);
    var sheet = getSheet_(properties);
    ensureHeaders_(sheet);

    if (payload.operation === "create") return createEvent_(sheet, payload.event);
    if (payload.operation === "update") return updateEvent_(sheet, payload);
    if (payload.operation === "delete") return deleteEvent_(sheet, payload);
    throw new Error("Unsupported operation");
  } catch (error) {
    return json_({ ok: false, error: error.message || "Unknown error" });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function createEvent_(sheet, event) {
  var clean = normalizeEvent_(event);
  var headers = getHeaders_(sheet);
  sheet.appendRow(headers.map(function (field) {
    return EVENT_FIELDS.indexOf(field) >= 0 ? sheetSafe_(clean[field]) : "";
  }));
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "create", row: sheet.getLastRow() });
}

function updateEvent_(sheet, payload) {
  var row = validateIdentity_(sheet, payload);
  var clean = normalizeEvent_(payload.event);
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (field, index) {
    if (EVENT_FIELDS.indexOf(field) >= 0) values[index] = sheetSafe_(clean[field]);
  });
  sheet.getRange(row, 1, 1, headers.length).setValues([values]);
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "update", row: row });
}

function deleteEvent_(sheet, payload) {
  var row = validateIdentity_(sheet, payload);
  sheet.deleteRow(row);
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "delete", row: row });
}

function validateIdentity_(sheet, payload) {
  var row = Number(payload.row);
  if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) {
    throw new Error("That seminar no longer exists. Refresh and try again.");
  }
  var headers = getHeaders_(sheet);
  var current = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  var record = {};
  EVENT_FIELDS.forEach(function (field) { record[field] = ""; });
  headers.forEach(function (field, index) {
    if (EVENT_FIELDS.indexOf(field) >= 0) record[field] = String(current[index] || "").trim();
  });
  if (!secureEqual_(fingerprint_(record), String(payload.fingerprint || ""))) {
    throw new Error("This seminar changed since it was loaded. Refresh before editing it.");
  }
  return row;
}

function normalizeEvent_(input) {
  if (!input || typeof input !== "object") throw new Error("Missing event");
  var event = {};
  EVENT_FIELDS.forEach(function (field) { event[field] = String(input[field] || "").trim(); });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !event.speaker || !event.title) {
    throw new Error("Date, speaker, and title are required");
  }
  event.published = event.published.toLowerCase() === "no" ? "no" : "yes";
  return event;
}

function getSheet_(properties) {
  var spreadsheetId = properties.getProperty("SHEET_ID");
  if (!spreadsheetId) throw new Error("Missing SHEET_ID Script Property");
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var name = properties.getProperty("SHEET_NAME") || "Seminars";
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, EVENT_FIELDS.length).setValues([EVENT_FIELDS]);
    sheet.setFrozenRows(1);
    return;
  }
  var headers = getHeaders_(sheet);
  ["date", "speaker", "title"].forEach(function (field) {
    if (headers.indexOf(field) < 0) throw new Error("Sheet is missing required header: " + field);
  });
  var missing = EVENT_FIELDS.filter(function (field) { return headers.indexOf(field) < 0; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    SpreadsheetApp.flush();
  }
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (value) { return String(value).trim().toLowerCase(); });
}

function fingerprint_(record) {
  var canonical = EVENT_FIELDS.map(function (field) { return String(record[field] || ""); }).join("\u001f");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function sheetSafe_(value) {
  var text = String(value || "");
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function secureEqual_(left, right) {
  left = String(left); right = String(right);
  var difference = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(1, left.length)) || 0) ^
      (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return difference === 0;
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
