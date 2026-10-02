# Roadmap

| Phase | Goal | Work | Done when |
|---|---|---|---|
| 0 (done) | Prove the idea | Runner, demo, web + Android app | Demo shows a silent bug caught |
| 1 (weeks 1-2) | Make it demo-able to customers | Host on Azure (HTTPS), push notifications on failure, 2nd demo check | A prospect can see it on their phone |
| 2 (weeks 3-6) | Pilot-ready | Login + per-customer data, secrets for API keys, email/Teams alerts, check editor | First pilot connected to real systems |
| 3 (weeks 7-12) | Repeatable | Scheduling per check, history/trends, incident timeline, Play Store release | 2 pilots, 1 converted to paid |
| 4 (months 4-6) | Recurring revenue | Managed service packaging, billing, onboarding templates | Monthly recurring revenue |

## Sales motion alongside (from research)
1. Sell the **Integration Reliability Audit** (1-3 weeks) using this tool as the demo.
2. Convert audit to monthly monitoring.
3. Only then invest in SaaS features (multi-tenant, self-serve).

## Next 5 concrete tasks
1. Create GitHub repo and push (needs your account).
2. Deploy server to Azure App Service with HTTPS.
3. Add push notifications (Expo + FCM).
4. Write 2 more realistic demo checks (e.g. recruitment -> payroll).
5. Run first 5 customer interviews with the guide in `03-customer-interview-guide.md`.
