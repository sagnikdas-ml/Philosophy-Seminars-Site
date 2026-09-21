import test from "node:test";
import assert from "node:assert/strict";
import worker, { EVENT_FIELDS, fingerprint, parseCsv, validateEvent } from "./worker.js";

test("CSV parser preserves commas, escaped quotes, and multiline abstracts", () => {
  const rows = parseCsv('date,speaker,title,abstract\r\n2026-10-01,"Doe, Jane","On ""method""","Line one\nLine two"\r\n');
  assert.deepEqual(rows, [{
    date: "2026-10-01",
    speaker: "Doe, Jane",
    title: 'On "method"',
    abstract: "Line one\nLine two",
  }]);
});

test("event validation normalizes defaults and accepts the complete schema", () => {
  const result = validateEvent({
    date: "2026-10-01",
    speaker: "Jane Doe",
    title: "Experiment and method",
    time: "16:00",
    end_time: "17:30",
    link: "https://example.com/meeting",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.published, "yes");
  assert.equal(result.value.timezone, "");
});

test("event validation rejects unsafe URLs and invalid times", () => {
  assert.equal(validateEvent({ date: "2026-10-01", speaker: "Jane", title: "Talk", link: "javascript:alert(1)" }).ok, false);
  assert.equal(validateEvent({ date: "2026-10-01", speaker: "Jane", title: "Talk", time: "25:00" }).ok, false);
});

test("fingerprints are stable and cover event content", async () => {
  const first = await fingerprint({ date: "2026-10-01", speaker: "Jane", title: "Talk" });
  const same = await fingerprint({ date: "2026-10-01", speaker: "Jane", title: "Talk" });
  const changed = await fingerprint({ date: "2026-10-01", speaker: "Jane", title: "Other" });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, changed);
});

test("an empty CSV feed parses as an empty seminar list", () => {
  assert.deepEqual(parseCsv("date,speaker,title\n"), []);
  assert.deepEqual(parseCsv(""), []);
});

test("an empty upstream sheet becomes a valid header-only public feed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("");
  try {
    const response = await worker.fetch(new Request("https://seminars.example/api/seminars.csv"), {
      GOOGLE_SHEET_CSV_URL: "https://docs.google.com/example.csv",
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `${EVENT_FIELDS.join(",")}\n`);
    assert.match(response.headers.get("cache-control"), /max-age=60/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
