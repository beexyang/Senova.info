
        // Auth via httpOnly cookie session — see gate() below.
        (async function gate() {
          const r = await fetch('/api/admin/me', { credentials: 'include' });
          if (!r.ok) location.replace('/admin');
        })();
        let leads = [];

        async function fetchLeads() {
            try {
                const r = await fetch('/api/admin/leads', { credentials: 'include' });
                const data = r.ok ? await r.json() : [];
                leads = data.map(l => ({
                    leadId: l.id, // real UUID (used for profile link)
                    displayId: l.lead_number ? ('L-' + String(l.lead_number).padStart(3,'0')) : '—',
                    dateReceived: l.received_at ? new Date(l.received_at).toLocaleString('en-US', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '',
                    firstName: l.first_name || '',
                    lastName: l.last_name || '',
                    phone: l.phone || '',
                    email: l.email || '',
                    address: [l.city, l.state, l.service_zip || l.zip_code].filter(Boolean).join(', '),
                    careFor: l.care_for || '',
                    careType: l.care_type || '',
                    status: l.status || 'new',
                    vendor: l.vendors ? l.vendors.business_name : null,
                    dateSent: l.sent_to_vendor_at ? new Date(l.sent_to_vendor_at).toLocaleString('en-US', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : null,
                    autoAssigned: !!l.auto_assigned
                }));
                filteredLeads = [...leads];
                if (typeof renderLeadsTable === 'function') renderLeadsTable();
                if (typeof updateStats === 'function') updateStats();
            } catch(e) { console.error('fetchLeads error:', e); }
        }

        // Kept for backward compatibility (unused now that manual assign is removed)
        const _mockLeads_DEPRECATED = [
            { leadId: 'L-001', dateReceived: '2026-04-07 14:32', firstName: 'James', lastName: 'Martinez', phone: '(713) 555-0142', email: 'james.martinez@email.com', address: 'Houston, TX 77002', careFor: 'Myself', careType: 'Home Health', status: 'new', vendor: null, dateSent: null },
            { leadId: 'L-002', dateReceived: '2026-04-07 13:15', firstName: 'Maria', lastName: 'Garcia', phone: '(713) 555-0189', email: 'maria.g@email.com', address: 'Houston, TX 77003', careFor: 'Mother', careType: 'Hospice', status: 'sent', vendor: 'Gulf Coast Hospice', dateSent: '2026-04-06 09:45' },
            { leadId: 'L-003', dateReceived: '2026-04-07 12:00', firstName: 'Robert', lastName: 'Johnson', phone: '(281) 555-0234', email: 'r.johnson@email.com', address: 'Spring, TX 77380', careFor: 'Spouse', careType: 'Assisted Living', status: 'contacted', vendor: 'Premier Living Communities', dateSent: '2026-04-05 11:30' },
            { leadId: 'L-004', dateReceived: '2026-04-07 11:45', firstName: 'Sarah', lastName: 'Chen', phone: '(713) 555-0456', email: 'sarah.chen@email.com', address: 'The Woodlands, TX 77380', careFor: 'Myself', careType: 'Adult Day', status: 'assigned', vendor: 'Metro Adult Day Center', dateSent: null },
            { leadId: 'L-005', dateReceived: '2026-04-07 10:20', firstName: 'Michael', lastName: 'Davis', phone: '(713) 555-0567', email: 'mdavis@email.com', address: 'Pearland, TX 77581', careFor: 'Father', careType: 'Rehab', status: 'sent', vendor: 'Texas Recovery Center', dateSent: '2026-04-06 14:00' },
            { leadId: 'L-006', dateReceived: '2026-04-07 09:30', firstName: 'Jennifer', lastName: 'Thompson', phone: '(281) 555-0678', email: 'jen.thompson@email.com', address: 'Sugar Land, TX 77479', careFor: 'Myself', careType: 'Home Health', status: 'new', vendor: null, dateSent: null },
            { leadId: 'L-007', dateReceived: '2026-04-06 16:45', firstName: 'David', lastName: 'Rodriguez', phone: '(713) 555-0789', email: 'david.r@email.com', address: 'Bellaire, TX 77401', careFor: 'Child', careType: 'Home Health', status: 'closed', vendor: 'Sunshine Home Health', dateSent: '2026-04-03 10:15' },
            { leadId: 'L-008', dateReceived: '2026-04-06 15:30', firstName: 'Patricia', lastName: 'Wilson', phone: '(713) 555-0890', email: 'p.wilson@email.com', address: 'Katy, TX 77450', careFor: 'Spouse', careType: 'Hospice', status: 'sent', vendor: 'Gulf Coast Hospice', dateSent: '2026-04-05 08:20' },
            { leadId: 'L-009', dateReceived: '2026-04-06 14:15', firstName: 'Christopher', lastName: 'Anderson', phone: '(281) 555-0901', email: 'c.anderson@email.com', address: 'Tomball, TX 77375', careFor: 'Mother', careType: 'Assisted Living', status: 'new', vendor: null, dateSent: null },
            { leadId: 'L-010', dateReceived: '2026-04-06 13:00', firstName: 'Linda', lastName: 'Taylor', phone: '(713) 555-1012', email: 'linda.taylor@email.com', address: 'Missouri City, TX 77459', careFor: 'Myself', careType: 'Adult Day', status: 'assigned', vendor: 'Metro Adult Day Center', dateSent: null },
            { leadId: 'L-011', dateReceived: '2026-04-06 11:45', firstName: 'William', lastName: 'Brown', phone: '(713) 555-1123', email: 'w.brown@email.com', address: 'Houston, TX 77004', careFor: 'Father', careType: 'Rehab', status: 'contacted', vendor: 'Texas Recovery Center', dateSent: '2026-04-04 12:00' },
            { leadId: 'L-012', dateReceived: '2026-04-06 10:30', firstName: 'Elizabeth', lastName: 'Moore', phone: '(713) 555-1234', email: 'e.moore@email.com', address: 'Houston, TX 77005', careFor: 'Myself', careType: 'Home Health', status: 'sent', vendor: 'Sunshine Home Health', dateSent: '2026-04-04 09:00' },
            { leadId: 'L-013', dateReceived: '2026-04-06 09:15', firstName: 'Joseph', lastName: 'Jackson', phone: '(281) 555-1345', email: 'j.jackson@email.com', address: 'League City, TX 77573', careFor: 'Spouse', careType: 'Hospice', status: 'new', vendor: null, dateSent: null },
            { leadId: 'L-014', dateReceived: '2026-04-05 16:00', firstName: 'Barbara', lastName: 'White', phone: '(713) 555-1456', email: 'b.white@email.com', address: 'Houston, TX 77006', careFor: 'Myself', careType: 'Assisted Living', status: 'assigned', vendor: 'Premier Living Communities', dateSent: null },
            { leadId: 'L-015', dateReceived: '2026-04-05 14:30', firstName: 'Richard', lastName: 'Harris', phone: '(713) 555-1567', email: 'r.harris@email.com', address: 'Pasadena, TX 77505', careFor: 'Child', careType: 'Adult Day', status: 'sent', vendor: 'Metro Adult Day Center', dateSent: '2026-04-03 15:30' }
        ];

        const vendors = [
            { id: 1, name: 'Sunshine Home Health', phone: '(713) 555-2000', email: 'info@sunshinehh.com', address: 'Houston, TX', leadsAssigned: 28 },
            { id: 2, name: 'Gulf Coast Hospice', phone: '(713) 555-2100', email: 'admissions@gulfcoasthospice.com', address: 'Houston, TX', leadsAssigned: 34 },
            { id: 3, name: 'Premier Living Communities', phone: '(713) 555-2200', email: 'info@premierliving.com', address: 'Houston, TX', leadsAssigned: 22 },
            { id: 4, name: 'Metro Adult Day Center', phone: '(713) 555-2300', email: 'admin@metroadultday.com', address: 'Houston, TX', leadsAssigned: 18 },
            { id: 5, name: 'Texas Recovery Center', phone: '(713) 555-2400', email: 'admissions@texasrecovery.com', address: 'Houston, TX', leadsAssigned: 15 }
        ];

        let currentPage = 1;
        const leadsPerPage = 10;
        let filteredLeads = [...leads];
        let selectedLeads = new Set();
        let sortColumn = null;
        let sortDirection = 'asc';

        // INITIALIZATION
        document.addEventListener('DOMContentLoaded', function() {
            initializeApp();
        });

        function initializeApp() {
            populateVendorDropdown();
            renderLeadsTable();
            renderVendors();
            setupEventListeners();
            // Load real leads from Supabase (replaces the mock data above)
            fetchLeads();
            // Refresh every 30 seconds so new leads appear without manual reload
            setInterval(fetchLeads, 30000);
        }

        // EVENT LISTENERS
        function setupEventListeners() {
            // Tab switching
            document.querySelectorAll('.nav-item').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchTab(this.dataset.tab);
                });
            });

            // Search
            document.getElementById('searchInput').addEventListener('input', handleSearch);

            // Checkboxes
            document.getElementById('selectAllCheckbox').addEventListener('change', toggleSelectAll);
            document.addEventListener('change', function(e) {
                if (e.target.classList.contains('lead-checkbox')) {
                    updateBulkActionsBar();
                }
            });

            // Table sorting
            document.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', function() {
                    handleSort(this.dataset.sort);
                });
            });

            // Modal actions
            const sendLeadBtnEl = document.getElementById('sendLeadBtn');
            if (sendLeadBtnEl) sendLeadBtnEl.addEventListener('click', handleSendLead);
            document.getElementById('exportBtn').addEventListener('click', handleExportCSV);
            document.getElementById('exportSelectedBtn').addEventListener('click', handleExportSelected);
            const assignBtnEl = document.getElementById('assignBtn');
            if (assignBtnEl) assignBtnEl.addEventListener('click', handleBulkAssign);
            document.getElementById('markContactedBtn').addEventListener('click', handleMarkContacted);

            // Add vendor
            document.getElementById('addVendorBtn').addEventListener('click', function() {
                showAddVendorModal();
            });
        }

        function switchTab(tabName) {
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            event.target.closest('.nav-item').classList.add('active');

            // Update active section
            document.querySelectorAll('.section-content').forEach(section => {
                section.classList.remove('active');
            });
            document.getElementById(tabName).classList.add('active');

            // Reset pagination for non-dashboard tabs
            if (tabName === 'sent') {
                renderSentTable();
            }
        }

        // TABLE RENDERING
        function renderLeadsTable() {
            const tbody = document.getElementById('leadsTableBody');
            tbody.innerHTML = '';

            const start = (currentPage - 1) * leadsPerPage;
            const end = start + leadsPerPage;
            const pageLeads = filteredLeads.slice(start, end);

            pageLeads.forEach(lead => {
                const row = document.createElement('tr');
                if (selectedLeads.has(lead.leadId)) row.classList.add('selected');

                const statusClass = `status-${lead.status}`;
                const statusText = lead.status.charAt(0).toUpperCase() + lead.status.slice(1);

                row.innerHTML = `
                    <td><input type="checkbox" class="checkbox lead-checkbox" value="${lead.leadId}" ${selectedLeads.has(lead.leadId) ? 'checked' : ''}></td>
                    <td><span class="lead-id">${lead.displayId || lead.leadId}</span></td>
                    <td><span class="timestamp">${lead.dateReceived}</span></td>
                    <td>${lead.firstName}</td>
                    <td>${lead.lastName}</td>
                    <td>${lead.phone}</td>
                    <td>${lead.email}</td>
                    <td>${lead.address}</td>
                    <td>${lead.careFor}</td>
                    <td>${lead.careType}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${lead.vendor || '—'}</td>
                    <td>${lead.dateSent ? `<span class="timestamp">${lead.dateSent}</span>` : '—'}</td>
                    <td>
                        <div class="action-buttons">
                            <a class="btn-action" href="/admin_lead_profile.html?id=${lead.leadId}" title="Open full profile" style="text-decoration:none">Open</a>
                        </div>
                    </td>
                `;

                tbody.appendChild(row);

                row.querySelector('.lead-checkbox').addEventListener('change', (e) => {
                    if (e.target.checked) {
                        selectedLeads.add(lead.leadId);
                    } else {
                        selectedLeads.delete(lead.leadId);
                    }
                    updateBulkActionsBar();
                });
            });

            renderPagination();
        }

        function renderSentTable() {
            const tbody = document.getElementById('sentTableBody');
            tbody.innerHTML = '';

            const sentLeads = leads.filter(l => l.status === 'sent' || l.status === 'contacted' || l.status === 'closed');

            sentLeads.forEach(lead => {
                const row = document.createElement('tr');
                const statusClass = `status-${lead.status}`;
                const statusText = lead.status.charAt(0).toUpperCase() + lead.status.slice(1);

                row.innerHTML = `
                    <td><span class="lead-id">${lead.leadId}</span></td>
                    <td>${lead.firstName}</td>
                    <td>${lead.lastName}</td>
                    <td>${lead.phone}</td>
                    <td>${lead.email}</td>
                    <td>${lead.careType}</td>
                    <td>${lead.vendor || '—'}</td>
                    <td>${lead.dateSent ? `<span class="timestamp">${lead.dateSent}</span>` : '—'}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                `;

                tbody.appendChild(row);
            });
        }

        function renderPagination() {
            const paginationDiv = document.getElementById('pagination');
            paginationDiv.innerHTML = '';

            const totalPages = Math.ceil(filteredLeads.length / leadsPerPage);

            if (totalPages <= 1) return;

            // Previous button
            const prevBtn = document.createElement('button');
            prevBtn.textContent = '← Previous';
            prevBtn.disabled = currentPage === 1;
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderLeadsTable();
                    window.scrollTo(0, 0);
                }
            });
            paginationDiv.appendChild(prevBtn);

            // Page numbers
            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                    const pageBtn = document.createElement('button');
                    pageBtn.textContent = i;
                    if (i === currentPage) pageBtn.classList.add('active');
                    pageBtn.addEventListener('click', () => {
                        currentPage = i;
                        renderLeadsTable();
                        window.scrollTo(0, 0);
                    });
                    paginationDiv.appendChild(pageBtn);
                } else if (i === 2 || i === totalPages - 1) {
                    const dots = document.createElement('span');
                    dots.textContent = '...';
                    paginationDiv.appendChild(dots);
                }
            }

            // Next button
            const nextBtn = document.createElement('button');
            nextBtn.textContent = 'Next →';
            nextBtn.disabled = currentPage === totalPages;
            nextBtn.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    renderLeadsTable();
                    window.scrollTo(0, 0);
                }
            });
            paginationDiv.appendChild(nextBtn);
        }

        // SEARCH AND FILTER
        function handleSearch(e) {
            const searchTerm = e.target.value.toLowerCase();
            currentPage = 1;

            filteredLeads = leads.filter(lead => {
                return lead.firstName.toLowerCase().includes(searchTerm) ||
                       lead.lastName.toLowerCase().includes(searchTerm) ||
                       lead.email.toLowerCase().includes(searchTerm) ||
                       lead.phone.includes(searchTerm) ||
                       lead.leadId.toLowerCase().includes(searchTerm);
            });

            renderLeadsTable();
        }

        // SORTING
        function handleSort(column) {
            const th = event.target;

            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortDirection = 'asc';
                if (sortColumn) {
                    document.querySelector(`th[data-sort="${sortColumn}"]`).classList.remove('sort-asc', 'sort-desc');
                }
                sortColumn = column;
            }

            filteredLeads.sort((a, b) => {
                let valA = a[column];
                let valB = b[column];

                if (typeof valA === 'string') {
                    valA = valA.toLowerCase();
                    valB = valB.toLowerCase();
                }

                if (sortDirection === 'asc') {
                    return valA > valB ? 1 : -1;
                } else {
                    return valA < valB ? 1 : -1;
                }
            });

            document.querySelectorAll('th.sortable').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');

            currentPage = 1;
            renderLeadsTable();
        }

        // BULK ACTIONS
        function toggleSelectAll(e) {
            if (e.target.checked) {
                const start = (currentPage - 1) * leadsPerPage;
                const end = start + leadsPerPage;
                const pageLeads = filteredLeads.slice(start, end);
                pageLeads.forEach(lead => selectedLeads.add(lead.leadId));
            } else {
                const start = (currentPage - 1) * leadsPerPage;
                const end = start + leadsPerPage;
                const pageLeads = filteredLeads.slice(start, end);
                pageLeads.forEach(lead => selectedLeads.delete(lead.leadId));
            }
            updateBulkActionsBar();
            renderLeadsTable();
        }

        function updateBulkActionsBar() {
            const bar = document.getElementById('bulkActionsBar');
            const count = selectedLeads.size;
            document.getElementById('selectedCount').textContent = `${count} lead${count !== 1 ? 's' : ''} selected`;

            if (count > 0) {
                bar.classList.add('visible');
            } else {
                bar.classList.remove('visible');
            }
        }

        function handleBulkAssign() {
            if (selectedLeads.size === 0) return;
            showToast(`Bulk assignment for ${selectedLeads.size} leads would be processed`);
        }

        function handleExportSelected() {
            if (selectedLeads.size === 0) return;
            showToast(`Exporting ${selectedLeads.size} selected leads...`);
        }

        function handleMarkContacted() {
            if (selectedLeads.size === 0) return;
            const selectedArray = Array.from(selectedLeads);
            selectedArray.forEach(leadId => {
                const lead = leads.find(l => l.leadId === leadId);
                if (lead && lead.status === 'sent') {
                    lead.status = 'contacted';
                }
            });
            selectedLeads.clear();
            updateBulkActionsBar();
            renderLeadsTable();
            showToast(`${selectedArray.length} leads marked as contacted`);
        }

        // VENDOR MODAL
        function openSendVendorModal(leadId) {
            const lead = leads.find(l => l.leadId === leadId);
            if (!lead) return;

            const summary = document.getElementById('leadSummary');
            summary.innerHTML = `
                <div class="detail-section">
                    <div class="detail-field">
                        <span class="detail-label">Lead ID</span>
                        <span class="detail-value">${lead.leadId}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Name</span>
                        <span class="detail-value">${lead.firstName} ${lead.lastName}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Phone</span>
                        <span class="detail-value">${lead.phone}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Care Type</span>
                        <span class="detail-value">${lead.careType}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Location</span>
                        <span class="detail-value">${lead.address}</span>
                    </div>
                </div>
            `;

            document.getElementById('sendVendorModal').classList.add('visible');
            document.getElementById('sendLeadBtn').dataset.leadId = leadId;

            // Focus on vendor select
            document.getElementById('vendorSelect').focus();
        }

        function closeSendVendorModal() {
            document.getElementById('sendVendorModal').classList.remove('visible');
            document.getElementById('vendorSelect').value = '';
            document.getElementById('emailCheckbox').checked = true;
            document.getElementById('noteTextarea').value = '';
        }

        function handleSendLead() {
            const leadId = this.dataset.leadId;
            const vendorId = document.getElementById('vendorSelect').value;
            const note = document.getElementById('noteTextarea').value;
            const sendEmail = document.getElementById('emailCheckbox').checked;

            if (!vendorId) {
                showToast('Please select a vendor', 'error');
                return;
            }

            const vendor = vendors.find(v => v.id == vendorId);
            const lead = leads.find(l => l.leadId === leadId);

            if (lead && vendor) {
                lead.status = 'sent';
                lead.vendor = vendor.name;
                lead.dateSent = new Date().toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }) + ' · ' + new Date().toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                closeSendVendorModal();
                renderLeadsTable();
                showToast(`Lead ${leadId} sent to ${vendor.name}`);
            }
        }

        // DETAIL PANEL
        function openDetailPanel(leadId) {
            const lead = leads.find(l => l.leadId === leadId);
            if (!lead) return;

            const panelContent = document.getElementById('panelContent');
            const statusClass = `status-${lead.status}`;
            const statusText = lead.status.charAt(0).toUpperCase() + lead.status.slice(1);

            let timeline = `
                <div class="timeline-item">
                    <div>Lead received from website</div>
                    <div class="timeline-time">${lead.dateReceived}</div>
                </div>
            `;

            if (lead.vendor) {
                timeline += `
                    <div class="timeline-item">
                        <div>Assigned to ${lead.vendor}</div>
                        <div class="timeline-time">${lead.dateSent}</div>
                    </div>
                `;
            }

            if (lead.status === 'contacted') {
                timeline += `
                    <div class="timeline-item">
                        <div>Vendor contacted lead</div>
                        <div class="timeline-time">${new Date(lead.dateSent).getTime() + 86400000}</div>
                    </div>
                `;
            }

            panelContent.innerHTML = `
                <div class="detail-section">
                    <div class="detail-section-title">Lead Information</div>
                    <div class="detail-field">
                        <span class="detail-label">Lead ID</span>
                        <span class="detail-value">${lead.leadId}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Status</span>
                        <span style="display: inline-block;"><span class="status-badge ${statusClass}">${statusText}</span></span>
                    </div>
                </div>

                <div class="detail-section">
                    <div class="detail-section-title">Personal Details</div>
                    <div class="detail-field">
                        <span class="detail-label">First Name</span>
                        <span class="detail-value">${lead.firstName}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Last Name</span>
                        <span class="detail-value">${lead.lastName}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Phone</span>
                        <span class="detail-value">${lead.phone}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Email</span>
                        <span class="detail-value">${lead.email}</span>
                    </div>
                </div>

                <div class="detail-section">
                    <div class="detail-section-title">Care Information</div>
                    <div class="detail-field">
                        <span class="detail-label">Care For</span>
                        <span class="detail-value">${lead.careFor}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Care Type</span>
                        <span class="detail-value">${lead.careType}</span>
                    </div>
                    <div class="detail-field">
                        <span class="detail-label">Address</span>
                        <span class="detail-value">${lead.address}</span>
                    </div>
                </div>

                ${lead.vendor ? `
                    <div class="detail-section">
                        <div class="detail-section-title">Vendor Assignment</div>
                        <div class="detail-field">
                            <span class="detail-label">Vendor</span>
                            <span class="detail-value">${lead.vendor}</span>
                        </div>
                        <div class="detail-field">
                            <span class="detail-label">Date Sent</span>
                            <span class="detail-value">${lead.dateSent}</span>
                        </div>
                    </div>
                ` : ''}

                <div class="detail-section">
                    <div class="detail-section-title">Activity Timeline</div>
                    <div class="timeline">
                        ${timeline}
                    </div>
                </div>

                <div class="panel-actions">
                    ${lead.status !== 'sent' && lead.status !== 'closed' ? `
                        <div style="padding:12px;background:#F0FDFA;border-radius:8px;font-size:13px;color:#0F766E">
                            Leads are auto-assigned by the system. Manual routing is disabled.
                        </div>
                    ` : ''}
                    ${lead.status !== 'closed' ? `
                        <button class="btn-secondary" onclick="closeLeadFromPanel('${lead.leadId}');">Close Lead</button>
                    ` : ''}
                </div>
            `;

            document.getElementById('leadDetailPanel').classList.add('open');
        }

        function closeDetailPanel() {
            document.getElementById('leadDetailPanel').classList.remove('open');
        }

        function closeLeadFromPanel(leadId) {
            const lead = leads.find(l => l.leadId === leadId);
            if (lead) {
                lead.status = 'closed';
                closeDetailPanel();
                renderLeadsTable();
                showToast(`Lead ${leadId} closed`);
            }
        }

        // VENDORS
        function populateVendorDropdown() {
            const select = document.getElementById('vendorSelect');
            select.innerHTML = '<option value="">Choose a vendor...</option>';
            vendors.forEach(vendor => {
                const option = document.createElement('option');
                option.value = vendor.id;
                option.textContent = vendor.name;
                select.appendChild(option);
            });
        }

        function renderVendors() {
            const grid = document.getElementById('vendorsGrid');
            grid.innerHTML = '';

            vendors.forEach(vendor => {
                const card = document.createElement('div');
                card.className = 'vendor-card';
                card.innerHTML = `
                    <div class="vendor-name">${vendor.name}</div>
                    <div class="vendor-info">
                        <span>📞</span>
                        <span>${vendor.phone}</span>
                    </div>
                    <div class="vendor-info">
                        <span>✉️</span>
                        <span>${vendor.email}</span>
                    </div>
                    <div class="vendor-info">
                        <span>📍</span>
                        <span>${vendor.address}</span>
                    </div>
                    <div class="vendor-leads">${vendor.leadsAssigned} leads assigned</div>
                `;
                grid.appendChild(card);
            });

            const addBtn = document.createElement('div');
            addBtn.className = 'add-vendor-btn';
            addBtn.id = 'addVendorBtn';
            addBtn.innerHTML = '<span>+ Add New Vendor</span>';
            addBtn.addEventListener('click', showAddVendorModal);
            grid.appendChild(addBtn);
        }

        function showAddVendorModal() {
            showToast('Add vendor functionality would open a new form');
        }

        // EXPORT
        function handleExportCSV() {
            const csvContent = [
                ['Lead ID', 'Date Received', 'First Name', 'Last Name', 'Phone', 'Email', 'Address', 'Care For', 'Care Type', 'Status', 'Vendor', 'Date Sent'],
                ...filteredLeads.map(lead => [
                    lead.leadId,
                    lead.dateReceived,
                    lead.firstName,
                    lead.lastName,
                    lead.phone,
                    lead.email,
                    lead.address,
                    lead.careFor,
                    lead.careType,
                    lead.status,
                    lead.vendor || '',
                    lead.dateSent || ''
                ])
            ];

            const csv = csvContent.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `senova_leads_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            showToast('Export complete');
        }

        // TOAST
        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.style.display = 'block';
            toast.style.backgroundColor = type === 'error' ? 'var(--red)' : 'var(--green)';

            setTimeout(() => {
                toast.style.display = 'none';
            }, 3000);
        }

        // Close modal when clicking outside
        document.getElementById('sendVendorModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeSendVendorModal();
            }
        });
    
document.addEventListener('click', function(ev){
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'closeSendVendorModal') return closeSendVendorModal();
  if (a === 'closeDetailPanel')     return closeDetailPanel();
});
