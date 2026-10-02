# Phone App: build, install, test

*Written for: you, installing and testing the Android app for the first time.*

## What the app does
Four tabs:
- **Status**: every check with PASS/FAIL, how long ago it ran, its schedule and 7-day uptime. A red banner when something fails, with the error and the likely cause. Pull down to refresh. **Run checks now** button. The tab shows "Status (1)" while one check is failing.
- **Incidents**: each outage, ONGOING or RESOLVED, with how long it lasted and the likely cause.
- **Add**: paste a curl command, the server calls it once, shows what came back, hides any API key as a secret, and you tick which response values must stay the same. Needs a sign-in.
- **Settings**: signed-in or guest, sign in, sign out / change server, **Turn on phone alerts**, **Send a test alert**.

First screen: type the server address and (optionally) the password. Leave the password empty to look around as a guest if the server allows it.

## Build and install (about 20 minutes, free)
You have already done the Firebase and Expo setup. From a terminal:
```
cd "D:\my\project\mvp 1\mobile"
eas login
eas build -p android --profile preview
```
- Expo builds the app in the cloud (10 to 20 minutes). When done it prints a link and a QR code for an `.apk`.
- Open the link on your phone (or scan the QR), download the `.apk`, and allow "install unknown apps" when Android asks.
- The first build also asks whether Expo should create an Android signing key. Say **yes**; Expo stores it for you.

## Connect the phone to the server
- The server must be running on your PC (`powershell -File start-demo.ps1`) and the phone must be on the **same Wi-Fi**.
- Find your PC's address with `ipconfig` (the IPv4 line, for example `192.168.1.20`). In the app type `192.168.1.20:3000`.
- Windows may ask to allow Node through the firewall the first time. Allow it on private networks.
- The tunnel link also works from anywhere (`https://....trycloudflare.com`), while the PC and tunnel are running.

## Test phone alerts
1. Sign in under **Settings**, then tap **Turn on phone alerts**. Android asks for notification permission: allow.
2. Tap **Send a test alert**. It should say `Phone push: sent to 1 device(s)` and your phone should show a notification.
3. On the dashboard (web) click **Simulate silent sync bug** and **Run checks now**. Your phone should buzz with "Failed: ...". Click **Fix sync** and run again for "Recovered: ...".

## What was verified, and what was not
Verified here (automated):
- The Android bundle builds (653 modules, no errors).
- The shared phone logic is unit-tested and also tested against the real server: sign-in, guest limits, adding a check from curl without leaking the key, registering and removing a phone, duplicate checks.
- The same `App.js` was rendered in a real browser (React Native Web) and clicked through against a real server: unreachable server message, guest mode, wrong and right password, curl import, failure banner with likely cause, incidents ONGOING then RESOLVED, sign out. (`node scripts/mobile-web-smoke.mjs` after `cd mobile && npx expo export --platform web --output-dir dist-web`).

**Not verified (needs your phone):**
- How it looks on a real phone screen (layout, font sizes, dark mode).
- The permission prompt and the real push notification arriving.
- Behaviour on a flaky mobile connection.
Please send screenshots of anything that looks wrong or confusing.

## Known limits
- Server address uses plain `http` for local testing. For anything public it must be `https` (a Play Store build must not allow plain http).
- No editing of existing checks on the phone (add only); use the web dashboard for that.
- Push needs the installed build. It does not work in Expo Go.
- A phone is removed from alerts automatically if the app is uninstalled.
