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

test("editor errors hide service details and preserve useful conflict guidance", async () => {
  const site = "https://seminars.example";
  const env = {
    ADMIN_PASSWORD: "test-password",
    GOOGLE_SHEET_CSV_URL: "https://example.com/seminars.csv",
    GOOGLE_APPS_SCRIPT_URL: "https://example.com/bridge",
    APPS_SCRIPT_SECRET: "test-secret",
  };
  const login = await worker.fetch(new Request(`${site}/api/admin/login`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  }), env);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("Provider failure", { status: 500 });
    const listing = await worker.fetch(new Request(`${site}/api/admin/seminars`, {
      headers: { cookie },
    }), env);
    assert.equal(listing.status, 502);
    assert.deepEqual(await listing.json(), { error: "Seminars could not be loaded. Please try again." });

    const save = () => worker.fetch(new Request(`${site}/api/admin/seminars`, {
      method: "POST",
      headers: { cookie, origin: site, "content-type": "application/json" },
      body: JSON.stringify({ event: { date: "2026-11-18", speaker: "Dana", title: "Talk" } }),
    }), env);
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Missing SHEET_ID Script Property" }));
    const unavailable = await save();
    assert.equal(unavailable.status, 502);
    assert.deepEqual(await unavailable.json(), { error: "The seminar could not be saved. Please try again." });

    const conflictMessage = "This seminar changed since it was loaded. Refresh before editing it.";
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: conflictMessage }));
    const conflict = await save();
    assert.equal(conflict.status, 502);
    assert.deepEqual(await conflict.json(), { error: conflictMessage });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
