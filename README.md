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
