const SESSION_COOKIE = "eml_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 32 * 1024;
const EVENT_FIELDS = [
  "date", "speaker", "title", "link", "speaker_detail", "speaker_portfolio",
  "time", "end_time", "timezone", "venue", "abstract", "published",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/seminars.csv") return handlePublicFeed(request, env);
    if (url.pathname === "/api/admin/login") return handleLogin(request, env);
    if (url.pathname === "/api/admin/logout") return handleLogout(request, env);
    if (url.pathname === "/api/admin/session") return handleSession(request, env);
    if (url.pathname === "/api/admin/seminars") return handleAdminSeminars(request, env);

    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(asset, url.pathname);
  },
};

async function handlePublicFeed(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed("GET, HEAD");
  if (!env.GOOGLE_SHEET_CSV_URL || env.GOOGLE_SHEET_CSV_URL.includes("REPLACE_WITH")) {
    return textResponse("Google Sheet feed is not configured", 503);
  }

  try {
    const upstream = await fetch(env.GOOGLE_SHEET_CSV_URL, {
      headers: { accept: "text/csv,*/*;q=0.8" },
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (!upstream.ok) return textResponse(`Google Sheet request failed: HTTP ${upstream.status}`, 502);
    const csv = await upstream.text();
    if (!csv.trim()) return textResponse("Google Sheet feed is empty", 502);
    return new Response(request.method === "HEAD" ? null : csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return textResponse("Failed to fetch Google Sheet feed", 502);
  }
}

async function handleLogin(request, env) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(request)) return jsonResponse({ error: "Invalid request origin" }, 403);
  if (!env.ADMIN_PASSWORD) return jsonResponse({ error: "Admin access is not configured" }, 503);

  const body = await readJson(request);
  if (!body.ok) return jsonResponse({ error: body.error }, body.status);
  if (!(await safeEqual(String(body.value.password || ""), env.ADMIN_PASSWORD))) {
    return jsonResponse({ error: "Incorrect password" }, 401);
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await createSessionToken(expiresAt, env.ADMIN_PASSWORD);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return jsonResponse(
    { ok: true, expiresAt },
    200,
    { "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}` },
  );
}

async function handleLogout(request) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!sameOrigin(request)) return jsonResponse({ error: "Invalid request origin" }, 403);
  return jsonResponse(
    { ok: true },
    200,
    { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` },
  );
}

async function handleSession(request, env) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  return jsonResponse({ authenticated: await isAuthenticated(request, env) });
}

async function handleAdminSeminars(request, env) {
  if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
    return methodNotAllowed("GET, POST, PUT, DELETE");
  }
  if (!(await isAuthenticated(request, env))) return jsonResponse({ error: "Authentication required" }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) {
    return jsonResponse({ error: "Invalid request origin" }, 403);
  }

  if (request.method === "GET") {
    try {
      const records = await loadAdminRecords(env);
      return jsonResponse({ events: records }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return jsonResponse({ error: error.message || "Unable to load seminars" }, 502);
    }
  }

  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    return jsonResponse({ error: "Google Apps Script writes are not configured" }, 503);
  }

  const body = await readJson(request);
  if (!body.ok) return jsonResponse({ error: body.error }, body.status);
  const operation = request.method === "POST" ? "create" : request.method === "PUT" ? "update" : "delete";
  const payload = { operation, secret: env.APPS_SCRIPT_SECRET };

  if (operation === "delete") {
    const identity = validateIdentity(body.value);
    if (!identity.ok) return jsonResponse({ error: identity.error }, 400);
    payload.row = identity.row;
    payload.fingerprint = identity.fingerprint;
  } else {
    const event = validateEvent(body.value.event);
    if (!event.ok) return jsonResponse({ error: event.error }, 400);
    payload.event = event.value;
    if (operation === "update") {
      const identity = validateIdentity(body.value);
      if (!identity.ok) return jsonResponse({ error: identity.error }, 400);
      payload.row = identity.row;
      payload.fingerprint = identity.fingerprint;
    }
  }

  try {
    const result = await callAppsScript(env.GOOGLE_APPS_SCRIPT_URL, payload);
    return jsonResponse({ ok: true, result }, operation === "create" ? 201 : 200, { "cache-control": "no-store" });
  } catch (error) {
    return jsonResponse({ error: error.message || "The update could not be saved" }, 502);
  }
}

async function loadAdminRecords(env) {
  if (!env.GOOGLE_SHEET_CSV_URL || env.GOOGLE_SHEET_CSV_URL.includes("REPLACE_WITH")) {
    throw new Error("Google Sheet feed is not configured");
  }
  const separator = env.GOOGLE_SHEET_CSV_URL.includes("?") ? "&" : "?";
  const response = await fetch(`${env.GOOGLE_SHEET_CSV_URL}${separator}_=${Date.now()}`, {
    headers: { accept: "text/csv" },
    cf: { cacheEverything: false },
  });
  if (!response.ok) throw new Error(`Google Sheet request failed: HTTP ${response.status}`);
  const rows = parseCsv(await response.text());
  return Promise.all(rows.map(async (record, index) => ({
    ...Object.fromEntries(EVENT_FIELDS.map((field) => [field, record[field] || ""])),
    _row: index + 2,
    _fingerprint: await fingerprint(record),
  })));
}

async function callAppsScript(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Apps Script returned an invalid response"); }
  if (!response.ok || !result.ok) throw new Error(result.error || `Apps Script failed: HTTP ${response.status}`);
  return result;
}

function validateEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Missing event" };
  const event = {};
  for (const field of EVENT_FIELDS) {
    const value = String(input[field] ?? "").trim();
    if (value.length > (field === "abstract" ? 12000 : 1000)) return { ok: false, error: `${field} is too long` };
    event[field] = value;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(Date.parse(`${event.date}T00:00:00Z`))) {
    return { ok: false, error: "Date must use YYYY-MM-DD" };
  }
  if (!event.speaker || !event.title) return { ok: false, error: "Date, speaker and title are required" };
  for (const field of ["time", "end_time"]) {
    if (event[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event[field])) return { ok: false, error: `${field} must use HH:MM` };
  }
  if (event.published && !["yes", "no"].includes(event.published.toLowerCase())) {
    return { ok: false, error: "Published must be yes or no" };
  }
  event.published = event.published ? event.published.toLowerCase() : "yes";
  for (const field of ["link", "speaker_portfolio"]) {
    if (event[field]) {
      try {
        const parsed = new URL(event[field]);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { return { ok: false, error: `${field} must be a complete http(s) URL` }; }
    }
  }
  return { ok: true, value: event };
}

function validateIdentity(input) {
  const row = Number(input?.row);
  const fingerprintValue = String(input?.fingerprint || "");
  if (!Number.isInteger(row) || row < 2 || !/^[a-f0-9]{64}$/.test(fingerprintValue)) {
    return { ok: false, error: "This seminar has an invalid record identity. Reload and try again." };
  }
  return { ok: true, row, fingerprint: fingerprintValue };
}

function parseCsv(text) {
  const matrix = [];
  let row = [], cell = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); if (row.some((value) => value.trim())) matrix.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) matrix.push(row);
  if (matrix.length < 2) return [];
  const headers = matrix[0].map((value) => value.trim().toLowerCase());
  return matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

async function fingerprint(record) {
  const canonical = EVENT_FIELDS.map((field) => String(record[field] || "")).join("\u001f");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(digest));
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Request is too large" };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Request is too large" };
    return { ok: true, value: JSON.parse(text || "{}") };
  } catch { return { ok: false, status: 400, error: "Invalid JSON" }; }
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function isAuthenticated(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(/;\s*/).filter(Boolean).map((part) => {
    const index = part.indexOf("="); return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const [version, expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (version !== "v1" || !Number.isInteger(expiresAt) || expiresAt <= Date.now() / 1000 || !signature) return false;
  const expected = await sign(`v1.${expiresAt}`, env.ADMIN_PASSWORD);
  return safeEqual(signature, expected);
}

async function createSessionToken(expiresAt, secret) {
  const value = `v1.${expiresAt}`;
  return `${value}.${await sign(value, secret)}`;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function safeEqual(left, right) {
  const [a, b] = await Promise.all([left, right].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)))));
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < av.length; index += 1) difference |= av[index] ^ bv[index];
  return difference === 0;
}

function bytesToHex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function methodNotAllowed(allow) { return new Response("Method Not Allowed", { status: 405, headers: { allow } }); }
function textResponse(body, status) { return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }); }
function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders },
  });
}

function withSecurityHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (pathname === "/admin" || pathname === "/admin.html") headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { EVENT_FIELDS, fingerprint, parseCsv, validateEvent };
