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
var RESEARCHER_FIELDS = ["title", "full_name", "portfolio_link"];
var RESEARCHER_HEADERS = ["id", "title", "full_name", "portfolio_link"];

function doGet(e) {
  if (e && e.parameter && e.parameter.view === "researchers") {
    try {
      var properties = PropertiesService.getScriptProperties();
      var sheet = getResearchersSheet_(properties);
      return json_({ ok: true, researchers: readResearchers_(sheet, false) });
    } catch (error) {
      return json_({ ok: false, error: error.message || "Could not load researchers" });
    }
  }
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
    if (payload.operation === "listResearchers" || payload.operation === "createResearcher" ||
        payload.operation === "updateResearcher" || payload.operation === "deleteResearcher") {
      var researcherSheet = getResearchersSheet_(properties);
      if (payload.operation === "listResearchers") {
        return json_({ ok: true, researchers: readResearchers_(researcherSheet, true) });
      }
      if (payload.operation === "createResearcher") return createResearcher_(researcherSheet, payload.researcher);
      if (payload.operation === "updateResearcher") return updateResearcher_(researcherSheet, payload);
      return deleteResearcher_(researcherSheet, payload);
    }

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

function getResearchersSheet_(properties) {
  var spreadsheetId = properties.getProperty("SHEET_ID");
  if (!spreadsheetId) throw new Error("Missing SHEET_ID Script Property");
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var name = properties.getProperty("RESEARCHERS_SHEET_NAME") || "Researchers";
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 3, RESEARCHER_HEADERS.length).setValues([
      RESEARCHER_HEADERS,
      [Utilities.getUuid(), "Dr.", "Rodolfo Garau", "https://www.utn.de/person/dr-rodolfo-garau/"],
      [Utilities.getUuid(), "", "Andrei-Catalin Bunaciu", "https://www.utn.de/person/andrei-catalin-bunaciu/"],
    ]);
    sheet.setFrozenRows(1);
  } else {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map(function (value) { return String(value).trim().toLowerCase(); });
    RESEARCHER_HEADERS.forEach(function (header, index) {
      if (headers[index] !== header) throw new Error("Researchers sheet must have these columns in order: " + RESEARCHER_HEADERS.join(", "));
    });
  }
  return sheet;
}

function readResearchers_(sheet, includeIdentity) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, RESEARCHER_HEADERS.length).getDisplayValues()
    .filter(function (row) { return row[0] || row[2]; })
    .map(function (row) {
      var record = { title: String(row[1] || "").trim(), full_name: String(row[2] || "").trim(), portfolio_link: String(row[3] || "").trim() };
      if (includeIdentity) {
        record.id = String(row[0] || "").trim();
        record._fingerprint = researcherFingerprint_(record);
      }
      return record;
    });
}

function createResearcher_(sheet, input) {
  var researcher = normalizeResearcher_(input);
  var id = Utilities.getUuid();
  sheet.appendRow([id, researcher.title, researcher.full_name, researcher.portfolio_link]);
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "createResearcher", id: id });
}

function updateResearcher_(sheet, payload) {
  var row = validateResearcherIdentity_(sheet, payload);
  var researcher = normalizeResearcher_(payload.researcher);
  sheet.getRange(row, 2, 1, RESEARCHER_FIELDS.length).setValues([RESEARCHER_FIELDS.map(function (field) { return researcher[field]; })]);
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "updateResearcher", id: payload.id });
}

function deleteResearcher_(sheet, payload) {
  var row = validateResearcherIdentity_(sheet, payload);
  sheet.deleteRow(row);
  SpreadsheetApp.flush();
  return json_({ ok: true, operation: "deleteResearcher", id: payload.id });
}

function validateResearcherIdentity_(sheet, payload) {
  var id = String(payload.id || "");
  var fingerprint = String(payload.fingerprint || "");
  if (!id || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("This researcher could not be found. Refresh the list and try again.");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("That researcher no longer exists. Refresh and try again.");
  var rows = sheet.getRange(2, 1, lastRow - 1, RESEARCHER_HEADERS.length).getDisplayValues();
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]) !== id) continue;
    var current = { title: String(rows[index][1] || "").trim(), full_name: String(rows[index][2] || "").trim(), portfolio_link: String(rows[index][3] || "").trim() };
    if (!secureEqual_(researcherFingerprint_(current), fingerprint)) throw new Error("This researcher changed since it was loaded. Refresh before editing.");
    return index + 2;
  }
  throw new Error("That researcher no longer exists. Refresh and try again.");
}

function normalizeResearcher_(input) {
  if (!input || typeof input !== "object") throw new Error("Missing researcher information");
  var researcher = {};
  RESEARCHER_FIELDS.forEach(function (field) { researcher[field] = String(input[field] || "").trim(); });
  if (researcher.title.length > 120 || researcher.full_name.length > 200 || researcher.portfolio_link.length > 1000) {
    throw new Error("Researcher information is too long. Please shorten it.");
  }
  if (!researcher.full_name || !researcher.portfolio_link) throw new Error("Full name and portfolio link are required.");
  if (!/^https?:\/\//i.test(researcher.portfolio_link)) throw new Error("Please enter a complete portfolio link starting with https://.");
  return researcher;
}

function researcherFingerprint_(researcher) {
  var canonical = RESEARCHER_FIELDS.map(function (field) { return String(researcher[field] || "").trim(); }).join("\u001f");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
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
