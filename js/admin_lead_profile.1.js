
// Auth comes from the httpOnly cookie session set by /api/admin/login.
// Verify on load and redirect if no valid session.
(async function gate() {
  const r = await fetch('/api/admin/me', { credentials: 'include' });
  if (!r.ok) location.replace('/admin');
})();

function qs(k){ return new URLSearchParams(location.search).get(k); }
const LEAD_ID = qs('id');

function esc(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); return d.toLocaleString(); }
function toast(msg, kind){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.background = kind==='err'? '#DC2626' : '#16A34A';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2400);
}

async function load(){
  if (!LEAD_ID){
    document.getElementById('root').innerHTML = '<div class="card"><div class="empty">No lead ID in URL. Open this page via <code>?id=LEAD_UUID</code>.</div></div>';
    return;
  }

  const r = await fetch('/api/admin/lead?id=' + encodeURIComponent(LEAD_ID), { credentials: 'include' });
  if (r.status === 401) { location.replace('/admin'); return; }
  if (!r.ok) {
    document.getElementById('root').innerHTML = '<div class="card"><div class="empty">Lead not found.</div></div>';
    return;
  }
  const { lead, activity = [] } = await r.json();
  if (!lead) {
    document.getElementById('root').innerHTML = '<div class="card"><div class="empty">Lead not found.</div></div>';
    return;
  }
  render(lead, activity);
}

function render(lead, activity){
  const u = lead.users || {};
  const v = lead.vendors || null;
  const statusClass = `status-${(lead.status||'new').replace('awaiting_vendor','awaiting').replace('assigned','assigned').split('_')[0]}`;

  const html = `
    <div class="card">
      <h2>Lead #${esc(lead.lead_number || '—')} <span class="status-chip ${statusClass}">${esc(lead.status||'new')}</span></h2>
      <div class="grid-3">
        <div class="field"><div class="field-label">Name</div><div class="field-value">${esc(lead.first_name)} ${esc(lead.last_name)}</div></div>
        <div class="field"><div class="field-label">Email</div><div class="field-value">${esc(lead.email)}</div></div>
        <div class="field"><div class="field-label">Phone</div><div class="field-value">${esc(lead.phone)}</div></div>
        <div class="field"><div class="field-label">Home ZIP</div><div class="field-value">${esc(lead.zip_code) || '—'}</div></div>
        <div class="field"><div class="field-label">Service ZIP</div><div class="field-value"><strong>${esc(lead.service_zip) || '—'}</strong></div></div>
        <div class="field"><div class="field-label">City / State</div><div class="field-value">${esc(lead.city)||'—'}, ${esc(lead.state)||'—'}</div></div>
        <div class="field"><div class="field-label">Care for</div><div class="field-value">${esc(lead.care_for)||'—'}</div></div>
        <div class="field"><div class="field-label">Care type</div><div class="field-value">${esc(lead.care_type)||'—'}</div></div>
        <div class="field"><div class="field-label">Received at</div><div class="field-value">${esc(fmt(lead.received_at))}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>Vendor assignment ${lead.auto_assigned? '<span class="badge">Auto-pilot</span>':''}</h2>
      ${v ? `
        <div class="grid-2">
          <div class="field"><div class="field-label">Assigned vendor</div>
            <div class="field-value"><a class="vendor-link" href="/admin_vendor_profile.html?id=${esc(v.id)}">${esc(v.business_name)} &rarr;</a></div>
          </div>
          <div class="field"><div class="field-label">Sent to vendor at</div><div class="field-value">${esc(fmt(lead.sent_to_vendor_at))||'—'}</div></div>
          <div class="field"><div class="field-label">Vendor email</div><div class="field-value">${esc(v.email)||'—'}</div></div>
          <div class="field"><div class="field-label">Vendor phone</div><div class="field-value">${esc(v.phone)||'—'}</div></div>
          <div class="field" style="grid-column:1/-1"><div class="field-label">Assignment reason</div><div class="field-value">${esc(lead.assignment_reason)||'—'}</div></div>
        </div>
      ` : `
        <div class="empty">
          No vendor assigned yet. ${lead.assignment_reason ? 'Reason: ' + esc(lead.assignment_reason) : ''}
        </div>
      `}
    </div>

    <div class="card">
      <h2>Follow-up</h2>
      <div class="follow-row">
        <div class="field">
          <div class="field-label">Follow-up due</div>
          <input type="date" id="fuDate" value="${lead.follow_up_due_at ? lead.follow_up_due_at.slice(0,10) : ''}">
        </div>
        <label>
          <input type="checkbox" id="fuDone" ${lead.follow_up_completed?'checked':''}/> Follow-up completed
        </label>
        <button class="btn" id="saveFollowUp">Save follow-up</button>
        ${lead.follow_up_completed_at? `<span style="font-size:12px;color:var(--gray)">completed ${esc(fmt(lead.follow_up_completed_at))}</span>`:''}
      </div>
    </div>

    <div class="card">
      <h2>Case notes <span class="badge">Admin only</span></h2>
      <textarea id="caseNotes" placeholder="Write any context, conversations, next steps, escalations, etc.">${esc(lead.case_notes||'')}</textarea>
      <div style="margin-top:12px;text-align:right"><button class="btn" id="saveNotes">Save notes</button></div>
    </div>

    <div class="card">
      <h2>Activity timeline <span class="badge">${activity.length} event${activity.length===1?'':'s'}</span></h2>
      ${activity.length===0 ? '<div class="empty">No activity yet.</div>' : `
        <div class="timeline">
          ${activity.map(a=>`
            <div class="timeline-item">
              <div class="timeline-action">${esc((a.action||'').replace(/_/g,' '))}</div>
              <div class="timeline-desc">${esc(a.description||'')}</div>
              <div class="timeline-meta">${esc(fmt(a.created_at))} &middot; by ${esc(a.performed_by||'system')}</div>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <div class="card">
      <h2>User profile</h2>
      ${u && u.id ? `
        <div class="grid-3">
          <div class="field"><div class="field-label">User ID</div><div class="field-value" style="font-family:monospace;font-size:12px">${esc(u.id)}</div></div>
          <div class="field"><div class="field-label">Email</div><div class="field-value">${esc(u.email)}</div></div>
          <div class="field"><div class="field-label">Phone</div><div class="field-value">${esc(u.phone)||'—'}</div></div>
          <div class="field"><div class="field-label">Signed up</div><div class="field-value">${esc(fmt(u.created_at))}</div></div>
          <div class="field"><div class="field-label">Home address</div><div class="field-value">${esc(u.city)||'—'}, ${esc(u.state)||'—'} ${esc(u.zip_code)||''}</div></div>
          <div class="field"><div class="field-label">Service ZIP</div><div class="field-value"><strong>${esc(u.service_zip)||'—'}</strong></div></div>
          <div class="field"><div class="field-label">Care for</div><div class="field-value">${esc(u.care_for)||'—'}</div></div>
          <div class="field"><div class="field-label">Care types</div><div class="field-value">${(u.care_types||[]).join(', ')||'—'}</div></div>
        </div>
      ` : '<div class="empty">No user profile linked to this lead.</div>'}
    </div>
  `;

  document.getElementById('root').innerHTML = html;

  // Wire save buttons
  document.getElementById('saveNotes').addEventListener('click', async ()=>{
    const notes = document.getElementById('caseNotes').value;
    const r = await fetch('/api/admin/lead?id=' + encodeURIComponent(LEAD_ID), {
      method:'PATCH', credentials:'include',
      headers: { 'Content-Type':'application/json', 'X-Requested-With':'senova' },
      body: JSON.stringify({ case_notes: notes })
    });
    if (r.ok){
      // log activity
      await fetch('/api/admin/lead-activity', {
        method:'POST', credentials:'include',
        headers: { 'Content-Type':'application/json', 'X-Requested-With':'senova' },
        body: JSON.stringify({ lead_id: LEAD_ID, action:'case_note_updated', description:'Case notes updated by admin' })
      });
      toast('Notes saved'); load();
    } else toast('Failed to save notes', 'err');
  });

  document.getElementById('saveFollowUp').addEventListener('click', async ()=>{
    const dueDate = document.getElementById('fuDate').value || null;
    const done = document.getElementById('fuDone').checked;
    const payload = {
      follow_up_due_at: dueDate ? new Date(dueDate).toISOString() : null,
      follow_up_completed: done,
      follow_up_completed_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };
    const r = await fetch('/api/admin/lead?id=' + encodeURIComponent(LEAD_ID), {
      method:'PATCH', credentials:'include',
      headers: { 'Content-Type':'application/json', 'X-Requested-With':'senova' },
      body: JSON.stringify(payload)
    });
    if (r.ok){
      await fetch('/api/admin/lead-activity', {
        method:'POST', credentials:'include',
        headers: { 'Content-Type':'application/json', 'X-Requested-With':'senova' },
        body: JSON.stringify({
          lead_id: LEAD_ID,
          action: done ? 'follow_up_completed' : 'follow_up_scheduled',
          description: done ? 'Admin marked follow-up as completed' : (dueDate ? 'Follow-up scheduled for ' + dueDate : 'Follow-up cleared')
        })
      });
      toast('Follow-up saved'); load();
    } else toast('Failed to save follow-up', 'err');
  });
}

load();
