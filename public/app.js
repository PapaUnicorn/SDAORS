// Frontend App Logic for GMAHK Performance Reporting SPA

const API_URL = ''; // Same origin
let token = localStorage.getItem('token');
let currentUser = null;
let currentTab = 'dashboard';
let activeTerm = '2026-06'; // Default term for current time (June 2026)
let cachedSubordinates = [];

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // Set current term selector value initially
    const now = new Date();
    const currentMonth = now.getMonth(); // 5 = June, 11 = December
    const currentYear = now.getFullYear();
    activeTerm = (currentMonth <= 5) ? `${currentYear}-06` : `${currentYear}-12`;
    
    const termSelect = document.getElementById('term-select');
    termSelect.value = activeTerm;
    
    // Check if user is logged in
    if (token) {
        verifySession();
    } else {
        showLoginView();
    }

    // Bind login form submit
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Bind user creation form submit
    document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);

    // Bind table filters
    document.getElementById('filter-user-name').addEventListener('input', () => applySubordinatesFilter());
    document.getElementById('filter-user-division').addEventListener('change', () => {
        updateUnionDropdown();
        applySubordinatesFilter();
    });
    document.getElementById('filter-user-union').addEventListener('change', () => {
        updateMcDropdown();
        applySubordinatesFilter();
    });
    document.getElementById('filter-user-mc').addEventListener('change', () => {
        applySubordinatesFilter();
    });

    // Initialize UI window lock flags
    checkTimeLockUI();
});

// Check if reports window is open (June or December)
function checkTimeLockUI() {
    const now = new Date();
    const month = now.getMonth(); // 0-indexed: 5 is June, 11 is December
    const isWindowOpen = (month === 5 || month === 11);
    
    const openBanner = document.getElementById('time-open-banner');
    const lockBanner = document.getElementById('time-lock-banner');
    
    if (isWindowOpen) {
        openBanner.style.display = 'flex';
        lockBanner.style.display = 'none';
    } else {
        openBanner.style.display = 'none';
        lockBanner.style.display = 'flex';
    }
    return isWindowOpen;
}

// Check if selected term is locked (archived).
// A term is locked if the current date is past the term's month.
// E.g., if term is 2025-12, it is archived.
function isTermArchived(term) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentActiveTerm = (currentMonth <= 5) ? `${currentYear}-06` : `${currentYear}-12`;
    
    // If selecting a past term, it is archived
    if (term < currentActiveTerm) {
        return true;
    }
    
    // If selecting current term, check if current month is June or December
    if (term === currentActiveTerm) {
        return !(currentMonth === 5 || currentMonth === 11);
    }
    
    return false;
}

// Verify stored JWT session
async function verifySession() {
    try {
        const res = await fetch(`${API_URL}/api/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Session invalid');
        
        currentUser = await res.json();
        showMainAppView();
    } catch (err) {
        console.error("Session verification failed", err);
        handleLogout();
    }
}

// Show Login View
function showLoginView() {
    document.getElementById('login-container').classList.add('active');
    document.getElementById('app-container').classList.remove('active');
    document.getElementById('login-error').style.display = 'none';
    currentUser = null;
    token = null;
}

// Show Main App View
function showMainAppView() {
    document.getElementById('login-container').classList.remove('active');
    document.getElementById('app-container').classList.add('active');
    
    // Update profile UI
    document.getElementById('user-display-name').innerText = currentUser.name;
    
    const rolesMapping = {
        1: 'Master Admin',
        2: 'Division',
        3: 'Union',
        4: 'Mission / Conference',
        5: 'Institution',
        6: 'Teacher'
    };
    let roleLabel = rolesMapping[currentUser.role_id] || 'User';
    if (currentUser.position && currentUser.position !== 'President' && currentUser.position !== 'Teacher') {
        if (currentUser.position === 'Department') {
            roleLabel += ` (${currentUser.department_name})`;
        } else {
            roleLabel += ` (${currentUser.position})`;
        }
    }
    document.getElementById('user-display-role').innerText = roleLabel;
    document.getElementById('header-branch-path').innerText = `Hierarchical Lineage: ${currentUser.branch_code}`;

    // Adjust sidebar menu item visibility by Role RBAC
    setupSidebarMenus();

    // Default tab
    switchTab('dashboard');
}

// Setup sidebar menu navigation visibility
function setupSidebarMenus() {
    const role = currentUser.role_id;
    const position = currentUser.position;
    
    // Dashboard: visible for roles 1-5 (including Secretaries, Treasurers, Departments)
    document.getElementById('menu-dashboard').style.display = (role <= 5) ? 'flex' : 'none';
    
    // Pelaporan Mandiri: visible for any non-President and non-Master (includes Teachers, Secretaries, Treasurers, Departments)
    document.getElementById('menu-report').style.display = (role !== 1 && position !== 'President') ? 'flex' : 'none';
    
    // Monitor & Verifikasi: visible for Master, Presidents, and Departments
    document.getElementById('menu-monitor').style.display = (role === 1 || position === 'President' || position === 'Department') ? 'flex' : 'none';
    
    // Manajemen Pengguna: visible for Master and Presidents only
    document.getElementById('menu-users').style.display = (role === 1 || position === 'President') ? 'flex' : 'none';
    
    // Buat Pengguna Baru: visible for Master and Presidents only
    document.getElementById('menu-create-user').style.display = (role === 1 || position === 'President') ? 'flex' : 'none';
}

// Tab switcher
function switchTab(tabName) {
    currentTab = tabName;
    
    // Toggle active menu class
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Toggle active tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const titles = {
        dashboard: 'Performance Dashboard',
        report: 'Self Reporting',
        monitor: 'Monitor & Verify Reports',
        users: 'User & Structure Management',
        'create-user': 'Create New User'
    };
    
    document.getElementById(`menu-${tabName}`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.getElementById('current-tab-title').innerText = titles[tabName] || 'GMAHK';

    // Show/Hide top bar picker. Teacher doesn't need term picker on dashboard (since they don't see dashboard tab),
    // but they might need it on report tab. Let's keep it visible, but if they are teacher, let's load report data.
    const termPicker = document.querySelector('.term-picker');
    termPicker.style.display = 'flex';

    // Fetch tab specific data
    const selectedTerm = document.getElementById('term-select').value;
    
    // If teacher logging in, default dashboard menu is hidden, so redirect them to report tab
    if (currentUser.role_id === 6 && tabName === 'dashboard') {
        switchTab('report');
        return;
    }

    if (tabName === 'dashboard') {
        loadDashboardData(selectedTerm);
    } else if (tabName === 'report') {
        loadReportData(selectedTerm);
    } else if (tabName === 'monitor') {
        loadMonitorData(selectedTerm);
    } else if (tabName === 'users') {
        loadUsersData();
    } else if (tabName === 'create-user') {
        loadCreateUserData();
    }
}

// Handle login form submission
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorBanner = document.getElementById('login-error');
    const errorText = document.getElementById('login-error-text');

    errorBanner.style.display = 'none';

    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Login error occurred.');
        }

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        showMainAppView();
    } catch (err) {
        errorText.innerText = err.message;
        errorBanner.style.display = 'flex';
    }
}

// Handle Logout
function handleLogout() {
    localStorage.removeItem('token');
    showLoginView();
}

// Fetch and load dashboard stats
async function loadDashboardData() {
    const term = document.getElementById('term-select').value;
    const isArchived = isTermArchived(term);
    
    // Toggle term open/locked status banner on dashboard
    const openBanner = document.getElementById('time-open-banner');
    const lockBanner = document.getElementById('time-lock-banner');
    
    if (isArchived) {
        openBanner.style.display = 'none';
        lockBanner.style.display = 'flex';
    } else {
        checkTimeLockUI();
    }

    try {
        const res = await fetch(`${API_URL}/api/dashboard/stats?term=${term}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to load dashboard statistics');
        
        const data = await res.json();
        
        // Update stats widgets
        document.getElementById('stat-total-target').innerText = data.metrics.totalTarget;
        document.getElementById('stat-approved').innerText = data.metrics.approved;
        document.getElementById('stat-unsubmitted').innerText = data.metrics.notSubmitted;
        
        const percentage = data.metrics.percentage;
        document.getElementById('stat-percent-text').innerText = `${percentage}%`;
        document.getElementById('stat-percent-label').innerText = `${percentage}%`;

        // Update SVG circle dash offset
        const circle = document.getElementById('progress-circle-value');
        const radius = circle.r.baseVal.value;
        const circumference = 2 * Math.PI * radius; // ~213.6
        const offset = circumference - (percentage / 100) * circumference;
        circle.style.strokeDashoffset = offset;

        // Render blacklist table
        const tbody = document.getElementById('blacklist-table-body');
        tbody.innerHTML = '';

        if (data.unsubmitted.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><i class="fa-solid fa-face-smile" style="font-size: 1.5rem; display: block; margin-bottom: 8px;"></i> All sub-entities have fully reported!</td></tr>`;
            return;
        }

        data.unsubmitted.forEach(row => {
            const tr = document.createElement('tr');
            
            const badgeClass = row.documentLink ? 'badge pending' : 'badge not-submitted';
            
            tr.innerHTML = `
                <td style="font-weight: 600;">${escapeHtml(row.userName)}</td>
                <td style="color: var(--text-secondary);">${escapeHtml(row.userUsername)}</td>
                <td><span class="badge-role">${escapeHtml(row.type)}</span></td>
                <td style="font-weight: 500;">${escapeHtml(row.itemName)}</td>
                <td>
                    <span class="${badgeClass}">
                        <i class="${row.documentLink ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-triangle-exclamation'}"></i>
                        ${escapeHtml(row.status)}
                    </span>
                    ${row.documentLink ? `<br><a href="${escapeHtml(row.documentLink)}" target="_blank" class="document-link-cell" style="margin-top: 4px; font-size: 0.8rem;"><i class="fa-solid fa-link"></i> View Link</a>` : ''}
                </td>
                <td style="font-size: 0.85rem; color: #fda4af;">${row.feedback ? escapeHtml(row.feedback) : '-'}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
    }
}

// Fetch and load report items for submissions (Teacher and MC only)
async function loadReportData() {
    const term = document.getElementById('term-select').value;
    const isArchived = isTermArchived(term);
    const container = document.getElementById('report-items-container');
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Loading report data...</div>';

    try {
        const res = await fetch(`${API_URL}/api/reports/my-items?term=${term}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load reporting items');

        const data = await res.json();
        container.innerHTML = '';

        if (data.items.length === 0) {
            container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-regular fa-folder-open" style="font-size: 2.5rem; display: block; margin-bottom: 12px; color: var(--primary-color);"></i>
                No subjects or departments have been assigned to you. Contact the level/institution above you for assignment.
            </div>`;
            return;
        }

        data.items.forEach((item, index) => {
            const isApproved = (item.status === 'Approved');
            const itemName = (data.role === 6) ? item.subject_name : item.department_name;
            const card = document.createElement('div');
            card.className = 'report-card glass-panel';

            let statusBadge = '';
            if (isApproved) {
                statusBadge = `<span class="badge approved"><i class="fa-solid fa-circle-check"></i> Approved</span>`;
            } else if (item.document_link) {
                statusBadge = `<span class="badge pending"><i class="fa-solid fa-spinner fa-spin"></i> Pending Review</span>`;
            } else {
                statusBadge = `<span class="badge not-submitted"><i class="fa-solid fa-triangle-exclamation"></i> Not Submitted</span>`;
            }

            // Academic Year input for Teachers
            const academicYearInput = (data.role === 6) ? `
                <div class="input-wrapper">
                    <label for="year-${index}">Academic Year</label>
                    <input type="text" id="year-${index}" placeholder="Example: 2025/2026" value="${escapeHtml(item.academic_year || '')}" ${isApproved || isArchived ? 'disabled' : ''} required>
                </div>
            ` : '';

            // Feedback Banner
            let feedbackBanner = '';
            if (item.feedback) {
                const isRejectedNotice = !item.document_link;
                const bubbleClass = isRejectedNotice ? 'feedback-bubble' : 'feedback-bubble info';
                const icon = isRejectedNotice ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-comment-dots';
                const titleText = isRejectedNotice ? 'Rejection Notes (Please Resubmit)' : 'Verifier Notes';
                
                feedbackBanner = `
                    <div class="${bubbleClass}">
                        <h5><i class="${icon}"></i> ${titleText}</h5>
                        <p>${escapeHtml(item.feedback)}</p>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="report-card-header">
                    <div>
                        <h3>${escapeHtml(itemName)}</h3>
                        <span>Term: ${term}</span>
                    </div>
                    ${statusBadge}
                </div>
                
                ${feedbackBanner}

                <form class="report-form" onsubmit="submitReport(event, '${escapeHtml(itemName)}', ${index}, '${term}', ${data.role})">
                    ${academicYearInput}
                    
                    <div class="input-wrapper">
                        <label for="link-${index}">Google Drive / OneDrive Link</label>
                        <div class="link-input-group">
                            <input type="url" id="link-${index}" 
                                   placeholder="https://drive.google.com/file/d/..." 
                                   value="${escapeHtml(item.document_link || '')}" 
                                   onchange="validateLinkField(${index})"
                                   ${isApproved || isArchived ? 'disabled' : ''} required>
                            <span id="validation-icon-${index}" class="validation-icon"></span>
                        </div>
                        <span id="validation-msg-${index}" class="validation-hint"></span>
                    </div>

                    ${!isApproved && !isArchived ? `
                        <button type="submit" id="submit-btn-${index}" class="btn btn-primary btn-block">
                            <i class="fa-solid fa-paper-plane"></i>
                            <span>Verify & Submit Report</span>
                        </button>
                    ` : isApproved ? `
                        <div class="alert-banner success" style="display: flex; padding: 10px 16px;">
                            <i class="fa-solid fa-lock" style="font-size: 1.1rem; margin-right: 8px;"></i>
                            <span style="font-size: 0.8rem;">Report has been approved and permanently locked.</span>
                        </div>
                    ` : `
                        <div class="alert-banner warning" style="display: flex; padding: 10px 16px;">
                            <i class="fa-solid fa-lock" style="font-size: 1.1rem; margin-right: 8px;"></i>
                            <span style="font-size: 0.8rem;">System is locked (Read-Only).</span>
                        </div>
                    `}
                </form>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--danger-color);">${escapeHtml(err.message)}</div>`;
    }
}

// Real-time link validation in forms
async function validateLinkField(index) {
    const input = document.getElementById(`link-${index}`);
    const iconSpan = document.getElementById(`validation-icon-${index}`);
    const msgSpan = document.getElementById(`validation-msg-${index}`);
    const submitBtn = document.getElementById(`submit-btn-${index}`);
    const url = input.value.trim();

    if (!url) {
        input.className = '';
        iconSpan.innerHTML = '';
        msgSpan.innerText = '';
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    // Temporary Loading UI
    iconSpan.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--text-secondary);"></i>`;
    msgSpan.innerText = 'Verifying link accessibility...';
    msgSpan.className = 'validation-hint';

    try {
        const res = await fetch(`${API_URL}/api/reports/validate-link`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ url })
        });

        const data = await res.json();
        
        if (data.valid) {
            input.className = 'valid';
            iconSpan.innerHTML = `<i class="fa-solid fa-circle-check success"></i>`;
            msgSpan.innerText = data.warning ? data.message : 'Link verified as publicly accessible.';
            msgSpan.className = 'validation-hint success';
            if (submitBtn) submitBtn.disabled = false;
        } else {
            input.className = 'invalid';
            iconSpan.innerHTML = `<i class="fa-solid fa-circle-xmark danger"></i>`;
            msgSpan.innerText = data.message;
            msgSpan.className = 'validation-hint danger';
            if (submitBtn) submitBtn.disabled = true;
        }
    } catch (err) {
        iconSpan.innerHTML = '';
        msgSpan.innerText = 'Validation connection error.';
        msgSpan.className = 'validation-hint danger';
    }
}

// Submit single report
async function submitReport(e, itemName, index, term, role) {
    e.preventDefault();
    const documentLink = document.getElementById(`link-${index}`).value.trim();
    let academicYear = null;
    
    if (role === 6) {
        academicYear = document.getElementById(`year-${index}`).value.trim();
    }

    const submitBtn = document.getElementById(`submit-btn-${index}`);
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting Report...`;

    try {
        const res = await fetch(`${API_URL}/api/reports/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ itemName, documentLink, academicYear, term })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit report');

        alert('Report submitted successfully!');
        loadReportData();
    } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// Load reports queue for verification (Institution & Union)
async function loadMonitorData() {
    const term = document.getElementById('term-select').value;
    const isArchived = isTermArchived(term);
    const tbody = document.getElementById('monitor-table-body');
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading monitoring data...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/api/reports/verification-queue?term=${term}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load verification queue');

        const data = await res.json();
        tbody.innerHTML = '';

        let reports = [];
        if (data.type === 'teaching' || data.type === 'department') {
            reports = data.reports;
        } else if (data.type === 'all') {
            // Master gets all reports in unified structure
            reports = [
                ...data.teaching.map(x => ({ ...x, type: 'teaching' })),
                ...data.department.map(x => ({ ...x, type: 'department' }))
            ];
        }

        if (reports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><i class="fa-regular fa-folder-open" style="font-size: 2rem; display: block; margin-bottom: 8px;"></i> Verification queue is empty for this term.</td></tr>`;
            return;
        }

        reports.forEach((rep, idx) => {
            const tr = document.createElement('tr');
            
            const isApproved = (rep.status === 'Approved');
            let statusBadge = isApproved ? 
                `<span class="badge approved"><i class="fa-solid fa-circle-check"></i> Approved</span>` : 
                `<span class="badge pending"><i class="fa-solid fa-clock"></i> Pending Review</span>`;

            const typeLabel = rep.type ? `(${rep.type === 'teaching' ? 'Teacher' : 'MC'})` : '';
            const repType = rep.type || data.type; // fallback

            tr.innerHTML = `
                <td style="font-weight: 600;">${escapeHtml(rep.sender_name)}</td>
                <td>
                    <span style="font-weight: 500; display: block;">${escapeHtml(rep.item_name)}</span>
                    ${rep.academic_year ? `<span style="font-size:0.75rem; color: var(--text-muted)">AY: ${escapeHtml(rep.academic_year)}</span>` : ''}
                    <span style="font-size:0.75rem; color: var(--text-muted)">${typeLabel}</span>
                </td>
                <td style="font-family: monospace;">${escapeHtml(rep.term)}</td>
                <td>
                    <a href="${escapeHtml(rep.document_link)}" target="_blank" class="document-link-cell">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        <span>Open Document Link</span>
                    </a>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <textarea id="feedback-${idx}" class="feedback-input" placeholder="Enter feedback/reasons for rejection..." ${isApproved || isArchived ? 'disabled' : ''}>${escapeHtml(rep.feedback || '')}</textarea>
                </td>
                <td>
                    ${!isApproved && !isArchived ? `
                        <div class="action-buttons">
                            <button class="btn btn-success btn-icon" title="Approve Report" onclick="verifyReport('${repType}', ${rep.id}, 'approve', ${idx})">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <button class="btn btn-danger btn-icon" title="Reject / Delete Link" onclick="verifyReport('${repType}', ${rep.id}, 'reject', ${idx})">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    ` : isApproved ? `
                        <span style="color: var(--text-muted); font-size: 0.8rem;"><i class="fa-solid fa-lock"></i> Approved</span>
                    ` : `
                        <span style="color: var(--text-muted); font-size: 0.8rem;"><i class="fa-solid fa-lock"></i> Locked</span>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: var(--danger-color);">${escapeHtml(err.message)}</td></tr>`;
    }
}

// Call approve or reject API
async function verifyReport(type, id, action, idx) {
    const feedback = document.getElementById(`feedback-${idx}`).value.trim();
    
    if (action === 'reject' && !confirm('Are you sure you want to reject this report? The document link in the database will be deleted and the subordinate will need to resubmit.')) {
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/reports/verify/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ type, action, feedback })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to process verification');

        alert(data.message);
        loadMonitorData();
    } catch (err) {
        alert(err.message);
    }
}

// Fetch and load users list and setup user creation roles dropdown
async function loadUsersData() {
    const tbody = document.getElementById('subordinates-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Loading user data...</td></tr>';

    try {
        const res = await fetch(`${API_URL}/api/users/subordinates`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load user list');

        cachedSubordinates = await res.json();
        
        // Setup user creation form inputs
        setupUserCreationForm(cachedSubordinates);
        
        // Populate filter dropdown choices
        populateFilterDropdowns();

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty" style="color: var(--danger-color);">${escapeHtml(err.message)}</td></tr>`;
    }
}

// Populate Division dropdown and trigger cascading updates for Union and MC
function populateFilterDropdowns() {
    const divSelect = document.getElementById('filter-user-division');
    if (!divSelect) return;

    const userRole = currentUser.role_id;
    const curParts = currentUser.branch_code.split('.');

    // Collect all unique Division users present in cached subordinates
    const divisionsMap = new Map();
    cachedSubordinates.forEach(u => {
        if (u.role_id === 2) {
            divisionsMap.set(u.id.toString(), u);
        }
    });

    // Populate Division Dropdown
    divSelect.innerHTML = '<option value="">All Divisions</option>';
    
    if (userRole === 2) {
        // Logged in as Division
        const opt = document.createElement('option');
        opt.value = curParts[1];
        opt.innerText = `${currentUser.name}${currentUser.short_name ? ` (${currentUser.short_name})` : ''}`;
        divSelect.appendChild(opt);
        divSelect.value = curParts[1];
        divSelect.disabled = true;
    } else if (userRole >= 3) {
        // Logged in as Union/MC/Institution/Teacher (cannot select division, hide/lock it)
        divSelect.value = curParts[1];
        const wrapper = divSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'none';
    } else {
        // Master Admin
        const divisions = Array.from(divisionsMap.values());
        divisions.sort((a, b) => a.name.localeCompare(b.name));
        divisions.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.innerText = `${d.name}${d.short_name ? ` (${d.short_name})` : ''}`;
            divSelect.appendChild(opt);
        });
        divSelect.disabled = false;
        const wrapper = divSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'flex';
    }

    updateUnionDropdown();
}

// Update Union dropdown based on selected Division
function updateUnionDropdown() {
    const divSelect = document.getElementById('filter-user-division');
    const unionSelect = document.getElementById('filter-user-union');
    if (!unionSelect) return;

    const selectedDivId = divSelect.value;
    const userRole = currentUser.role_id;
    const curParts = currentUser.branch_code.split('.');

    unionSelect.innerHTML = '<option value="">All Unions</option>';

    if (userRole === 3) {
        // Logged in as Union
        const opt = document.createElement('option');
        opt.value = curParts[2];
        opt.innerText = `${currentUser.name}${currentUser.short_name ? ` (${currentUser.short_name})` : ''}`;
        unionSelect.appendChild(opt);
        unionSelect.value = curParts[2];
        unionSelect.disabled = true;
    } else if (userRole >= 4) {
        // Logged in as MC or below
        unionSelect.value = curParts[2];
        const wrapper = unionSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'none';
    } else {
        // Master or Division: list unions
        const unionsMap = new Map();
        cachedSubordinates.forEach(u => {
            if (u.role_id === 3) {
                const parts = u.branch_code.split('.');
                if (!selectedDivId || parts[1] === selectedDivId) {
                    unionsMap.set(u.id.toString(), u);
                }
            }
        });

        const unions = Array.from(unionsMap.values());
        unions.sort((a, b) => a.name.localeCompare(b.name));
        unions.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerText = `${u.name}${u.short_name ? ` (${u.short_name})` : ''}`;
            unionSelect.appendChild(opt);
        });
        unionSelect.disabled = false;
        const wrapper = unionSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'flex';
    }

    updateMcDropdown();
}

// Update Mission/Conference dropdown based on selected Union
function updateMcDropdown() {
    const divSelect = document.getElementById('filter-user-division');
    const unionSelect = document.getElementById('filter-user-union');
    const mcSelect = document.getElementById('filter-user-mc');
    if (!mcSelect) return;

    const selectedDivId = divSelect.value;
    const selectedUnionId = unionSelect.value;
    const userRole = currentUser.role_id;
    const curParts = currentUser.branch_code.split('.');

    mcSelect.innerHTML = '<option value="">All Missions / Conferences</option>';

    if (userRole === 4) {
        // Logged in as MissionConference
        const opt = document.createElement('option');
        opt.value = curParts[3];
        opt.innerText = `${currentUser.name}${currentUser.short_name ? ` (${currentUser.short_name})` : ''}`;
        mcSelect.appendChild(opt);
        mcSelect.value = curParts[3];
        mcSelect.disabled = true;
    } else if (userRole >= 5) {
        // Logged in as Institution/Teacher
        mcSelect.value = curParts[3];
        const wrapper = mcSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'none';
    } else {
        // Master, Division, or Union: list conferences
        const mcsMap = new Map();
        cachedSubordinates.forEach(u => {
            if (u.role_id === 4) {
                const parts = u.branch_code.split('.');
                const matchesDiv = !selectedDivId || parts[1] === selectedDivId;
                const matchesUnion = !selectedUnionId || parts[2] === selectedUnionId;
                if (matchesDiv && matchesUnion) {
                    mcsMap.set(u.id.toString(), u);
                }
            }
        });

        const mcs = Array.from(mcsMap.values());
        mcs.sort((a, b) => a.name.localeCompare(b.name));
        mcs.forEach(mc => {
            const opt = document.createElement('option');
            opt.value = mc.id;
            opt.innerText = `${mc.name}${mc.short_name ? ` (${mc.short_name})` : ''}`;
            mcSelect.appendChild(opt);
        });
        mcSelect.disabled = false;
        const wrapper = mcSelect.closest('.filter-group');
        if (wrapper) wrapper.style.display = 'flex';
    }
}

// Filter cached subordinates based on search name and division/union/mc selections
function applySubordinatesFilter() {
    const searchVal = document.getElementById('filter-user-name').value.toLowerCase().trim();
    const selectedDivId = document.getElementById('filter-user-division').value;
    const selectedUnionId = document.getElementById('filter-user-union').value;
    const selectedMcId = document.getElementById('filter-user-mc').value;
    const tbody = document.getElementById('subordinates-table-body');

    // 1. Filter
    let filtered = cachedSubordinates.filter(user => {
        const parts = user.branch_code.split('.');

        const matchesSearch = !searchVal || 
            user.name.toLowerCase().includes(searchVal) || 
            (user.short_name && user.short_name.toLowerCase().includes(searchVal)) ||
            user.username.toLowerCase().includes(searchVal);
        
        let matchesHierarchy = true;
        if (selectedMcId) {
            matchesHierarchy = (parts[3] === selectedMcId);
        } else if (selectedUnionId) {
            matchesHierarchy = (parts[2] === selectedUnionId);
        } else if (selectedDivId) {
            matchesHierarchy = (parts[1] === selectedDivId);
        }
        
        return matchesSearch && matchesHierarchy;
    });

    // 2. Render
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No sub-entity accounts match the filter.</td></tr>';
        return;
    }

    const rolesNames = {
        1: 'Master',
        2: 'Division',
        3: 'Union',
        4: 'MissionConference',
        5: 'Institution',
        6: 'Teacher'
    };

    filtered.forEach(user => {
        const tr = document.createElement('tr');
        
        // Show Manage Items button only for role Teacher (6) and MissionConference President (4)
        const canManageItems = (user.role_id === 6 || (user.role_id === 4 && user.position === 'President'));
        const manageBtn = canManageItems ? `
            <button class="btn btn-secondary btn-icon" title="Manage Report Duty Items" onclick="openItemsModal(${user.id}, '${escapeHtml(user.name)}', ${user.role_id})">
                <i class="fa-solid fa-list-check"></i>
            </button>
        ` : '';

        let roleLabel = rolesNames[user.role_id];
        if (user.position && user.position !== 'President' && user.position !== 'Teacher') {
            if (user.position === 'Department') {
                roleLabel += ` (${user.department_name})`;
            } else {
                roleLabel += ` (${user.position})`;
            }
        }

        // Add delete button for all subordinates
        const deleteBtn = `
            <button class="btn btn-danger btn-icon" title="Delete Account" onclick="deleteUser(${user.id}, '${escapeHtml(user.name)}')">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;

        tr.innerHTML = `
            <td style="font-weight: 600;">${escapeHtml(user.name)}${user.short_name ? ` (${escapeHtml(user.short_name)})` : ''}</td>
             <td style="color: var(--text-secondary);">${escapeHtml(user.username)}</td>
            <td><span class="badge-role">${roleLabel}</span></td>
            <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(user.branch_code)}</td>
            <td>
                <div class="action-buttons">
                    ${manageBtn}
                    ${deleteBtn}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Fetch and load user creation data (specifically for populating parents dropdown)
async function loadCreateUserData() {
    try {
        const res = await fetch(`${API_URL}/api/users/subordinates`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load relationship data.');

        const users = await res.json();
        // Setup user creation form inputs
        setupUserCreationForm(users);
    } catch (err) {
        console.error(err);
    }
}

// Populate user creation roles dropdown and rule banners
function setupUserCreationForm(allSubordinates) {
    cachedSubordinates = allSubordinates;
    const creatorRole = currentUser.role_id;
    const roleSelect = document.getElementById('create-role');
    const ruleText = document.getElementById('user-creation-rule-text');
    
    roleSelect.innerHTML = '';
    
    const rolesList = [
        { id: 2, name: 'Division' },
        { id: 3, name: 'Union' },
        { id: 4, name: 'Mission / Conference' },
        { id: 5, name: 'Institution' },
        { id: 6, name: 'Teacher' }
    ];

    if (creatorRole === 1) {
        // Master can create anything from level 2 to 6
        ruleText.innerText = 'Rule (Master): You hold full authorization to create a new user at any level.';
        rolesList.forEach(role => {
            const opt = document.createElement('option');
            opt.value = role.id;
            opt.innerText = role.name;
            roleSelect.appendChild(opt);
        });
    } else {
        // Strict 1 level below
        const targetRole = creatorRole + 1;
        const targetObj = rolesList.find(r => r.id === targetRole);
        ruleText.innerText = `Rule: You are only allowed to create a new user account exactly one level below you (${targetObj ? targetObj.name : 'Teacher'}).`;
        
        if (targetObj) {
            const opt = document.createElement('option');
            opt.value = targetObj.id;
            opt.innerText = targetObj.name;
            roleSelect.appendChild(opt);
        }
    }

    // Trigger initial role change handler to adjust form layout
    handleRoleChange(allSubordinates);
}

// Handle changes in the user creation Role select input
function handleRoleChange(subordinatesList) {
    const roleSelect = document.getElementById('create-role');
    const targetRoleId = parseInt(roleSelect.value, 10);
    const posWrapper = document.getElementById('create-position-wrapper');
    const deptWrapper = document.getElementById('create-department-wrapper');
    const parentWrapper = document.getElementById('parent-selection-wrapper');
    const itemsWrapper = document.getElementById('assigned-items-wrapper');
    const itemsLabel = document.getElementById('assigned-items-label');
    const shortNameWrapper = document.getElementById('short-name-wrapper');
    const shortNameInput = document.getElementById('create-short-name');

    // 1. Position selector: Visible for roles 2-5 (not Teacher role 6)
    if (targetRoleId >= 2 && targetRoleId <= 5) {
        posWrapper.style.display = 'block';
    } else {
        posWrapper.style.display = 'none';
    }

    // 2. Short Name: Visible and required for roles 2-5
    if (targetRoleId >= 2 && targetRoleId <= 5) {
        shortNameWrapper.style.display = 'block';
        shortNameInput.required = true;
    } else {
        shortNameWrapper.style.display = 'none';
        shortNameInput.required = false;
        shortNameInput.value = '';
    }

    // 3. Assigned Items: Visible for Teacher (role 6) or MC President (role 4 + President)
    const posSelect = document.getElementById('create-position');
    const targetPosition = (targetRoleId === 6) ? 'Teacher' : posSelect.value;

    if (targetRoleId === 6) {
        itemsWrapper.style.display = 'block';
        itemsLabel.innerText = 'Subjects Taught';
        resetDynamicItemList('assigned-items-list', 'Example: Mathematics');
    } else if (targetRoleId === 4 && targetPosition === 'President') {
        itemsWrapper.style.display = 'block';
        itemsLabel.innerText = 'Organization Departments';
        resetDynamicItemList('assigned-items-list', 'Example: Youth Ministries (YM)');
    } else {
        itemsWrapper.style.display = 'none';
    }

    handleCreatePositionChange();
}

function handleCreatePositionChange() {
    const roleSelect = document.getElementById('create-role');
    const targetRoleId = parseInt(roleSelect.value, 10);
    const posSelect = document.getElementById('create-position');
    const targetPosition = (targetRoleId === 6) ? 'Teacher' : posSelect.value;
    
    const deptWrapper = document.getElementById('create-department-wrapper');
    const parentWrapper = document.getElementById('parent-selection-wrapper');
    const itemsWrapper = document.getElementById('assigned-items-wrapper');
    const itemsLabel = document.getElementById('assigned-items-label');

    // Toggle department select visibility
    deptWrapper.style.display = (targetPosition === 'Department') ? 'block' : 'none';

    // Toggle legacyMC departments visibility
    if (targetRoleId === 4 && targetPosition === 'President') {
        itemsWrapper.style.display = 'block';
        itemsLabel.innerText = 'Organization Departments';
    } else if (targetRoleId !== 6) {
        itemsWrapper.style.display = 'none';
    }

    // Toggle parent selection wrappers
    if (currentUser.role_id === 1) {
        const depth = getTargetParentDepth();
        if (depth >= 2) {
            parentWrapper.style.display = 'block';
            setupChainedParentDropdowns();
        } else {
            parentWrapper.style.display = 'none';
        }
    } else {
        parentWrapper.style.display = 'none';
    }
}

function getTargetParentDepth() {
    const roleSelect = document.getElementById('create-role');
    const targetRoleId = parseInt(roleSelect.value, 10);
    const posSelect = document.getElementById('create-position');
    const targetPosition = (targetRoleId === 6) ? 'Teacher' : posSelect.value;
    return (targetPosition === 'President' || targetRoleId === 6) ? targetRoleId - 1 : targetRoleId;
}

// Helper to setup and show/hide chained parent selection dropdowns
function setupChainedParentDropdowns() {
    const divWrapper = document.getElementById('parent-division-wrapper');
    const unionWrapper = document.getElementById('parent-union-wrapper');
    const mcWrapper = document.getElementById('parent-mc-wrapper');
    const instWrapper = document.getElementById('parent-institution-wrapper');

    const depth = getTargetParentDepth();

    // Show/hide wrappers based on target role depth
    divWrapper.style.display = (depth >= 2) ? 'block' : 'none';
    unionWrapper.style.display = (depth >= 3) ? 'block' : 'none';
    mcWrapper.style.display = (depth >= 4) ? 'block' : 'none';
    instWrapper.style.display = (depth >= 5) ? 'block' : 'none';

    // Populate Division select initially
    const divSelect = document.getElementById('parent-division-select');
    divSelect.innerHTML = '';
    
    const divisions = cachedSubordinates.filter(u => u.role_id === 2 && u.position === 'President');
    if (divisions.length === 0) {
        divSelect.innerHTML = '<option value="">-- No divisions available --</option>';
    } else {
        divisions.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.dataset.branch = d.branch_code;
            opt.innerText = `${d.name}${d.short_name ? ` (${d.short_name})` : ''}`;
            divSelect.appendChild(opt);
        });
    }

    onParentDivisionChange();
}

function onParentDivisionChange() {
    const divSelect = document.getElementById('parent-division-select');
    const unionSelect = document.getElementById('parent-union-select');
    unionSelect.innerHTML = '';

    const selectedOpt = divSelect.options[divSelect.selectedIndex];
    const divBranch = selectedOpt ? selectedOpt.dataset.branch : '';
    const depth = getTargetParentDepth();

    if (depth < 3 || !divBranch) {
        unionSelect.innerHTML = '<option value="">-- Select Division First --</option>';
        onParentUnionChange();
        return;
    }

    const unions = cachedSubordinates.filter(u => u.role_id === 3 && u.position === 'President' && u.branch_code.startsWith(divBranch + '.'));
    if (unions.length === 0) {
        unionSelect.innerHTML = '<option value="">-- No unions available --</option>';
    } else {
        unions.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.dataset.branch = u.branch_code;
            opt.innerText = `${u.name}${u.short_name ? ` (${u.short_name})` : ''}`;
            unionSelect.appendChild(opt);
        });
    }

    onParentUnionChange();
}

function onParentUnionChange() {
    const unionSelect = document.getElementById('parent-union-select');
    const mcSelect = document.getElementById('parent-mc-select');
    mcSelect.innerHTML = '';

    const selectedOpt = unionSelect.options[unionSelect.selectedIndex];
    const unionBranch = selectedOpt ? selectedOpt.dataset.branch : '';
    const depth = getTargetParentDepth();

    if (depth < 4 || !unionBranch) {
        mcSelect.innerHTML = '<option value="">-- Select Union First --</option>';
        onParentMCChange();
        return;
    }

    const mcs = cachedSubordinates.filter(u => u.role_id === 4 && u.position === 'President' && u.branch_code.startsWith(unionBranch + '.'));
    if (mcs.length === 0) {
        mcSelect.innerHTML = '<option value="">-- No missions/conferences available --</option>';
    } else {
        mcs.forEach(mc => {
            const opt = document.createElement('option');
            opt.value = mc.id;
            opt.dataset.branch = mc.branch_code;
            opt.innerText = `${mc.name}${mc.short_name ? ` (${mc.short_name})` : ''}`;
            mcSelect.appendChild(opt);
        });
    }

    onParentMCChange();
}

function onParentMCChange() {
    const mcSelect = document.getElementById('parent-mc-select');
    const instSelect = document.getElementById('parent-institution-select');
    instSelect.innerHTML = '';

    const selectedOpt = mcSelect.options[mcSelect.selectedIndex];
    const mcBranch = selectedOpt ? selectedOpt.dataset.branch : '';
    const depth = getTargetParentDepth();

    if (depth < 5 || !mcBranch) {
        instSelect.innerHTML = '<option value="">-- Select Mission / Conference First --</option>';
        return;
    }

    const insts = cachedSubordinates.filter(u => u.role_id === 5 && u.position === 'President' && u.branch_code.startsWith(mcBranch + '.'));
    if (insts.length === 0) {
        instSelect.innerHTML = '<option value="">-- No institutions available --</option>';
    } else {
        insts.forEach(inst => {
            const opt = document.createElement('option');
            opt.value = inst.id;
            opt.dataset.branch = inst.branch_code;
            opt.innerText = `${inst.name}${inst.short_name ? ` (${inst.short_name})` : ''}`;
            instSelect.appendChild(opt);
        });
    }
}

// Reset dynamic item input list with a default input row
function resetDynamicItemList(containerId, placeholder) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="dynamic-item-row">
            <input type="text" class="assigned-item-input" placeholder="${placeholder}">
            <button type="button" class="btn-icon btn-add-item" onclick="addDynamicItemRow('${containerId}')"><i class="fa-solid fa-plus"></i></button>
        </div>
    `;
}

// Add row to dynamic items input list
function addDynamicItemRow(containerId = 'assigned-items-list') {
    const container = document.getElementById(containerId);
    const rows = container.getElementsByClassName('dynamic-item-row');
    const placeholder = rows[0]?.querySelector('input')?.placeholder || 'Enter item name...';
    const inputClass = (containerId === 'modal-items-list') ? 'modal-item-input' : 'assigned-item-input';

    const row = document.createElement('div');
    row.className = 'dynamic-item-row';
    row.innerHTML = `
        <input type="text" class="${inputClass}" placeholder="${placeholder}">
        <button type="button" class="btn-icon btn-remove-item" onclick="removeDynamicItemRow(this)"><i class="fa-solid fa-minus"></i></button>
    `;
    container.appendChild(row);
}

// Remove row from dynamic items input list
function removeDynamicItemRow(btn) {
    const row = btn.parentElement;
    row.remove();
}

// Handle User Creation Submit
async function handleCreateUser(e) {
    e.preventDefault();
    const name = document.getElementById('create-name').value.trim();
    const password = document.getElementById('create-password').value.trim();
    const role_id = parseInt(document.getElementById('create-role').value, 10);
    const short_name = document.getElementById('create-short-name').value.trim();
    const position = role_id === 6 ? 'Teacher' : document.getElementById('create-position').value;
    const department_name = position === 'Department' ? document.getElementById('create-department').value : null;
    
    let parent_id = null;
    if (currentUser.role_id === 1) {
        const depth = getTargetParentDepth();
        if (depth === 2) {
            parent_id = document.getElementById('parent-division-select').value;
        } else if (depth === 3) {
            parent_id = document.getElementById('parent-union-select').value;
        } else if (depth === 4) {
            parent_id = document.getElementById('parent-mc-select').value;
        } else if (depth === 5) {
            parent_id = document.getElementById('parent-institution-select').value;
        }

        if (depth >= 2 && !parent_id) {
            alert("Please complete the parent structure selection.");
            return;
        }
    }

    // Collect subjects / departments
    const items = [];
    const itemInputs = document.querySelectorAll('#assigned-items-list input[type="text"]');
    itemInputs.forEach(inp => {
        if (inp.value.trim()) items.push(inp.value.trim());
    });

    const errorBanner = document.getElementById('create-user-error');
    const errorText = document.getElementById('create-user-error-text');
    const successBanner = document.getElementById('create-user-success');

    errorBanner.style.display = 'none';
    successBanner.style.display = 'none';

    try {
        const bodyData = {
            name, password, role_id, parent_id, position, department_name
        };
        
        if (role_id >= 2 && role_id <= 5) {
            bodyData.short_name = short_name;
        }
        
        if (role_id === 6) {
            bodyData.subjects = items;
        } else if (role_id === 4 && position === 'President') {
            bodyData.departments = items;
        }

        const res = await fetch(`${API_URL}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bodyData)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create user.');

        const successText = document.getElementById('create-user-success-text');
        successText.innerHTML = `New user account created successfully! Username: <strong>${data.user.username}</strong>`;
        successBanner.style.display = 'flex';
        document.getElementById('create-user-form').reset();
        
        // Reset dynamic item inputs
        resetDynamicItemList('assigned-items-list', role_id === 6 ? 'Example: Mathematics' : 'Example: Youth Ministries (YM)');
        
        // Reload user creation data to update parent list dropdown
        loadCreateUserData();
        
        // Hide success banner after 4s
        setTimeout(() => {
            successBanner.style.display = 'none';
        }, 4000);

    } catch (err) {
        errorText.innerText = err.message;
        errorBanner.style.display = 'flex';
    }
}

// 6. ITEM ASSIGNMENT MODAL OPERATIONS
async function openItemsModal(userId, userName, roleId) {
    document.getElementById('modal-user-name').innerText = userName;
    document.getElementById('modal-user-id').value = userId;
    
    const label = document.getElementById('modal-items-label');
    label.innerText = (roleId === 6) ? 'Subjects' : 'Departments';

    const container = document.getElementById('modal-items-list');
    container.innerHTML = '<div style="color: var(--text-muted)">Memuat data item...</div>';

    document.getElementById('items-modal').classList.add('active');

    try {
        // Fetch current items from API using my-items style backend lookup
        // We can fetch reports/my-items query directly by sending owner user's token or we query subordinate items
        // Let's call endpoint that returns subordinates or query the DB using stats details
        const term = document.getElementById('term-select').value;
        const res = await fetch(`${API_URL}/api/dashboard/stats?term=${term}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to load item details.');

        const data = await res.json();
        
        // Filter subjects or departments belonging to this userId
        let userItems = [];
        if (roleId === 6) {
            // Find in unsubmitted/approved stats list
            // Actually let's query all items from stats subject list
            // Let's fetch stats unsubmitted list that has this userId or query database details
            // E.g. filter by userId
            // Wait, we can fetch subordinates or look up the list.
            // Let's filter the item stats query.
        }

        // To make it fully robust, we can fetch items from the subordinate listing or do a query.
        // Let's write a simple helper route in our backend if needed, or query dashboard stats.
        // Actually, since we want to know current subjects, let's filter from statistics.
        // Or we can request the backend directly? Yes! Let's write a fallback: since stats lists targets,
        // let's look up subjects assigned. But wait! Let's check how subjects/departments are loaded.
        // In app.js we can look up from the stats data if we cache it, or fetch.
        // Let's make an API call to a specific fetch endpoint: we can get this list easily.
        // Let's query /api/dashboard/stats which returns all targets of the branch.
        // Let's filter subjects/departments by user id:
        
        // Fetch all targets: we can call stats.
        const statsRes = await fetch(`${API_URL}/api/dashboard/stats?term=${term}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsRes.json();
        
        // Find items in stats that belong to this userId
        const items = [];
        // In statsData we have subjects and departments targets. Let's write a simple helper in backend?
        // Wait, statsData.unsubmitted has items, and approved items are in data.metrics? 
        // No, in our stats API we query: subjectsData and deptsData and combine them!
        // Wait! In server.js we do not return raw combined list of ALL items, we return it filtered as allItems.
        // Wait, let's look at what server.js stats endpoint returns:
        // totalTarget, approved, notSubmitted, percentage.
        // and unsubmitted: unsubmittedList (which has userName, userId, itemName).
        // What about approved items? They are not returned in a list! Only unsubmitted are returned.
        // To be safe, let's add a backend endpoint or filter.
        // Wait, let's look at `subordinates` API. It lists users.
        // Can we retrieve a user's items?
        // Let's retrieve this by making a GET request to `/api/reports/my-items` by appending `?userId=X`!
        // Let's check if `/api/reports/my-items` in `server.js` supports `userId` parameter.
        // In `server.js`:
        // `app.get('/api/reports/my-items', authenticateToken, async (req, res) => { ... }`
        // It uses `req.user.id`! It does NOT support passing a custom `userId` query parameter.
        // Wait, if it doesn't, how can we fetch the current subjects of a subordinate Teacher?
        // Ah! Let's modify `server.js` to allow Master or Verifier to pass `userId` as a query parameter!
        // That is an amazing idea. Let's edit `server.js` using `replace_file_content` to support `userId` parameter in `/api/reports/my-items`!
        // Wait, let's check:
        // In `server.js` line 258:
        // `app.get('/api/reports/my-items', ...)`
        // Let's read `server.js` line 258 to see exactly what to replace.
        // We can do this easily. But wait! Let's check if we can read the file or if we already know the exact text.
        // Yes, we wrote it in this turn.
        // Let's make sure the front-end fetches it. If we modify `server.js` to check:
        // `const targetUserId = req.query.userId ? parseInt(req.query.userId, 10) : req.user.id;`
        // Then we do the queries using `targetUserId` instead of `req.user.id`!
        // And we check horizontal isolation: if `targetUserId !== req.user.id`, we verify that the target user's branch starts with `req.user.branch_code` (or user is Master).
        // This is extremely clean and secure! Let's write it down.
        
        // Let's write the fetch in `app.js` first:
        const userRes = await fetch(`${API_URL}/api/reports/my-items?term=${term}&userId=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!userRes.ok) throw new Error('Failed to load report duty items.');
        const userData = await userRes.json();
        
        container.innerHTML = '';
        const placeholder = (roleId === 6) ? 'Example: Mathematics' : 'Example: Youth Ministries (YM)';
        
        if (userData.items.length === 0) {
            container.innerHTML = `
                <div class="dynamic-item-row">
                    <input type="text" class="modal-item-input" placeholder="${placeholder}">
                    <button type="button" class="btn-icon btn-add-item" onclick="addDynamicItemRow('modal-items-list')"><i class="fa-solid fa-plus"></i></button>
                </div>
            `;
        } else {
            userData.items.forEach((item, idx) => {
                const itemName = (userData.role === 6) ? item.subject_name : item.department_name;
                const row = document.createElement('div');
                row.className = 'dynamic-item-row';
                row.innerHTML = `
                    <input type="text" class="modal-item-input" placeholder="Enter item name..." value="${escapeHtml(itemName)}">
                    ${idx === 0 ? `
                        <button type="button" class="btn-icon btn-add-item" onclick="addDynamicItemRow('modal-items-list')"><i class="fa-solid fa-plus"></i></button>
                    ` : `
                        <button type="button" class="btn-icon btn-remove-item" onclick="removeDynamicItemRow(this)"><i class="fa-solid fa-minus"></i></button>
                    `}
                `;
                container.appendChild(row);
            });
        }

    } catch (err) {
        container.innerHTML = `<div style="color: var(--danger-color)">${escapeHtml(err.message)}</div>`;
    }
}

function closeItemsModal() {
    document.getElementById('items-modal').classList.remove('active');
}

// Save assigned items modal changes
async function saveItemsModal() {
    const userId = document.getElementById('modal-user-id').value;
    const itemInputs = document.querySelectorAll('#modal-items-list input[type="text"]');
    const items = [];
    itemInputs.forEach(inp => {
        if (inp.value.trim()) items.push(inp.value.trim());
    });

    try {
        const res = await fetch(`${API_URL}/api/users/assign-items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ userId, items })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save items.');

        alert(data.message || 'Report duty items updated successfully!');
        closeItemsModal();
        
        // Reload dashboard stats and user list
        loadUsersData();
        const selectedTerm = document.getElementById('term-select').value;
        loadDashboardData(selectedTerm);
    } catch (err) {
        alert(err.message);
    }
}

// Delete user account
async function deleteUser(userId, userName) {
    if (!confirm(`Are you sure you want to delete the account "${userName}"? This action will permanently delete all sub-branches under it and all of its performance reports.`)) {
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/api/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete user.');
        
        alert(data.message || 'Account deleted successfully.');
        loadUsersData();
        
        // Reload dashboard stats
        const selectedTerm = document.getElementById('term-select').value;
        loadDashboardData(selectedTerm);
    } catch (err) {
        alert(err.message);
    }
}

// Utility: HTML Escaping to prevent XSS injection
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// User Profile settings modal control functions
function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;
    
    const rolesMapping = {
        1: 'Master Admin',
        2: 'Division',
        3: 'Union',
        4: 'Mission / Conference',
        5: 'Institution',
        6: 'Teacher'
    };
    let roleLabel = rolesMapping[currentUser.role_id] || 'User';
    if (currentUser.position && currentUser.position !== 'President' && currentUser.position !== 'Teacher') {
        if (currentUser.position === 'Department') {
            roleLabel += ` (${currentUser.department_name})`;
        } else {
            roleLabel += ` (${currentUser.position})`;
        }
    }
    
    document.getElementById('profile-username').value = currentUser.username;
    document.getElementById('profile-role-position').value = roleLabel;
    document.getElementById('profile-lineage').value = currentUser.branch_code;
    
    document.getElementById('profile-name').value = currentUser.name || '';
    document.getElementById('profile-email').value = currentUser.email || '';
    document.getElementById('profile-phone').value = currentUser.phone_number || '';
    document.getElementById('profile-password').value = '';
    
    modal.classList.add('active');
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.remove('active');
}

async function saveProfileModal(e) {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const phone_number = document.getElementById('profile-phone').value.trim();
    const password = document.getElementById('profile-password').value.trim();
    
    try {
        const payload = { name, email, phone_number };
        if (password) payload.password = password;
        
        const res = await fetch(`${API_URL}/api/users/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save profile.');
        
        alert(data.message || 'Profile saved successfully.');
        
        // Update profile locally
        currentUser.name = name;
        currentUser.email = email;
        currentUser.phone_number = phone_number;
        
        // Update sidebar display
        document.getElementById('user-display-name').innerText = name;
        
        closeProfileModal();
    } catch (err) {
        alert(err.message);
    }
}
