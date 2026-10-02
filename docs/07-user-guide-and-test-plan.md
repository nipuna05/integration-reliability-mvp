# User Guide and QA Test Plan

*Written for: you as the QA tester and first user. No technical background on the app needed.*

## 1. What the app is, in plain words

Think of a **robot tester that works every minute, around the clock**.

You tell it a small story, for example:

> "Create an employee in the HR system. Then look in the Payroll system. The same person must be there with the same salary."

The robot does exactly that on a schedule. When the story stops being true, it tells you right away, says **what is wrong**, and gives a **likely cause**.

**Why this is useful:** most tools only ask "is the website up?". But systems can all be "up" (green, status 200) while the *data is wrong*, for example Payroll got 125000 instead of 125750. Nobody notices until a person complains. This app finds that kind of problem.

**Who it helps:** QA testers, developers, and anyone who connects two or more systems by API (HR to payroll, CRM to billing, shop to email, and so on).

## 2. The 5-minute tour (no setup)

Open the dashboard (http://localhost:3000, or the demo link).

1. Click **Run checks now**. The card turns green: **PASSING**. Three steps have ticks.
2. Click **Simulate silent sync bug**, then **Run checks now**.
3. The card turns red: **FAILING**. Read the **Likely cause** box. It says the salary was rounded down to the nearest 1000.
4. Click **Fix sync**, then **Run checks now**. Green again.

That is the whole idea. The rest of the app is about doing the same thing on *your own* systems.

## 3. Using it on your own API (about 3 minutes)

Sign in first (the password is in the project's `.demo.env` file). Then click **Add or change checks**. The editor has three steps: **1 Add a check**, **2 Your checks** (Test and Save), and collapsed sections for Secrets, Alerts and Advanced JSON.

**Fastest way: import from curl**
1. Take any curl command for an API you use (API docs, Postman "Code snippet", or browser DevTools, Network tab, right-click, Copy as cURL).
2. In step 1, stay on the **Paste a curl command** tab, paste it, and click **Try it**.
3. The app calls the API once and shows the status it got. Any API key in the command is **moved into Secrets automatically**, so it is never visible in the check.
4. Tick the response values that must always stay the same (not times or IDs), then click **Add this check**. It appears in the **Your checks** list.
5. Click **Test them** (runs everything once, nothing saved) then **Save**. A "● unsaved changes" note shows until you save.

A public API to practice with: `curl https://jsonplaceholder.typicode.com/todos/1` (tick `userId`, `id`).

**Other ways to create a check**
- **Start from a template** (the second tab in step 1): pick HR to Payroll, CRM to Billing, Webhook delivered, or API returns expected value, fill in the URLs.
- **Edit the JSON** by hand for multi-step stories.

**Secrets**: save an API key once under Secrets, then use `{{secret.NAME}}` in a header. The value is never shown again and is masked as `***` in results and alerts.

**Alerts**: start the server with `ALERT_WEBHOOK_URL` set to a Teams, Slack or Discord webhook. You get one message when a check starts failing and one when it recovers (not one per run).

## 4. What it does NOT do yet (be honest when testing)
- One shared login only, no separate user accounts.
- Each check can have its own schedule (pick "Runs ..." on its row in the editor: every minute up to every day). Checks without one use the server default, every 60 seconds. The shortest allowed is 30 seconds.
- No email alerts, no phone push notifications.
- JSON request bodies only (no form uploads); curl import supports GET, POST, PUT, PATCH, DELETE.
- Android app only shows status and runs checks. It has no login and cannot create checks.
- No history beyond the last 200 runs. History resets if the server's data folder is cleared.
- Not hosted permanently. The demo link only works while the PC and tunnel are running.

## 5. QA test plan

Mark each as Pass, Fail or Unclear. Write down anything confusing. **Confusing is a finding.**

**A. First impression**
- [ ] Without reading anything, can you tell in 30 seconds what the app does?
- [ ] Does the red "Likely cause" box make sense to a non-expert?

**B. Login and access**
- [ ] Wrong password is rejected; the right one works; Sign out works.
- [ ] As a guest (not signed in) you can view and run checks, but cannot see "Add or change checks".
- [ ] Ten wrong passwords in a minute gives "too many attempts".

**C. Curl import**
- [ ] A plain GET works. A POST with a JSON body works.
- [ ] A command with `-H 'Authorization: Bearer ...'` creates a secret and the check shows `{{secret...}}`, never the key.
- [ ] A key in the URL (`?api_key=...`) is also hidden.
- [ ] Multi-line curl (with `\` line breaks) and Chrome's "Copy as cURL (bash)" work.
- [ ] Errors are clear: not starting with curl, `-F` uploads, non-JSON `-d`, unreachable host, invalid URL.

**D. Checks and editor**
- [ ] Test shows pass/fail per check without saving anything.
- [ ] Save rejects bad JSON, duplicate ids, missing name or url, and unknown `{{secret.X}}`, each with a readable message.
- [ ] A saved check survives a server restart.

**E. Explanations and alerts**
- [ ] Break each thing on purpose and read the explanation: wrong number, missing field, wrong key (401), wrong URL (404), unreachable host.
- [ ] Alert arrives on failure and again on recovery, and not repeatedly while it stays failing.
- [ ] No API key appears anywhere (dashboard, history, alert text, browser network tab).

**F. Robustness**
- [ ] Very slow API (timeout), API returning HTML instead of JSON, empty response.
- [ ] Two browsers open at once. Refresh during a run.

**G. Mobile and portable**
- [ ] Android app opens, shows the same status as the web page, and Run now works.
- [ ] The portable Windows zip starts from `Start.bat` on a PC without Node installed.

## 6. The questions that decide if this is worth continuing
Answer these honestly after a week of using it on something real:
1. Did it catch a problem you would otherwise have found late (or not at all)?
2. How long did it take from opening the app to your first useful check?
3. What did you do by hand that you wished the app did?
4. Would you tell another tester about it? Why or why not?

If the answer to 1 is "no" on your own real work, the idea needs to change before more is built.
