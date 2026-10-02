# Google Play Release Checklist

## Before building
- [ ] Host the server online over HTTPS (Android release builds block plain http).
- [ ] Set the default server URL in `mobile/App.js` to the hosted URL.
- [ ] Add login (a reviewer and real users should not see open data).
- [ ] Replace placeholder icons in `mobile/assets/` with real branding.

## Accounts
- [ ] Google Play Console developer account ($25 one-time, identity verification takes days).
- [ ] Expo account (free) for EAS builds: `npm i -g eas-cli`, `eas login`.

## Build and submit
1. `cd mobile && eas build -p android --profile preview` -> APK to test on a real phone.
2. `eas build -p android --profile production` -> AAB for the store.
3. Create the app in Play Console (package `com.nipuna05.integrationreliability`; change it first if you want another company name, it cannot change later).
4. Upload the AAB to **Internal testing**, test, then promote to Production.

## Store listing needs
- Short description (80 chars) and full description.
- Screenshots (min 2 phone), 512x512 icon, 1024x500 feature graphic.
- Privacy policy URL (required), data safety form, content rating questionnaire.
- Note: new personal developer accounts must run a closed test (12+ testers, 14 days) before production access. Check the current Play rules when you register.

## Support web and mobile
Both clients use the same API (`/api/checks`, `/api/history`, `/api/run`). Add features to the API first, then to each client.
