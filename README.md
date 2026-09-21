# Research Seminar of the Early Modern Lab

A Cloudflare Workers site for the Early Modern Lab seminar series. It keeps the public features of the sister Epistemology Seminars site and adds a password-protected professor workspace for creating, editing, publishing, and deleting events without opening Google Sheets.

## What is included

- Public upcoming and past seminar views
- Featured next seminar, countdowns, speaker links, meeting links, and `.ics` downloads
- Professor editor at `/admin.html`
- Signed, `HttpOnly`, same-site admin sessions verified by the Cloudflare Worker
- Google Apps Script write bridge with optimistic concurrency checks
- The original sheet schema, unchanged:

```text
date,speaker,title,link,speaker_detail,speaker_portfolio,time,end_time,timezone,venue,abstract,published
```

## 1. Prepare the Google Sheet

Create a spreadsheet with a sheet named `Seminars`. You may leave it empty: the Apps Script will add the header row on its first write. Existing columns may be in any order; `date`, `speaker`, and `title` are required, and the script appends any missing optional schema columns without disturbing existing data.

Publish or share the sheet for read-only CSV access, then copy its spreadsheet ID and sheet `gid`. The Worker uses the CSV endpoint only for public reads; all changes go through Apps Script.

## 2. Deploy the Apps Script bridge

First, generate the shared API secret. On macOS or Linux, run:

```sh
openssl rand -hex 32
```

Or, on any machine with Node.js installed:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

This prints a 64-character random value. Copy it temporarily into a password manager; do not commit it to this repository. You will use this **same value twice**: as the Apps Script property named `API_SECRET`, and later as the Cloudflare Worker secret named `APPS_SCRIPT_SECRET`.

1. Open [Google Apps Script](https://script.google.com/), create a project, and paste [`apps-script/Code.gs`](./apps-script/Code.gs) into it.
2. In **Project Settings → Script Properties**, add:
   - `SHEET_ID`: the spreadsheet ID
   - `SHEET_NAME`: `Seminars` (optional; this is the default)
   - `API_SECRET`: the 64-character value generated above
3. Choose **Deploy → New deployment → Web app**.
4. Execute as yourself and allow access to anyone who has the URL. The shared secret still gates every write.
5. Copy the `/exec` deployment URL.

When `Code.gs` changes, create a new deployment version so production receives the update.

## 3. Configure Cloudflare

Replace `GOOGLE_SHEET_CSV_URL` in [`wrangler.toml`](./wrangler.toml) with the sheet's CSV export URL:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=SHEET_GID
```

Install dependencies and add the three production secrets:

```sh
npm install
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
npx wrangler secret put APPS_SCRIPT_SECRET
```

- `ADMIN_PASSWORD` is the fixed password the professor enters.
- `GOOGLE_APPS_SCRIPT_URL` is the deployed Apps Script `/exec` URL.
- `APPS_SCRIPT_SECRET` must exactly equal Apps Script's `API_SECRET` property. When Wrangler prompts for it, paste the 64-character value generated above and press Enter.

The browser never receives either secret. Successful logins receive an eight-hour signed `HttpOnly` cookie; changing `ADMIN_PASSWORD` immediately invalidates existing sessions.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
# Fill in .dev.vars, then:
npm run dev
```

Open the Wrangler URL for the public site and `/admin.html` for the editor.

## Verify and deploy

```sh
npm run check
npm run deploy
```

Recommended production hardening: add a Cloudflare rate-limit rule for `POST /api/admin/login`. The Worker already performs constant-time password comparison, origin checks, body-size limits, secure cookies, server-side validation, and formula-injection protection.


https://script.google.com/macros/s/AKfycbxhI1tXUDfDatP-kTC3AwW52abv2B2BOXd6Hg97Nh0DdFgEtdsZUnVCdCwwlg_0p-8/exec