# Pilot Plan: what we build, how, and how people find it

*Personal project. Everything below is a hypothesis to test, not a forecast.*

## 1. What it is (one sentence)
A tool that tells you when two of your systems are quietly out of sync, e.g. "the employee was created in HR but Payroll got the wrong salary", before a customer or colleague finds out.

## 2. Who it is for (pilot target)
Small teams that connect systems by API: SaaS companies, agencies, HR/finance/ops teams, QA and DevOps engineers. The user is the person who gets blamed when a sync breaks.

## 3. What is in the app today (done)
| Area | Status |
|---|---|
| Check runner (multi-step, variables, assertions across systems) | Done |
| Web dashboard with pass/fail, steps, history | Done |
| Check editor in the dashboard (Test + Save) | Done |
| Login (password) and safe editing | Done |
| Alerts to Teams/Slack/Discord on fail and recover | Done |
| Android app (view status, run now) | Built, not published |
| Portable Windows zip, demo tunnel | Done |

## 4. Feature targets (what makes the end user's life better)
**Must have for a pilot (next 2-4 weeks)**
1. **Ready-made check templates**: pick "HR -> Payroll", "CRM -> Billing", "Webhook delivered", "Signup -> Email sent", fill in your URLs. Removes the blank-page problem. Biggest adoption lever.
2. **API keys / auth headers per check**, stored as secrets (not in the check JSON).
3. **Per-check schedule** (every 5 min, hourly, daily) instead of one global timer.
4. **Plain-English failure explanation** (AI): "Payroll received 125000 but HR sent 125750, looks like rounding to thousands" plus a suggested next step. This is where AI strengthens the product instead of replacing it.
5. **Mobile login** and show the same data as the web.

**Next**
6. Incident timeline (when it broke, how long, when it recovered) and a weekly summary email.
7. Shareable read-only status page for a team or client.
8. Multiple users / workspaces.
9. Phone push notifications (needs a Firebase project).

**Later**
10. Database instead of files, permanent hosting, billing, Google Play release.

## 5. How we build it
- Keep the current stack: Node server (no framework), plain-HTML dashboard, Expo app. Small and easy to change.
- Order: templates -> secrets -> schedules -> AI explanation -> mobile login. Each is one small, tested release pushed to GitHub.
- Replace file storage with SQLite, then Postgres, when more than one person uses it.
- Hosting: Cloudflare tunnel for demos now; a free/cheap always-on host when someone depends on it.
- Rules: tests for each feature, never store real secrets in git, no employer details in any file.

## 6. How to get attention (cheap, honest, one at a time)
1. **A 60-second demo video**: everything shows green (200 OK), then the sync bug is switched on and the check turns red with the salary mismatch. This one clip is the whole pitch.
2. **Build in public**: post the video and each weekly improvement on LinkedIn and dev.to. People follow progress.
3. **Template library as the hook**: publish "10 checks every integration should have" as free templates people can copy.
4. **Free "integration health check" for 3 small teams** in exchange for feedback and a short quote. Gets real usage and stories.
5. **Communities**: QA, DevOps and SaaS-founder groups, answering questions about silent integration failures (help first, link second).
6. **Consider open-sourcing the check runner** later to earn trust, keeping hosting and the AI features as the product.

## 7. What counts as success for the pilot
- 3 people outside you run it on their own systems.
- At least 1 real failure caught that they did not know about.
- At least 1 person says they would keep using it (or pay).
If none of these happen after about 8 weeks, change the idea or the audience before building more.

## 8. Play Store decision
Only after the success points above, plus login on mobile and a permanent HTTPS host.
