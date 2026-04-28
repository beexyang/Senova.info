
// ===== CONFIG =====
const SUPABASE_URL = 'https://nzinorhyoxifmthyvsbb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aW5vcmh5b3hpZm10aHl2c2JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTI2MjMsImV4cCI6MjA5MDkyODYyM30._7RjAOyhOISw6Nh3qjt8cwJspQrGe2Zw2aBgWu8u4ro';

// State
let currentVendor = null;
let currentUser = null;
let allLeads = [];
let hasMembership = false;

// ===== AUTH =====
// Self-service password reset for vendors.
// Uses our /api/forgot-password route which mints a Supabase recovery OTP
// server-side and emails it via Resend with a senova.info URL — bypassing
// Supabase's built-in mailer (whose link points at the project's Site URL).
async function forgotPassword(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const prefilled = (document.getElementById('loginEmail') || {}).value || '';
  const email = (window.prompt('Enter the email on your vendor account and we\'ll send you a reset link:', prefilled) || '').trim();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('That doesn\'t look like a valid email address.');
    return;
  }
  try {
    await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' },
      body: JSON.stringify({ email: email })
    });
  } catch (_) { /* swallowed; we always show the same generic message */ }
  alert('If that email is registered, a password-reset link has been sent. Check your inbox (and spam folder).');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');

  btn.textContent = 'Signing in...';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    // Sign in with Supabase Auth
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });

    if (!authRes.ok) {
      throw new Error('Invalid email or password');
    }

    const authData = await authRes.json();
    currentUser = authData;
    localStorage.setItem('vendor_token', authData.access_token);
    localStorage.setItem('vendor_refresh', authData.refresh_token);

    // Get vendor record linked to this auth user
    await loadVendorData(authData.access_token, authData.user.id);
    showDashboard();
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed. Please try again.';
    errorEl.style.display = 'block';
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

async function loadVendorData(token, authUserId) {
  // Get vendor_auth record
  const authRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vendor_auth?auth_user_id=eq.${authUserId}&select=*,vendors(*)`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }
  );
  const authData = await authRes.json();

  if (!authData || authData.length === 0) {
    throw new Error('No vendor profile found. Contact support@senova.info');
  }

  currentVendor = authData[0].vendors;
  localStorage.setItem('vendor_id', currentVendor.id);

  // Get membership
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${currentVendor.id}&plan_status=eq.active&select=*`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }
  );
  const memData = await memRes.json();
  hasMembership = memData && memData.length > 0;

  // Get leads
  const leadsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?vendor_id=eq.${currentVendor.id}&select=*&order=received_at.desc`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }
  );
  allLeads = await leadsRes.json() || [];
}

function showDashboard() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashboardView').style.display = 'block';

  if (currentVendor) {
    const initials = (currentVendor.business_name || 'V').substring(0, 2).toUpperCase();
    document.getElementById('companyLogo').textContent = initials;
    document.getElementById('companyName').textContent = currentVendor.business_name;
    document.getElementById('companyMeta').textContent =
      `${currentVendor.city || ''}, ${currentVendor.state || ''} | ${(currentVendor.care_types || []).join(', ')}`;
    document.getElementById('userAvatar').textContent = initials.charAt(0);
    document.getElementById('userName').textContent = currentVendor.contact_name || currentVendor.business_name;

    if (hasMembership) {
      document.getElementById('membershipBadge').innerHTML =
        '<span class="membership-badge badge-active">Active Lead Plan</span>';
      document.getElementById('noMembershipCTA').style.display = 'none';
    } else {
      document.getElementById('membershipBadge').innerHTML =
        '<span class="membership-badge badge-inactive">No Active Plan</span>';
      document.getElementById('noMembershipCTA').style.display = 'block';
    }
  }

  renderStats();
  renderLeads(allLeads);
  loadPhotos();
}

// ===== STATS =====
function renderStats() {
  const total = allLeads.length;
  const newLeads = allLeads.filter(l => l.status === 'new' && !l.vendor_contacted && !l.vendor_closed).length;
  const contacted = allLeads.filter(l => l.vendor_contacted && !l.vendor_closed).length;
  const closed = allLeads.filter(l => l.vendor_closed).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statNew').textContent = newLeads;
  document.getElementById('statContacted').textContent = contacted;
  document.getElementById('statClosed').textContent = closed;
}

// ===== LEADS TABLE =====
function renderLeads(leads) {
  const tbody = document.getElementById('leadsBody');
  const empty = document.getElementById('emptyLeads');
  const table = document.getElementById('leadsTableContainer');

  if (leads.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = 'block';
  empty.style.display = 'none';

  tbody.innerHTML = leads.map(lead => {
    const date = new Date(lead.received_at || lead.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const sentVia = lead.sent_via || 'email';
    const sentClass = sentVia === 'both' ? 'sent-both' : sentVia === 'phone' ? 'sent-phone' : 'sent-email';
    const sentLabel = sentVia.charAt(0).toUpperCase() + sentVia.slice(1);

    let statusClass = 'status-new';
    let statusLabel = 'New';
    if (lead.vendor_closed) { statusClass = 'status-closed'; statusLabel = 'Closed'; }
    else if (lead.vendor_contacted) { statusClass = 'status-contacted'; statusLabel = 'Contacted'; }

    const contactedDone = lead.vendor_contacted ? ' done' : '';
    const closedDone = lead.vendor_closed ? ' done' : '';

    return `<tr>
      <td><div class="lead-date">${dateStr}</div><div class="lead-time">${timeStr}</div></td>
      <td class="lead-name">${lead.first_name} ${lead.last_name}</td>
      <td class="lead-email">${lead.email}</td>
      <td>${lead.phone || '—'}</td>
      <td><span class="sent-badge ${sentClass}">${sentLabel}</span></td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-action btn-contacted${contactedDone}" onclick="markContacted('${lead.id}',this)" ${lead.vendor_contacted ? 'disabled' : ''}>
            ${lead.vendor_contacted ? 'Contacted' : 'Contacted'}
          </button>
          <button class="btn-action btn-closed${closedDone}" onclick="markClosed('${lead.id}',this)" ${lead.vendor_closed ? 'disabled' : ''}>
            ${lead.vendor_closed ? 'Closed' : 'Closed'}
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterLeads() {
  const statusFilter = document.getElementById('filterStatus').value;
  const sentFilter = document.getElementById('filterSentVia').value;

  let filtered = [...allLeads];
  if (statusFilter !== 'all') {
    if (statusFilter === 'new') filtered = filtered.filter(l => !l.vendor_contacted && !l.vendor_closed);
    else if (statusFilter === 'contacted') filtered = filtered.filter(l => l.vendor_contacted && !l.vendor_closed);
    else if (statusFilter === 'closed') filtered = filtered.filter(l => l.vendor_closed);
  }
  if (sentFilter !== 'all') {
    filtered = filtered.filter(l => (l.sent_via || 'email') === sentFilter);
  }
  renderLeads(filtered);
}

async function markContacted(leadId, btn) {
  const token = localStorage.getItem('vendor_token');
  btn.textContent = '...';

  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      vendor_contacted: true,
      vendor_contacted_at: new Date().toISOString(),
      status: 'contacted'
    })
  });

  // Update local state
  const lead = allLeads.find(l => l.id === leadId);
  if (lead) {
    lead.vendor_contacted = true;
    lead.vendor_contacted_at = new Date().toISOString();
    lead.status = 'contacted';
  }

  renderStats();
  filterLeads();
}

async function markClosed(leadId, btn) {
  const token = localStorage.getItem('vendor_token');
  btn.textContent = '...';

  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      vendor_closed: true,
      vendor_closed_at: new Date().toISOString(),
      vendor_contacted: true,
      status: 'closed',
      close_outcome: 'won'
    })
  });

  const lead = allLeads.find(l => l.id === leadId);
  if (lead) {
    lead.vendor_closed = true;
    lead.vendor_closed_at = new Date().toISOString();
    lead.vendor_contacted = true;
    lead.status = 'closed';
  }

  renderStats();
  filterLeads();
}

// ===== TABS =====
function switchTab(tab, el) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  if (tab === 'leads') {
    document.getElementById('leadsSection').style.display = 'block';
    document.getElementById('photosSection').style.display = 'none';
  } else {
    document.getElementById('leadsSection').style.display = 'none';
    document.getElementById('photosSection').style.display = 'block';
  }
}

// ===== PHOTOS =====
async function loadPhotos() {
  if (!currentVendor) return;
  const token = localStorage.getItem('vendor_token');

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vendor_images?vendor_id=eq.${currentVendor.id}&select=*&order=uploaded_at.desc`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }
  );
  const photos = await res.json() || [];
  renderPhotos(photos);
}

function renderPhotos(photos) {
  const grid = document.getElementById('photosGrid');
  if (photos.length === 0) {
    grid.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray);grid-column:1/-1">No photos uploaded yet. Upload photos of your facility above.</div>';
    return;
  }

  grid.innerHTML = photos.map(p => {
    const statusColor = p.status === 'approved' ? 'var(--green)' : p.status === 'denied' ? 'var(--red)' : 'var(--orange)';
    const statusText = p.status.charAt(0).toUpperCase() + p.status.slice(1);
    return `<div class="photo-card">
      <img src="${p.image_url}" alt="${p.caption || 'Facility photo'}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22160%22><rect fill=%22%23E5E7EB%22 width=%22200%22 height=%22160%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%239AA0A6%22 font-size=%2214%22>No Preview</text></svg>'"/>
      <div class="photo-info">
        <div style="font-size:13px">${p.caption || p.image_type || 'Photo'}</div>
        <div class="photo-status" style="color:${statusColor}">${statusText}</div>
      </div>
    </div>`;
  }).join('');
}

async function handlePhotoUpload(e) {
  const files = e.target.files;
  if (!files.length || !currentVendor) return;

  const token = localStorage.getItem('vendor_token');

  const ALLOWED_MIME = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };
  for (const file of files) {
    if (!ALLOWED_MIME[file.type]) {
      alert(`${file.name}: only JPEG, PNG, or WebP images are allowed.`);
      continue;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(`${file.name} is too large. Max 5MB.`);
      continue;
    }

    // Sanitize filename — never trust user-supplied file names. Use a
    // UUID + the allowlisted extension so a malicious name can't smuggle
    // path traversal or active content into Supabase Storage.
    const ext = ALLOWED_MIME[file.type];
    const uuid = (crypto.randomUUID && crypto.randomUUID()) ||
                 (Date.now() + '-' + Math.random().toString(36).slice(2,10));
    const fileName = `${currentVendor.id}/${uuid}.${ext}`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/vendor-photos/${fileName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': file.type
        },
        body: file
      }
    );

    if (uploadRes.ok) {
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/vendor-photos/${fileName}`;

      // Create vendor_images record
      await fetch(`${SUPABASE_URL}/rest/v1/vendor_images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          vendor_id: currentVendor.id,
          image_url: imageUrl,
          image_type: 'facility',
          status: 'pending'
        })
      });

      // Notify admin (via API endpoint)
      try {
        const vt = localStorage.getItem('vendor_token') || '';
        await fetch('/api/notify-admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          'X-Requested-With': 'senova',
            'Authorization': vt ? ('Bearer ' + vt) : ''
          },
          body: JSON.stringify({
            type: 'image_upload',
            vendor_id: currentVendor.id,
            image_url: imageUrl
          })
        });
      } catch (err) { /* notification is best-effort */ }
    }
  }

  alert('Photos uploaded! They will be reviewed before being published to your profile.');
  loadPhotos();
  e.target.value = '';
}

// ===== LOGOUT =====
function handleLogout() {
  localStorage.removeItem('vendor_token');
  localStorage.removeItem('vendor_refresh');
  currentVendor = null;
  currentUser = null;
  allLeads = [];
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('dashboardView').style.display = 'none';
}

// ===== AUTO-LOGIN CHECK =====
async function checkSession() {
  const token = localStorage.getItem('vendor_token');
  if (!token) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.ok) {
      const user = await res.json();
      currentUser = { user, access_token: token };
      await loadVendorData(token, user.id);
      showDashboard();
    } else {
      localStorage.removeItem('vendor_token');
    }
  } catch (err) {
    localStorage.removeItem('vendor_token');
  }
}

// Init
checkSession();

document.addEventListener('click', function(ev){
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'forgotPassword')      return forgotPassword(ev);
  if (a === 'handleLogout')        return handleLogout();
  if (a === 'goto-lead-plans')     { window.location = '/lead_plans.html'; return; }
  if (a === 'switchTab')           return switchTab(t.dataset.tab, t);
  if (a === 'trigger-photo-input') { document.getElementById('photoInput').click(); return; }
});

document.addEventListener('submit', function(ev){
  const f = ev.target.closest('[data-action="vendor-login"]');
  if (!f) return;
  ev.preventDefault();
  handleLogin(ev);
});
document.addEventListener('change', function(ev){
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'filterLeads')  return filterLeads();
  if (a === 'photoUpload')  return handlePhotoUpload(ev);
});
