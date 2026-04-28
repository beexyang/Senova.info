// reset_password page — completes the OTP-based recovery flow.
// Reads { e, otp } from query string (set by /api/auth/forgot-password email).
// Submits { email, otp, password } to /api/auth/reset-password.

(function () {
  const lead = document.getElementById('lead');
  const formBlock = document.getElementById('form-block');
  const msg = document.getElementById('msg');
  const submitBtn = document.getElementById('submit');

  function showError(t) { msg.className = 'msg err'; msg.textContent = t; }
  function showOk(t)    { msg.className = 'msg ok';  msg.textContent = t; }

  const params = new URLSearchParams(window.location.search);
  const email = params.get('e') || '';
  const otp   = params.get('otp') || '';

  if (!email || !otp) {
    formBlock.style.display = 'none';
    lead.textContent = 'This page should be opened from the link in your password-reset email. ' +
      'If you got here by mistake, request a new reset from the sign-in page.';
    return;
  }

  // Clean the URL bar so the OTP isn't visible/bookmarkable after first use.
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
      showOk('Password updated. Redirecting you to sign in...');
      submitBtn.textContent = 'Updated';
      setTimeout(() => { window.location.href = '/signin'; }, 1800);
    } catch (e) {
      showError('Network error. Please try again in a moment.');
      submitBtn.disabled = false; submitBtn.textContent = 'Update password';
    }
  });
})();
