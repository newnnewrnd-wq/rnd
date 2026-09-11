import { request } from '/auth/client.js';
// Revalidate the session on navigation back to this tab. Formula edits stay device-local.
async function check() {
  try { const session = await request('/api/auth/session');if (session.user.mustChangePassword) location.assign('/account'); }
  catch { /* request redirects expired sessions. Transient network errors retain the current formula. */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
window.addEventListener('pageshow', event => { if (event.persisted) void check(); });
void check();
