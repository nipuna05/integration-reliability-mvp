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
