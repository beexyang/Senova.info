
// Auth comes from the httpOnly cookie session set by /api/admin/login.
(async function gate() {
  const r = await fetch('/api/admin/me', { credentials: 'include' });
  if (!r.ok) location.replace('/admin');
})();

function qs(k){ return new URLSearchParams(location.search).get(k); }
const VENDOR_ID = qs('id');

function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function fmt(ts){ if(!ts) return ''; return new Date(ts).toLocaleString(); }

async function load(){
  if (!VENDOR_ID){
    document.getElementById('root').innerHTML = '<div class="card"><div class="empty">No vendor ID in URL. Open via <code>?id=VENDOR_UUID</code>.</div></div>';
    return;
  }

  const [vRes, mRes, lRes, peRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${VENDOR_ID}&select=*`, { headers: H }),
    fetch(`${SUPABASE_URL}/rest/v1/vendor_memberships?vendor_id=eq.${VENDOR_ID}&select=*`, { headers: H }),
    fetch(`${SUPABASE_URL}/rest/v1/leads?vendor_id=eq.${VENDOR_ID}&select=*&order=received_at.desc`, { headers: H }),
    fetch(`${SUPABASE_URL}/rest/v1/vendor_prospect_emails?vendor_id=eq.${VENDOR_ID}&select=*&order=sent_at.desc`, { headers: H })
  ]);
  const vendors = vRes.ok ? await vRes.json() : [];
  const memberships = mRes.ok ? await mRes.json() : [];
  const leads = lRes.ok ? await lRes.json() : [];
  const prospectEmails = peRes.ok ? await peRes.json() : [];

  if (!vendors[0]){
    document.getElementById('root').innerHTML = '<div class="card"><div class="empty">Vendor not found.</div></div>';
    return;
  }
  render(vendors[0], memberships[0]||null, leads, prospectEmails);
}

function monthStartCount(leads){
  const s = new Date(); s.setDate(1); s.setHours(0,0,0,0);
  return leads.filter(l=>new Date(l.received_at) >= s).length;
}

function render(v, m, leads, prospects){
  const thisMonth = monthStartCount(leads);
  const assigned = leads.filter(l=>l.status==='assigned' || l.status==='sent').length;
  const closed = leads.filter(l=>l.status==='closed' || l.vendor_closed).length;

  const html = `
    <div class="card">
      <h2>${esc(v.business_name)}
        ${m && m.plan_status==='active' ? `<span class="badge badge-plan">${esc((m.plan_name||'').toUpperCase())} plan &middot; active</span>` : '<span class="badge">no active plan</span>'}
        ${v.is_verified?'<span class="badge" style="background:#D1FAE5;color:#065F46">Verified</span>':''}
      </h2>
      <div class="grid-3">
        <div><div class="field-label">Contact</div><div class="field-value">${esc(v.contact_name)||'—'}</div></div>
        <div><div class="field-label">Email</div><div class="field-value">${esc(v.email)||'—'}</div></div>
        <div><div class="field-label">Phone</div><div class="field-value">${esc(v.phone)||'—'}</div></div>
        <div><div class="field-label">Address</div><div class="field-value">${esc(v.address)||'—'}</div></div>
        <div><div class="field-label">City / State</div><div class="field-value">${esc(v.city)||'—'}, ${esc(v.state)||'—'}</div></div>
        <div><div class="field-label">Home ZIP</div><div class="field-value">${esc(v.zip_code)||'—'}</div></div>
        <div><div class="field-label">Service radius</div><div class="field-value">${esc(v.service_radius_miles||25)} miles</div></div>
        <div><div class="field-label">Geocoded</div><div class="field-value">${v.latitude && v.longitude ? 'Yes' : 'Pending (will self-heal on next lead)'}</div></div>
        <div><div class="field-label">Rating</div><div class="field-value">${esc(v.rating||0)} / 5  (${esc(v.review_count||0)} reviews)</div></div>
        <div><div class="field-label">Care types</div><div class="field-value">${(v.care_types||[]).join(', ')||'—'}</div></div>
        <div><div class="field-label">Status</div><div class="field-value">${esc(v.status)}</div></div>
        <div><div class="field-label">Created</div><div class="field-value">${esc(fmt(v.created_at))}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Performance</h2>
      <div class="grid-4">
        <div class="stat"><div class="n">${leads.length}</div><div class="l">Total leads received</div></div>
        <div class="stat"><div class="n">${thisMonth}</div><div class="l">Leads this month</div></div>
        <div class="stat"><div class="n">${assigned}</div><div class="l">Currently assigned</div></div>
        <div class="stat"><div class="n">${closed}</div><div class="l">Closed leads</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Leads assigned to this vendor <span class="badge">${leads.length}</span></h2>
      ${leads.length===0 ? '<div class="empty">No leads have been routed to this vendor yet.</div>' : `
        <table>
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Service ZIP</th><th>Care</th><th>Status</th><th>Assigned at</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${leads.map(l=>`
              <tr>
                <td>${esc(l.lead_number||'—')}</td>
                <td>${esc(l.first_name)} ${esc(l.last_name)}</td>
                <td>${esc(l.email)}</td>
                <td>${esc(l.phone)||'—'}</td>
                <td>${esc(l.service_zip)||'—'}</td>
                <td>${esc(l.care_type)||l.care_for||'—'}</td>
                <td><span class="status-chip status-${(l.status||'new').replace('awaiting_vendor','awaiting').split('_')[0]}">${esc(l.status||'new')}</span></td>
                <td>${esc(fmt(l.sent_to_vendor_at||l.received_at))}</td>
                <td><a class="lead-link" href="/admin_lead_profile.html?id=${esc(l.id)}">Open &rarr;</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div class="card">
      <h2>Prospect emails (invitations to sign up) <span class="badge">${prospects.length}</span></h2>
      ${prospects.length===0 ? '<div class="empty">No prospect invitations sent to this vendor.</div>' : `
        <table>
          <thead><tr><th>Sent at</th><th>Service ZIP</th><th>Care type</th><th>For lead</th></tr></thead>
          <tbody>
            ${prospects.map(p=>`
              <tr>
                <td>${esc(fmt(p.sent_at))}</td>
                <td>${esc(p.service_zip)||'—'}</td>
                <td>${esc(p.care_type)||'—'}</td>
                <td>${p.lead_id? `<a class="lead-link" href="/admin_lead_profile.html?id=${esc(p.lead_id)}">View lead &rarr;</a>` : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
  document.getElementById('root').innerHTML = html;
}

load();
