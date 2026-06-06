/**
 * Scoreniq - Job Posting (Single-page)
 */
const JP = {
    user: null,
    postingId: null,
    data: null,
    API: window.location.origin,

    deadlineTimer: null,

    init() {
        const u = localStorage.getItem('fluenzoUser');
        if (!u) { window.location.href = '/'; return; }
        this.user = JSON.parse(u);

        // Deadline custom toggle
        document.querySelectorAll('input[name="deadline"]').forEach(r => {
            r.addEventListener('change', () => {
                const custom = document.getElementById('custom-deadline-days');
                if (r.value === 'custom' && r.checked) custom.classList.remove('hidden');
                else custom.classList.add('hidden');
            });
        });

        const p = new URLSearchParams(window.location.search);
        if (p.get('id')) {
            this.postingId = p.get('id');
            this.loadPosting(this.postingId);
        }
    },

    async loadPosting(id) {
        try {
            const r = await fetch(`${this.API}/api/job-posting/detail/${id}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.detail);
            const p = d.posting;
            this.data = {
                posting_id: p.posting_id,
                application_url: p.application_url,
                formatted_jd: p.formatted_jd,
                linkedin_post: p.linkedin_post_text,
                hiring_role: p.hiring_role,
                company_name: p.company_name,
                job_location: p.job_location,
                joining_duration: p.joining_duration,
                budget: `${p.budget_currency} ${p.budget_min} - ${p.budget_max}`,
                application_deadline: p.application_deadline,
                status: p.status,
            };
            this.postingId = p.posting_id;
            this.showPreview();
        } catch (e) { this.toast('Failed to load: ' + e.message, 'error'); }
    },

    // ==================== Generate ====================
    async generate() {
        const rawJd = document.getElementById('raw-jd').value.trim();
        const role = document.getElementById('hiring-role').value.trim();
        const company = document.getElementById('company-name').value.trim();
        const loc = document.getElementById('job-location').value.trim();
        const dur = document.getElementById('joining-duration').value;
        const cur = document.getElementById('budget-currency').value;
        const bmin = document.getElementById('budget-min').value.trim();
        const bmax = document.getElementById('budget-max').value.trim();

        if (!rawJd) return this.toast('Paste the job description', 'error');
        if (!role) return this.toast('Enter the job title', 'error');
        if (!company) return this.toast('Enter the company name', 'error');
        if (!loc) return this.toast('Enter the job location', 'error');
        if (!dur) return this.toast('Select the joining timeline', 'error');
        if (!bmin || !bmax) return this.toast('Enter the budget range', 'error');

        // Get deadline days
        const deadlineRadio = document.querySelector('input[name="deadline"]:checked');
        let deadlineDays = 10;
        if (deadlineRadio) {
            if (deadlineRadio.value === 'custom') {
                const customVal = parseInt(document.getElementById('custom-deadline-days').value);
                if (!customVal || customVal < 1 || customVal > 90) return this.toast('Enter custom deadline between 1-90 days', 'error');
                deadlineDays = customVal;
            } else {
                deadlineDays = parseInt(deadlineRadio.value);
            }
        }

        const btn = document.getElementById('btn-generate');
        btn.disabled = true;
        btn.textContent = 'Generating...';

        // Show preview panel with loading
        document.getElementById('panel-preview').classList.remove('hidden');
        document.getElementById('preview-loading').classList.remove('hidden');
        document.getElementById('preview-content').classList.add('hidden');

        try {
            const r = await fetch(`${this.API}/api/job-posting/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recruiter_email: this.user.email,
                    raw_jd: rawJd, hiring_role: role, company_name: company,
                    job_location: loc, joining_duration: dur,
                    budget_min: bmin, budget_max: bmax, budget_currency: cur,
                    deadline_days: deadlineDays,
                })
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'Failed');

            this.postingId = d.posting_id;
            this.data = d;
            this.data.status = 'active';
            this.data.application_deadline = d.application_deadline;
            // Update URL without reload
            history.replaceState(null, '', `/k2yh?id=${d.posting_id}`);
            this.showPreview();
            this.toast('Posting created!', 'success');
        } catch (e) {
            this.toast(e.message, 'error');
            document.getElementById('panel-preview').classList.add('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Generate LinkedIn Posting';
        }
    },

    // ==================== Show Preview ====================
    showPreview() {
        document.getElementById('preview-loading').classList.add('hidden');
        document.getElementById('preview-content').classList.remove('hidden');
        document.getElementById('panel-preview').classList.remove('hidden');

        // URL
        const urlLink = document.getElementById('app-url-link');
        urlLink.href = this.data.application_url;
        urlLink.textContent = this.data.application_url;

        // LinkedIn post
        document.getElementById('linkedin-display').innerHTML = this.toHtml(this.data.linkedin_post);
        document.getElementById('linkedin-edit').value = this.data.linkedin_post;

        // Full JD
        document.getElementById('jd-display').innerHTML = this.toHtml(this.data.formatted_jd);

        // App count button
        document.getElementById('btn-apps').style.display = 'inline-flex';

        this.checkLinkedIn();
        this.loadAppCount();
        this.updateDeadlineBar();
    },

    toHtml(text) {
        if (!text) return '<span style="color:#94a3b8">No content</span>';
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            // Make URLs clickable
            .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#0891b2;text-decoration:underline">$1</a>')
            .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>');
    },

    // ==================== Edit ====================
    toggleEdit(field) {
        const display = document.getElementById(`${field}-display`);
        const edit = document.getElementById(`${field}-edit`);
        const bar = document.getElementById(`${field}-edit-bar`);
        const isEditing = !edit.classList.contains('hidden');

        if (isEditing) {
            this.cancelEdit(field);
        } else {
            edit.value = field === 'linkedin' ? this.data.linkedin_post : this.data.formatted_jd;
            display.classList.add('hidden');
            edit.classList.remove('hidden');
            bar.classList.remove('hidden');
            edit.focus();
        }
    },

    async saveEdit(field) {
        const edit = document.getElementById(`${field}-edit`);
        const newText = edit.value.trim();
        if (!newText) return;

        const key = field === 'linkedin' ? 'linkedin_post_text' : 'formatted_jd';
        try {
            await fetch(`${this.API}/api/job-posting/update-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, [key]: newText })
            });

            if (field === 'linkedin') this.data.linkedin_post = newText;
            else this.data.formatted_jd = newText;

            document.getElementById(`${field}-display`).innerHTML = this.toHtml(newText);
            this.cancelEdit(field);
            this.toast('Saved!', 'success');
        } catch (e) { this.toast('Save failed', 'error'); }
    },

    cancelEdit(field) {
        document.getElementById(`${field}-display`).classList.remove('hidden');
        document.getElementById(`${field}-edit`).classList.add('hidden');
        document.getElementById(`${field}-edit-bar`).classList.add('hidden');
    },

    // ==================== AI Refine ====================
    async refine() {
        const input = document.getElementById('refine-input');
        const cmd = input.value.trim();
        if (!cmd) return;

        const btn = document.getElementById('btn-refine');
        btn.disabled = true;
        input.disabled = true;

        try {
            const r = await fetch(`${this.API}/api/job-posting/refine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    posting_id: this.postingId,
                    command: cmd,
                    current_text: this.data.linkedin_post,
                    field: 'linkedin_post',
                })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.detail || 'Refine failed');

            this.data.linkedin_post = d.refined_text;
            document.getElementById('linkedin-display').innerHTML = this.toHtml(d.refined_text);
            document.getElementById('linkedin-edit').value = d.refined_text;
            input.value = '';
            this.toast('Template updated!', 'success');
        } catch (e) { this.toast(e.message, 'error'); }
        finally { btn.disabled = false; input.disabled = false; }
    },

    // ==================== Copy ====================
    copyUrl() {
        navigator.clipboard.writeText(this.data.application_url).then(() => this.toast('URL copied!', 'success'));
    },
    copyLinkedIn() {
        navigator.clipboard.writeText(this.data.linkedin_post).then(() => this.toast('Post copied!', 'success'));
    },

    // ==================== LinkedIn ====================
    async checkLinkedIn() {
        try {
            const r = await fetch(`${this.API}/api/job-posting/linkedin-status?recruiter_email=${encodeURIComponent(this.user.email)}`);
            const d = await r.json();
            const btn = document.getElementById('btn-post-li');
            if (!d.connected) {
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> Connect LinkedIn & Post';
            }
        } catch (_) {}
    },

    async postToLinkedIn() {
        const btn = document.getElementById('btn-post-li');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<div class="btn-spinner"></div> Posting...';

        try {
            const r = await fetch(`${this.API}/api/job-posting/post-to-linkedin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recruiter_email: this.user.email, posting_id: this.postingId })
            });
            const d = await r.json();

            if (d.needs_linkedin_auth && d.linkedin_auth_url) {
                this.toast(d.message + ' Redirecting...', 'info');
                localStorage.setItem('linkedin_return_to', `/k2yh?id=${this.postingId}`);
                setTimeout(() => window.location.href = d.linkedin_auth_url, 1200);
                return;
            }
            if (!d.success) throw new Error(d.message || 'Failed');

            this.toast('Posted to LinkedIn!', 'success');
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Posted!';
            btn.style.background = '#10b981';
            return;
        } catch (e) { this.toast(e.message, 'error'); }
        finally { btn.disabled = false; if (!btn.style.background) btn.innerHTML = orig; }
    },

    // Post the job to a LinkedIn Company Page the recruiter administers.
    // Becomes live once the LinkedIn app is approved for the Community Management
    // API; until then the org-scope consent fails at LinkedIn and we show the
    // reconnect prompt.
    async postToCompanyPage(orgId) {
        const btn = document.getElementById('btn-post-company');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<div class="btn-spinner"></div> Posting...';
        let posted = false;

        try {
            const r = await fetch(`${this.API}/api/job-posting/post-to-company-page`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recruiter_email: this.user.email,
                    posting_id: this.postingId,
                    organization_id: orgId || null,
                })
            });
            const d = await r.json();

            if (d.needs_linkedin_auth && d.linkedin_auth_url) {
                this.toast((d.message || 'Connect LinkedIn to post to your company page.') + ' Redirecting...', 'info');
                localStorage.setItem('linkedin_return_to', `/k2yh?id=${this.postingId}`);
                setTimeout(() => window.location.href = d.linkedin_auth_url, 1200);
                return;
            }
            if (d.needs_page_selection && Array.isArray(d.pages)) {
                this._showCompanyPagePicker(d.pages);
                return;
            }
            if (!d.success) throw new Error(d.message || 'Failed to post');

            posted = true;
            this.toast(d.message || 'Posted to your company page!', 'success');
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Posted to Page';
            btn.style.background = '#10b981';
        } catch (e) {
            this.toast(e.message, 'error');
        } finally {
            btn.disabled = false;
            if (!posted) btn.innerHTML = orig;
        }
    },

    // Minimal picker shown when the recruiter administers more than one page.
    _showCompanyPagePicker(pages) {
        const existing = document.getElementById('li-page-picker');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'li-page-picker';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.55);';
        const rows = pages.map(p =>
            `<button class="li-page-opt" data-id="${this._escAttr(p.id)}" style="display:block;width:100%;text-align:left;padding:12px 14px;margin:6px 0;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:14px;font-weight:600;color:#0f172a;cursor:pointer;font-family:inherit;">${this._escAttr(p.name)}</button>`
        ).join('');
        overlay.innerHTML = `
          <div role="dialog" aria-modal="true" style="background:#fff;max-width:420px;width:90%;border-radius:16px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,0.25);font-family:inherit;">
            <h3 style="margin:0 0 6px;font-size:18px;font-weight:700;color:#0f172a;">Choose a company page</h3>
            <p style="margin:0 0 14px;font-size:13px;color:#64748b;">You administer more than one page. Pick where to post this job.</p>
            ${rows}
            <button id="li-page-cancel" style="display:block;width:100%;margin-top:8px;padding:11px;border:none;background:transparent;color:#64748b;font-size:14px;cursor:pointer;font-family:inherit;">Cancel</button>
          </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#li-page-cancel').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        overlay.querySelectorAll('.li-page-opt').forEach(b => {
            b.onclick = () => { close(); this.postToCompanyPage(b.dataset.id); };
        });
    },

    _escAttr(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML.replace(/"/g, '&quot;'); },

    // ==================== Applications Drawer ====================
    async loadAppCount() {
        if (!this.postingId) return;
        try {
            const r = await fetch(`${this.API}/api/job-posting/applications/${this.postingId}`);
            const d = await r.json();
            if (d.success) document.getElementById('app-count-badge').textContent = d.applications.length;
        } catch (_) {}
    },

    async viewApplications() {
        document.getElementById('drawer-overlay').classList.remove('hidden');
        document.getElementById('drawer').classList.remove('hidden');
        if (!this.postingId) return;

        try {
            const r = await fetch(`${this.API}/api/job-posting/applications/${this.postingId}`);
            const d = await r.json();
            if (!d.success) return;

            const list = document.getElementById('apps-list');
            const noApps = document.getElementById('no-apps');

            if (d.applications.length === 0) {
                noApps.style.display = 'block';
                list.innerHTML = '';
                return;
            }
            noApps.style.display = 'none';

            list.innerHTML = d.applications.map(a => {
                const date = new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const resumeLink = a.resume_url
                    ? `<a href="${a.resume_url}" target="_blank" class="resume-link">Resume</a>`
                    : '<span class="no-resume">No resume</span>';
                return `<div class="app-card">
                    <div class="app-top">
                        <strong>${this.esc(a.candidate_name)}</strong>
                        <span class="app-date">${date}</span>
                    </div>
                    <div class="app-row">${this.esc(a.candidate_email)} &middot; ${this.esc(a.candidate_mobile)}</div>
                    <div class="app-row">Salary: ${a.salary_currency} ${this.esc(a.expected_salary)} &middot; Notice: ${this.esc(a.notice_period)}</div>
                    <div class="app-row">Relocate: ${a.willing_to_relocate ? 'Yes' : 'No'} ${a.current_location ? '&middot; From: ' + this.esc(a.current_location) : ''}</div>
                    <div class="app-row">${resumeLink}</div>
                </div>`;
            }).join('');
        } catch (e) { this.toast('Failed to load applications', 'error'); }
    },

    closeDrawer() {
        document.getElementById('drawer-overlay').classList.add('hidden');
        document.getElementById('drawer').classList.add('hidden');
    },

    // ==================== Deadline ====================
    updateDeadlineBar() {
        const bar = document.getElementById('deadline-bar');
        const deadline = this.data.application_deadline || this.data.applicationDeadline;
        if (!deadline) { bar.classList.add('hidden'); return; }

        bar.classList.remove('hidden');
        const dl = new Date(deadline);
        const now = new Date();
        const diff = dl - now;
        const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
        const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
        const isClosed = this.data.status === 'closed' || diff <= 0;
        const isExpiringSoon = !isClosed && diff > 0 && diff <= 2 * 24 * 60 * 60 * 1000;

        // Style
        bar.classList.remove('expiring-soon', 'closed');
        if (isClosed) bar.classList.add('closed');
        else if (isExpiringSoon) bar.classList.add('expiring-soon');

        // Value text
        const valEl = document.getElementById('deadline-value');
        const badgeEl = document.getElementById('deadline-badge');
        const actionsEl = document.getElementById('deadline-actions');
        const dateStr = dl.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dl.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        if (isClosed) {
            valEl.textContent = `Closed on ${dateStr}`;
            badgeEl.textContent = 'Closed';
            actionsEl.classList.add('hidden');
        } else if (isExpiringSoon) {
            valEl.textContent = hours <= 24
                ? `Expires in ${hours} hour${hours !== 1 ? 's' : ''} (${dateStr} ${timeStr})`
                : `Expires in ${days} day${days !== 1 ? 's' : ''} (${dateStr} ${timeStr})`;
            badgeEl.textContent = 'Expiring Soon';
            actionsEl.classList.remove('hidden');
        } else {
            valEl.textContent = `${days} day${days !== 1 ? 's' : ''} remaining (${dateStr} ${timeStr})`;
            badgeEl.textContent = `${days}d left`;
            actionsEl.classList.remove('hidden');
        }

        // Live countdown timer
        if (this.deadlineTimer) clearInterval(this.deadlineTimer);
        if (!isClosed) {
            this.deadlineTimer = setInterval(() => this.updateDeadlineBar(), 60000);
        }
    },

    async extendDeadline(days) {
        if (!this.postingId) return;
        if (!confirm(`Extend application deadline by ${days} days?`)) return;

        try {
            const r = await fetch(`${this.API}/api/job-posting/extend-deadline`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, extend_days: days })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || 'Failed');

            this.data.application_deadline = d.new_deadline;
            this.data.applicationDeadline = d.new_deadline;
            this.data.status = 'active';
            this.updateDeadlineBar();
            this.toast(`Deadline extended by ${days} days!`, 'success');
        } catch (e) { this.toast(e.message, 'error'); }
    },

    async closePosting() {
        if (!this.postingId) return;
        if (!confirm('Close this posting? No more applications will be accepted.')) return;

        try {
            const r = await fetch(`${this.API}/api/job-posting/close-posting`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || 'Failed');

            this.data.status = 'closed';
            this.updateDeadlineBar();
            this.toast(`Posting closed. ${d.total_applications} applications received.`, 'success');
        } catch (e) { this.toast(e.message, 'error'); }
    },

    // ==================== Helpers ====================
    esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

    toast(msg, type = 'info') {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.className = `toast ${type}`;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3500);
    },
};

document.addEventListener('DOMContentLoaded', () => JP.init());
window.JP = JP;
