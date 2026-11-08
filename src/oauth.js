// Sign-in apps for Nodes. The real values live in src/oauth.local.json, which is
// gitignored. Release builds write that file from the repo's Actions secrets.
// Anything left empty shows as "Coming soon" in the app.
let local = {};
try {
  local = require('./oauth.local.json');
} catch {}
module.exports = {
  google: { clientId: local.googleClientId || '', clientSecret: local.googleClientSecret || '' },
  github: { clientId: local.githubClientId || '' },
};
