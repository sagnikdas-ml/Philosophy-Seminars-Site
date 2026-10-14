# Research Seminar of the Early Modern Lab

A Cloudflare Pages site for the Early Modern Lab seminar series. It keeps the public features of the sister Epistemology Seminars site and adds a password-protected professor workspace for creating, editing, publishing, and deleting events without opening Google Sheets.

Production: [seminars.danajalobeanu.com](https://seminars.danajalobeanu.com/). Professor editor: [admin](https://seminars.danajalobeanu.com/admin). Pages address: [philosophy-seminars-site.pages.dev](https://philosophy-seminars-site.pages.dev/).

## Quick migration from Workers to Pages

The public files and server behavior are preserved. `npm run build` copies `public/` to `dist/` and copies `worker.js` to `dist/_worker.js`, which Pages runs as an advanced-mode Pages Function. The existing Google Sheet and Apps Script deployment stay in use.

From this repository, run:

```sh
npm ci
npx wrangler login
npx wrangler pages project create philosophy-seminars-site --production-branch main --force
npx wrangler pages secret put ADMIN_PASSWORD --project-name philosophy-seminars-site
npx wrangler pages secret put APPS_SCRIPT_SECRET --project-name philosophy-seminars-site
npm run check
npm run deploy -- --branch main --project-name philosophy-seminars-site
```

Skip project creation if that Pages project already exists. The installed Wrangler requires `--force` on initial project creation to create a Pages project rather than delegating to Workers; subsequent deployments use the existing Pages project without that flag. Enter the **same secret values used by the existing Worker** at the two secret prompts. Cloudflare cannot display an existing encrypted secret: retrieve the password from your password manager and the shared API secret from the Apps Script `API_SECRET` property. `GOOGLE_SHEET_CSV_URL` and `GOOGLE_APPS_SCRIPT_URL` are already configured in `wrangler.toml`.

If the old secrets are lost, run `powershell -ExecutionPolicy Bypass -File scripts/set-pages-secrets.ps1` on Windows. It prompts for a new admin password, generates a new random shared secret, and saves both to Pages. Copy the displayed shared secret into the existing Apps Script project's **Project Settings > Script Properties > API_SECRET**, save it, and then deploy Pages. This rotates the bridge secret, so the old Worker will no longer be able to write through Apps Script with its old secret.

Wrangler prints the deployed Pages URL. Check the public seminar list and `/admin.html`, including logging in and loading existing events, before moving any custom domain. Add the domain under the Pages project's **Custom domains** settings, and remove the old Worker's route or custom-domain binding for that hostname when cutting over. Keep the original Worker available until the Pages site is verified.

The hostname must remain listed under the Pages project's **Custom domains** as well as have its CNAME pointed to `philosophy-seminars-site.pages.dev`. A CNAME alone does not attach the hostname to Pages. For the production hostname, remove only its old Worker association during migration and retain its new Pages association.

For a new Pages project connected to this GitHub repository instead, use framework preset **None**, build command **`npm run build`**, build output directory **`dist`**, and production branch **`main`**. Add the same two secrets under **Settings > Variables and Secrets**, then deploy again. Use the Pages creation flow, which has a build output directory; the Workers creation flow has a `wrangler deploy` command.

See Cloudflare's [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/), and [custom-domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/) documentation.

## What is included

- Public upcoming and past seminar views
- Featured next seminar, countdowns, speaker links, meeting links, and `.ics` downloads
- Professor editor at `/admin.html`
- Signed, `HttpOnly`, same-site admin sessions verified by the Pages Function
- Google Apps Script write bridge with optimistic concurrency checks
- The original sheet schema, unchanged:

```text
date,speaker,title,link,speaker_detail,speaker_portfolio,time,end_time,timezone,venue,abstract,published
```

## 1. Prepare the Google Sheet

Create a spreadsheet with a sheet named `Seminars`. You may leave it empty: the Apps Script will add the header row on its first write. Existing columns may be in any order; `date`, `speaker`, and `title` are required, and the script appends any missing optional schema columns without disturbing existing data.

Publish or share the sheet for read-only CSV access, then copy its spreadsheet ID and sheet `gid`. The Pages Function uses the CSV endpoint only for public reads; all changes go through Apps Script.

## 2. Deploy the Apps Script bridge

First, generate the shared API secret. On macOS or Linux, run:

```sh
openssl rand -hex 32
```

Or, on any machine with Node.js installed:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

This prints a 64-character random value. Copy it temporarily into a password manager; do not commit it to this repository. You will use this **same value twice**: as the Apps Script property named `API_SECRET`, and later as the Cloudflare Pages secret named `APPS_SCRIPT_SECRET`.

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

Set `GOOGLE_APPS_SCRIPT_URL` in `wrangler.toml` to the deployed Apps Script `/exec` URL. Install dependencies, create the Pages project if it does not already exist, and add the two production secrets:

```sh
npm ci
npx wrangler login
npx wrangler pages project create philosophy-seminars-site --production-branch main --force
npx wrangler pages secret put ADMIN_PASSWORD --project-name philosophy-seminars-site
npx wrangler pages secret put APPS_SCRIPT_SECRET --project-name philosophy-seminars-site
```

- `ADMIN_PASSWORD` is the fixed password the professor enters.
- `GOOGLE_APPS_SCRIPT_URL` is the deployed Apps Script `/exec` URL, configured as a variable in `wrangler.toml`.
- `APPS_SCRIPT_SECRET` must exactly equal Apps Script's `API_SECRET` property. When Wrangler prompts for it, paste the 64-character value generated above and press Enter.

The browser never receives either secret. Successful logins receive an eight-hour signed `HttpOnly` cookie; changing `ADMIN_PASSWORD` immediately invalidates existing sessions. Set secrets before deploying the version that uses them.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars
# Fill in .dev.vars, then:
npm run dev
```

Open the Wrangler URL for the public site and `/admin.html` for the editor. `npm run dev` builds the Pages output before starting the local Pages server; restart it after changing source files.

## Verify and deploy

```sh
npm run check
npm run deploy -- --branch main --project-name philosophy-seminars-site
```

Recommended production hardening: add a Cloudflare rate-limit rule for `POST /api/admin/login`. The Pages Function already performs constant-time password comparison, origin checks, body-size limits, secure cookies, server-side validation, and formula-injection protection.


https://script.google.com/macros/s/AKfycbxhI1tXUDfDatP-kTC3AwW52abv2B2BOXd6Hg97Nh0DdFgEtdsZUnVCdCwwlg_0p-8/exec
