# Product Brief: Integration Reliability

*Date: 2 Oct 2026. Source: 2026 market research (section 7, "Integration Reliability Platform").*

## Problem
Businesses run many connected systems (HR, payroll, CRM, finance). A sync can fail silently:
every API returns 200 but the data is wrong. It is found late, by a customer or by manual rework.

## Solution
Run scheduled **business-transaction checks** across systems. Create a record in system A,
verify it arrived correctly in system B, alert when it did not. Not generic uptime monitoring.

## Why this one
- Matches our skills: API testing, integration testing, automation, full-stack.
- Research warns against generic API monitoring; our angle is business correctness across systems.
- Natural path: audit (service) -> monitoring (managed service) -> SaaS product.
- Small MVP: already working in this repo.

## Target customer
Mid-market SaaS, HR, finance and logistics companies with 3+ integrated systems.
Buyer: CTO, Head of Engineering, Operations lead.

## MVP scope (built)
- Check runner: ordered HTTP steps, variables, extraction, assertions.
- Demo HR -> Payroll systems with a switchable silent bug.
- Web dashboard and Android app (same API).

## Not in MVP
Login/multi-tenant, push alerts, secrets vault, check editor UI, billing.

## Success measures (first 90 days)
- 10+ buyer interviews done.
- 2 paid or free pilots running real checks.
- At least 1 real incident caught that the customer did not know about.

## Risks
- Customers may see it as "just monitoring": mitigate by selling the audit first.
- Access to client systems and credentials: needs a clear security approach.
- Unvalidated demand: do not scale spend before pilots confirm willingness to pay.
