# Integration Reliability MVP

Verifies **business transactions across systems** (e.g. HR -> Payroll), not just API uptime.
Chosen from the 2026 market research: "Integration Reliability Platform".

## Run
    npm start        # http://localhost:3000 (PORT, INTERVAL_SEC env vars)
    npm test

Click **Simulate silent sync bug** in the dashboard, then **Run checks now**: all APIs
still return 200 but the check fails because Payroll received the wrong salary.

## Define a check
Edit `checks.json`: ordered steps with `{{vars}}`, `extract` (save a response field) and
`expect` (status + JSON field assertions). Point the URLs at real systems to use it for real.

## Next
See docs/ for the product brief, roadmap, interview guide and Play Store checklist.

## Alerts
Set ALERT_WEBHOOK_URL to a Teams, Slack or Discord incoming-webhook URL. A message is sent when a check starts failing and when it recovers (not on every failing run).
    $env:ALERT_WEBHOOK_URL='https://...'; npm start

## Login and editing checks
Set APP_PASSWORD to require a login for the API/dashboard and to enable the check editor (dashboard -> Edit checks). Without a password, reading is open but editing only works from the same PC, never through a tunnel/proxy. Edited checks are stored in data/checks.json (override the folder with DATA_DIR).
    $env:APP_PASSWORD='choose-one'; npm start

## Templates
In the dashboard: Edit checks -> Add from template. Templates live in 	emplates/*.json (HR->Payroll, CRM->Billing, webhook delivered, API returns expected value). Add your own by dropping a JSON file there; `<<KEY>>` placeholders become form fields.

## Secrets (API keys)
Dashboard -> Edit checks -> Secrets. Save a key once, then use `{{secret.NAME}}` in a check, e.g. `"headers": { "authorization": "Bearer {{secret.PAYROLL_TOKEN}}" }`. Values stay on the server, are never returned by the API, and are masked (***) in results, history and alerts. Set `SECRETS_KEY` to encrypt them at rest (AES-256-GCM); keep that key safe, without it an encrypted secrets file cannot be read.

## Failure explanations
Failed checks show a plain-English **Likely cause** (dashboard and alerts). Built-in rules cover rounding/truncation, number mismatches, missing fields, 401/403, 404, 429, 5xx and timeouts. Set `ANTHROPIC_API_KEY` to get AI explanations instead (optional `EXPLAIN_MODEL`); only the failure details (secrets masked), never your keys or full responses, are sent, and the same failure is explained once. If the AI call fails, the rules are used.

## Import from curl
Dashboard -> Edit checks -> Import from curl. Paste a curl command; the API is called once, keys in headers/URL are saved as secrets, and a check is built. See docs/07-user-guide-and-test-plan.md for a plain-language guide and QA test plan.

## Email alerts
Set these (e.g. in `.demo.env`, which git ignores): `SMTP_HOST`, `SMTP_PORT` (465 = TLS, default), `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` (comma-separated), optional `ALERT_EMAIL_FROM`. You get an email when a check starts failing and when it recovers. Dashboard -> Edit checks -> Alerts -> **Send test alert** verifies the setup. Gmail needs an *app password* (Google account -> Security -> 2-Step Verification -> App passwords), not your normal password.

### Email through Brevo (when SMTP ports are blocked)
Set `BREVO_API_KEY`, `ALERT_EMAIL_FROM` (a sender verified in Brevo) and `ALERT_EMAIL_TO`. Brevo is used instead of SMTP when its key is set. It uses HTTPS (port 443), so it works on networks that block mail ports.

## UI smoke test
`npm run test:ui` drives the dashboard in a real headless Microsoft Edge (sign in, curl import, template, test, save, remove) and fails on any page error. Needs Edge installed.

## Schedules
Each check may set `"every": "30s" | "5m" | "1h" | "1d"` (editor: the **Runs** menu on each row). Checks without it use `INTERVAL_SEC` (default 60). Shortest allowed: 30s (`MIN_INTERVAL_SEC`). History is kept per check (last 100 runs each), so a frequent check cannot push out a rare one.
