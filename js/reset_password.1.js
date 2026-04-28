// reset_password page — supports two URL formats so password reset works no
// matter which mailer ended up sending the email:
//
//   1) Our format (Resend branded path):
//      /reset-password?e=<email>&otp=<otp>
//      -> POST /api/auth/reset-password with { email, otp, password }
//
//   2) Supabase legacy magic-link format:
//      /reset-password#access_token=...&refresh_token=...&type=recovery
//      -> PUT /auth/v1/user with { password } using the access_token

(function () {
  const lead = document.getElementById('lead');
  const formBlock = document.getElementById('form-block');
  const msg = document.getElementById('msg');
  const submitBtn = document.getElementById('submit');

  function showError(t) { msg.className = 'msg err'; msg.textContent = t; }
  function showOk(t)    { msg.className = 'msg ok';  msg.textContent = t; }

  // Parse query string (our flow)
  const qs = new URLSearchParams(window.location.search);
  let email = qs.get('e') || '';
  let otp   = qs.get('otp') || '';

  // Parse hash (Supabase legacy magic-link flow)
  let accessToken = '';
  let recoveryType = '';
  if (window.location.hash && window.location.hash.startsWith('#')) {
    const h = new URLSearchParams(window.location.hash.slice(1));
    accessToken = h.get('access_token') || '';
    recoveryType = h.get('type') || '';
  }

  const useOtpFlow      = !!(email && otp);
  const useLegacyFlow   = !!(accessToken && recoveryType === 'recovery');

  if (!useOtpFlow && !useLegacyFlow) {
    formBlock.style.display = 'none';
    lead.textContent = 'This page should be opened from the link in your password-reset email. ' +
      'If you got here by mistake, request a new reset from the sign-in page.';
    return;
  }

  // Strip credentials from URL bar so they're not bookmarkable.
  history.replaceState(null, '', window.location.pathname);

  submitBtn.addEventListener('click', async () => {
    msg.style.display = 'none';
    msg.className = 'msg';
    const pw  = document.getElementById('pw').value;
    const pw2 = document.getElementById('pw2').value;
    if (!pw || pw.length < 12) return showError('Password must be at least 12 characters.');
    if (pw.length > 200) return showError('Password is too long (max 200 characters).');
    if (pw !== pw2) return showError('Passwords do not match.');

    submitBtn.disabled = true; submitBtn.textContent = 'Updating...';

    try {
      if (useOtpFlow) {
        // OUR flow
        const r = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' },
          body: JSON.stringify({ email: email, otp: otp, password: pw })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          showError(j.error || 'Could not update password.');
          submitBtn.disabled = false; submitBtn.textContent = 'Update password';
          return;
        }
      } else {
        // LEGACY Supabase magic-link flow — call /auth/v1/user PUT directly
        const SUPABASE_URL = 'https://nzinorhyoxifmthyvsbb.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aW5vcmh5b3hpZm10aHl2c2JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTI2MjMsImV4cCI6MjA5MDkyODYyM30._7RjAOyhOISw6Nh3qjt8cwJspQrGe2Zw2aBgWu8u4ro';
        const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + accessToken
          },
          body: JSON.stringify({ password: pw })
        });
        if (!r.ok) {
          let errMsg = 'Could not update password.';
          try { const j = await r.json(); errMsg = j.msg || j.error_description || j.error || errMsg; } catch (_) {}
          showError(errMsg);
          submitBtn.disabled = false; submitBtn.textContent = 'Update password';
          return;
        }
        // log out the recovery session
        try { await fetch(SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + accessToken } }); } catch (_) {}
      }

      showOk('Password updated. Redirecting you to sign in...');
      submitBtn.textContent = 'Updated';
      setTimeout(() => { window.location.href = '/signin'; }, 1800);
    } catch (e) {
      showError('Network error. Please try again in a moment.');
      submitBtn.disabled = false; submitBtn.textContent = 'Update password';
    }
  });
})();
