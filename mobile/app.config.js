// Extends app.json. On EAS Build the Firebase file comes from the secret file variable GOOGLE_SERVICES_JSON
// (created with `eas env:create`), because google-services.json is deliberately not committed to git.
// Locally it falls back to ./google-services.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile ?? './google-services.json',
  },
});
