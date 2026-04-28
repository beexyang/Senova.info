
// Auth/state are owned by the server; no Supabase secrets in the browser.
// HTML-escape user-controlled values before placing them inside innerHTML.
// Without this, a vendor or user with `<img src=x onerror=...>` in their
// name/email/business_name could execute JS in the admin's browser and
// steal the admin token from localStorage.
function esc(v){ if(v==null) return ''; return String(v).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

let adminToken = null;

// ===== ADMIN AUTH =====
async function adminLoginHandler(e) {
  e.preventDefault();
  const email = document.getElementById('adminEmail').value;
  const pass = document.getElementById('adminPass').value;
  const err = document.getElementById('adminError');
  const btn = document.getElementById('adminLoginBtn');

  btn.textContent = 'Signing in...'; btn.disabled = true; err.style.display = 'none';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' },
      body: JSON.stringify({ email, password: pass })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Invalid credentials');
    }
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('mainLayout').style.display = 'flex';
    loadAllData();
  } catch (error) {
    err.textContent = error.message; err.style.display = 'block';
  } finally {
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}

async function adminLogout() {
  try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' } }); } catch (_) {}
  sessionStorage.removeItem('admin_token');
  adminToken = null;
  document.getElementById('adminLogin').style.display = 'flex';
  document.getElementById('mainLayout').style.display = 'none';
}

// Delegated click handler for delete buttons — replaces inline onclick=
// (which was a stored-XSS sink because user-supplied names landed in JS context).
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-action="delete-record"]');
  if (!btn) return;
  deleteRecord(btn.dataset.type, btn.dataset.id, btn.dataset.auth, btn.dataset.name);
});

// Auto-login: ask server if our httpOnly cookie session is still valid.
(async function checkAdmin() {
  try {
    const r = await fetch('/api/admin/me', { credentials: 'include' });
    if (r.ok) {
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('mainLayout').style.display = 'flex';
      loadAllData();
    }
  } catch (_) {}
})();

// ===== DATA LOADING =====
async function loadAllData() {
  const r = await fetch('/api/admin/dashboard', { credentials: 'include' });
  if (!r.ok) {
    document.getElementById('mainLayout').style.display = 'none';
    document.getElementById('adminLogin').style.display = 'flex';
    return;
  }
  const { vendors = [], users = [], leads = [], images = [], notifs = [], memberships = [] } = await r.json();

  // Stats
  document.getElementById('totalVendors').textContent = vendors.length || 0;
  document.getElementById('totalUsers').textContent = users.length || 0;
  document.getElementById('totalLeads').textContent = leads.length || 0;
  document.getElementById('pendingImages').textContent = images.length || 0;
  document.getElementById('activePlans').textContent = memberships.length || 0;

  // Badges
  document.getElementById('vendorCountBadge').textContent = vendors.length || 0;
  document.getElementById('userCountBadge').textContent = users.length || 0;
  document.getElementById('imageCountBadge').textContent = images.length || 0;

  const unreadNotifs = (notifs || []).filter(n => !n.is_read).length;
  document.getElementById('notifCount').textContent = `${unreadNotifs} new`;

  renderNotifications(notifs || [], 'notifList', 10);
  renderNotifications(notifs || [], 'allNotifsList', 50);
  renderVendors(vendors || []);
  renderUsers(users || [], leads || []);
  renderLeadsAdmin(leads || []);
  renderImageReview(images || []);
}

// ===== RENDER FUNCTIONS =====
function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

function renderNotifications(notifs, containerId, limit) {
  const el = document.getElementById(containerId);
  if (!notifs.length) { el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray)">No notifications yet</div>'; return; }

  el.innerHTML = notifs.slice(0, limit).map(n => {
    const iconClass = n.type === 'new_vendor' ? 'vendor' : n.type === 'new_user' ? 'user' : n.type === 'image_upload' ? 'image' : 'lead';
    const icon = n.type === 'new_vendor' ? '🏢' : n.type === 'new_user' ? '👤' : n.type === 'image_upload' ? '🖼' : '📋';
    return `<div class="notif-item ${n.is_read ? '' : 'unread'}">
      <div class="notif-icon ${iconClass}">${icon}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-msg">${esc(n.message || '')}</div>
        <div class="notif-time">${esc(timeAgo(n.created_at))}</div>
      </div>
    </div>`;
  }).join('');
}

function renderVendors(vendors) {
  const tbody = document.getElementById('vendorsTableBody');
  if (!vendors.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray)">No vendors yet</td></tr>'; return; }

  tbody.innerHTML = vendors.map(v => {
    const date = new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const types = (v.care_types || []).join(', ') || '—';
    const authId = v.vendor_auth?.[0]?.auth_user_id || '';
    const nameLink = `<a href="/admin_vendor_profile.html?id=${esc(v.id)}" style="color:var(--teal);text-decoration:none;font-weight:600">${esc(v.business_name)}</a>`;
    return `<tr>
      <td>${nameLink}</td>
      <td>${esc(v.contact_name || '—')}<br><span style="font-size:12px;color:var(--gray)">${esc(v.email || '')}</span></td>
      <td>${esc(v.city || '')}, ${esc(v.state || '')}</td>
      <td style="font-size:13px">${esc(types)}</td>
      <td><span class="badge badge-orange">Upsell</span></td>
      <td style="font-size:13px">${esc(date)}</td>
      <td><button class="btn-delete" data-action="delete-record"
                  data-type="vendor"
                  data-id="${esc(v.id)}"
                  data-auth="${esc(authId)}"
                  data-name="${esc(v.business_name || '')}">Delete</button></td>
    </tr>`;
  }).join('');
}

function renderUsers(users, leads) {
  const tbody = document.getElementById('usersTableBody');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray)">No users yet</td></tr>'; return; }

  // Build a user_id -> most recent lead_id map so we can link each user to their lead profile.
  const leadByUser = {};
  for (const l of (leads || [])) {
    if (l.user_id && !leadByUser[l.user_id]) leadByUser[l.user_id] = l.id;
  }

  tbody.innerHTML = users.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const authId = u.user_auth?.[0]?.auth_user_id || '';
    const fullName = `${u.first_name} ${u.last_name}`;
    const leadId = leadByUser[u.id];
    const nameHtml = leadId
      ? `<a href="/admin_lead_profile.html?id=${esc(leadId)}" style="color:var(--teal);text-decoration:none;font-weight:600">${esc(fullName)}</a>`
      : `<span style="font-weight:600">${esc(fullName)}</span>`;
    return `<tr>
      <td>${nameHtml}</td>
      <td>${esc(u.email)}</td>
      <td>${esc(u.phone || '—')}</td>
      <td>${esc(u.city || '')}, ${esc(u.state || '')}</td>
      <td>${esc(u.care_for || '—')}</td>
      <td style="font-size:13px">${esc(date)}</td>
      <td><button class="btn-delete" data-action="delete-record"
                  data-type="user"
                  data-id="${esc(u.id)}"
                  data-auth="${esc(authId)}"
                  data-name="${esc(fullName)}">Delete</button></td>
    </tr>`;
  }).join('');
}

function renderLeadsAdmin(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!leads.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--gray)">No leads yet</td></tr>'; return; }

  tbody.innerHTML = leads.map(l => {
    const date = new Date(l.received_at || l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const vendorName = l.vendors ? l.vendors.business_name : (l.vendor_assigned || '—');
    const sentVia = l.sent_via || 'email';
    const sentClass = sentVia === 'both' ? 'badge-green' : sentVia === 'phone' ? 'badge-orange' : 'badge-blue';
    const statusClass = l.vendor_closed ? 'badge-green' : l.vendor_contacted ? 'badge-blue' : 'badge-teal';
    const statusText = l.vendor_closed ? 'Closed' : l.vendor_contacted ? 'Contacted' : 'New';
    return `<tr>
      <td style="font-size:13px">${esc(date)}</td>
      <td style="font-weight:600">${esc(l.first_name)} ${esc(l.last_name)}</td>
      <td style="font-size:13px">${esc(l.email)}</td>
      <td style="font-size:13px">${esc(vendorName)}</td>
      <td><span class="badge ${sentClass}">${esc(sentVia)}</span></td>
      <td><span class="badge ${statusClass}">${statusText}</span></td>
      <td>${l.vendor_contacted ? 'Yes' : 'No'}</td>
      <td>${l.vendor_closed ? 'Yes' : 'No'}</td>
    </tr>`;
  }).join('');
}

function renderImageReview(images) {
  const grid = document.getElementById('imageReviewGrid');
  if (!images.length) { grid.innerHTML = '<div style="text-align:center;color:var(--gray);grid-column:1/-1;padding:40px">No images pending review</div>'; return; }

  grid.innerHTML = images.map(img => {
    const vendorName = img.vendors ? img.vendors.business_name : 'Unknown Vendor';
    const time = timeAgo(img.uploaded_at);
    // Only render the image URL if it's a Supabase Storage URL on our project,
    // so a malicious vendor can't smuggle a tracking pixel or javascript: URI.
    const safeUrl = (typeof img.image_url === 'string'
      && img.image_url.startsWith('https://nzinorhyoxifmthyvsbb.supabase.co/storage/v1/object/public/')
      && img.image_url.length < 2048)
      ? img.image_url : '';
    return `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff">
      <img src="${esc(safeUrl)}" style="width:100%;height:180px;object-fit:cover" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22280%22 height=%22180%22><rect fill=%22%23E5E7EB%22 width=%22280%22 height=%22180%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%239AA0A6%22>No Preview</text></svg>'"/>
      <div style="padding:16px">
        <div style="font-weight:600;font-size:14px">${esc(vendorName)}</div>
        <div style="font-size:12px;color:var(--gray);margin:4px 0">${esc(img.image_type || 'facility')} - ${esc(time)}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-sm btn-approve" onclick="approveImage('${esc(img.id)}',this)">Approve</button>
          <button class="btn-sm btn-deny" onclick="denyImage('${esc(img.id)}',this)">Deny</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ===== ACTIONS =====
async function deleteRecord(type, id, authUserId, name) {
  const label = type === 'vendor' ? 'vendor' : 'user';
  if (!confirm(`Are you sure you want to permanently delete ${label} "${name}"?\n\nThis will remove their account, all related data, and free up their email for re-registration.\n\nThis cannot be undone.`)) return;

  try {
    // Send the admin's Supabase access token so the server can verify
    // the caller is authorized (the /api/admin-delete endpoint refuses
    // unauthenticated requests after the security hardening pass).
    const res = await fetch('/api/admin-delete', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'senova'
      },
      body: JSON.stringify({ type, id, auth_user_id: authUserId || null })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`${label.charAt(0).toUpperCase() + label.slice(1)} "${name}" has been deleted. Their email is now available for re-registration.`);
      loadAllData();
    } else {
      alert('Delete failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function approveImage(imageId, btn) {
  btn.textContent = '...';
  await fetch('/api/admin/image-action', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' },
    body: JSON.stringify({ image_id: imageId, action: 'approve' })
  });
  loadAllData();
}

async function denyImage(imageId, btn) {
  const reason = prompt('Reason for denial (optional):');
  btn.textContent = '...';
  await fetch('/api/admin/image-action', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' },
    body: JSON.stringify({ image_id: imageId, action: 'deny', reason: reason || null })
  });
  loadAllData();
}

async function markAllRead() {
  await fetch('/api/admin/mark-notifs', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'senova' }
  });
  loadAllData();
}

// ===== NAVIGATION =====
function showSection(section, el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.section-page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + section).classList.add('active');
}

// === Delegated click handler for [data-action] (replaces inline onclick=) ===
document.addEventListener('click', function(ev){
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'showSection')      return showSection(t.dataset.section, t);
  if (a === 'loadAllData')      return loadAllData();
  if (a === 'adminLogout')      return adminLogout();
  if (a === 'markAllRead')      return markAllRead();
});

document.addEventListener('submit', function(ev){
  const f = ev.target.closest('[data-action="admin-login"]');
  if (!f) return;
  ev.preventDefault();
  adminLoginHandler(ev);
});
