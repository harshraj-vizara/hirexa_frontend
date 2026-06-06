/**
 * HIRE XA - Candidate Application Form (public)
 */
const JA = {
    postingId: null,
    posting: null,
    resumeUrl: '',
    API: window.location.origin,

    async init() {
        // Route is /a/<token>; /apply/<token> redirects to /a/<token> at the server.
        const m = window.location.pathname.match(/\/(?:a|apply)\/([A-Z0-9]+)/i);
        if (!m) { this.showError('Invalid Link', 'Check the URL and try again.'); return; }
        this.postingId = m[1];
        await this.load();
    },

    async load() {
        try {
            const r = await fetch(`${this.API}/api/job-posting/public/${this.postingId}`);
            if (r.status === 404) { this.showError('Job Not Found', 'This posting does not exist.'); return; }
            if (r.status === 410) { this.showClosed(); return; }
            const d = await r.json();
            if (!d.success) throw new Error();
            this.posting = d.posting;
            this.render(d.posting);
        } catch (_) { this.showError('Error', 'Unable to load job details.'); }
    },

    showClosed() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('closed-state').classList.remove('hidden');
    },

    render(p) {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('form-wrapper').classList.remove('hidden');
        document.title = `Apply - ${p.hiring_role} at ${p.company_name}`;
        document.getElementById('job-title').textContent = p.hiring_role;
        document.getElementById('job-company').textContent = p.company_name;
        document.getElementById('job-location').textContent = p.job_location;
        document.getElementById('relocate-loc').textContent = p.job_location || 'the job location';
        if (p.formatted_jd) {
            document.getElementById('jd-content').innerHTML = this.toHtml(this.sanitizeJd(p.formatted_jd));
        }

        const row = document.getElementById('ja-deadline-row');
        if (p.deadline_info && p.deadline_info.deadline) {
            const formatted = this.formatDate(p.deadline_info.deadline);
            if (formatted) {
                document.getElementById('job-deadline').textContent = formatted;
            } else {
                row.classList.add('hidden');
            }
        } else {
            row.classList.add('hidden');
        }
    },

    formatDate(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        } catch (_) { return ''; }
    },

    // ==================== Resume Upload ====================
    async handleResume(input) {
        const file = input.files[0];
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'doc', 'docx'].includes(ext)) { this.toast('Only PDF, DOC, DOCX allowed', 'error'); input.value = ''; return; }
        if (file.size > 5 * 1024 * 1024) { this.toast('Max file size is 5 MB', 'error'); input.value = ''; return; }

        const zone = document.getElementById('upload-zone');
        const txtEl = document.getElementById('upload-text');
        const origText = txtEl.textContent;
        txtEl.textContent = 'Uploading…';
        zone.style.pointerEvents = 'none';

        try {
            const fd = new FormData();
            fd.append('file', file);
            const r = await fetch(`${this.API}/api/job-posting/upload-resume`, { method: 'POST', body: fd });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'Upload failed');

            this.resumeUrl = d.resume_url;
            zone.classList.add('hidden');
            document.getElementById('upload-file-info').classList.remove('hidden');
            document.getElementById('upload-filename').textContent = file.name;
        } catch (e) {
            this.toast(e.message, 'error');
            txtEl.textContent = origText;
        } finally { zone.style.pointerEvents = 'auto'; }
    },

    removeResume() {
        this.resumeUrl = '';
        document.getElementById('resume-file').value = '';
        document.getElementById('upload-zone').classList.remove('hidden');
        document.getElementById('upload-file-info').classList.add('hidden');
        document.getElementById('upload-text').textContent = 'Click to choose files (max 5 MB)';
    },

    // ==================== Submit ====================
    async submit(e) {
        e.preventDefault();
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const mobile = document.getElementById('mobile').value.trim();
        const loc = document.getElementById('current-location').value.trim();
        const cur = document.getElementById('salary-currency').value;
        const salary = document.getElementById('expected-salary').value.trim();
        const notice = document.getElementById('notice-period').value;
        const reloc = document.querySelector('input[name="relocate"]:checked');

        if (!name) return this.toast('Enter your name', 'error');
        if (!email) return this.toast('Enter your email', 'error');
        if (!mobile || mobile.replace(/\D/g, '').length !== 10) return this.toast('Enter a valid 10-digit mobile number', 'error');
        if (!salary) return this.toast('Enter expected salary', 'error');
        if (!notice) return this.toast('Select notice period', 'error');
        if (!reloc) return this.toast('Select relocation preference', 'error');
        if (!this.resumeUrl) return this.toast('Please upload your resume', 'error');

        const btn = document.getElementById('btn-submit');
        btn.disabled = true;
        btn.innerHTML = '<div class="btn-spinner"></div>Submitting…';

        try {
            const r = await fetch(`${this.API}/api/job-posting/apply/${this.postingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidate_name: name, candidate_email: email,
                    candidate_mobile: mobile, expected_salary: salary,
                    salary_currency: cur, notice_period: notice,
                    willing_to_relocate: reloc.value === 'true',
                    current_location: loc, resume_url: this.resumeUrl,
                })
            });
            const d = await r.json();
            if (r.status === 409) { this.toast('You already applied for this position.', 'error'); btn.disabled = false; btn.innerHTML = 'Submit Application'; return; }
            if (!r.ok || !d.success) throw new Error(d.detail || 'Failed');

            document.getElementById('form-wrapper').classList.add('hidden');
            document.getElementById('success-state').classList.remove('hidden');
            document.getElementById('success-details').innerHTML = `
                <div><strong>Name:</strong> ${this.esc(name)}</div>
                <div><strong>Position:</strong> ${this.esc(this.posting.hiring_role)}</div>
                <div><strong>Company:</strong> ${this.esc(this.posting.company_name)}</div>`;
        } catch (e) {
            this.toast(e.message, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Submit Application';
        }
    },

    // Helpers
    showError(t, m) {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('error-state').classList.remove('hidden');
        document.getElementById('error-title').textContent = t;
        document.getElementById('error-message').textContent = m;
    },
    // Defensive: when the LLM's JSON envelope was stored verbatim in the DB,
    // strip it and decode escape sequences so the JD reads as plain text.
    // Handles three flavors of bad data: code-fence wrapped, full JSON
    // envelope, and TRUNCATED JSON envelope (no closing quote — token cap hit).
    sanitizeJd(t) {
        if (!t) return '';
        let s = String(t).trim();
        if (s.startsWith('```')) {
            s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        }
        if (s.startsWith('{') && /["']formatted_jd["']\s*:/.test(s)) {
            let extracted = null;
            try {
                const parsed = JSON.parse(s);
                if (parsed && typeof parsed.formatted_jd === 'string') extracted = parsed.formatted_jd;
            } catch (_) { /* fall through */ }
            if (extracted == null) {
                // Properly-terminated string: capture until closing ", before , or }
                let m = s.match(/["']formatted_jd["']\s*:\s*"((?:\\.|[^"\\])*)"\s*(?:,|\})/);
                if (m && m[1] != null) {
                    try { extracted = JSON.parse('"' + m[1] + '"'); }
                    catch (_) { extracted = m[1]; }
                }
            }
            if (extracted == null) {
                // Truncated string: grab from after opening " to end-of-blob.
                // Drop trailing partial escape (`\` with no following char).
                let m = s.match(/["']formatted_jd["']\s*:\s*"([\s\S]*)$/);
                if (m && m[1] != null) {
                    let raw = m[1].replace(/\\$/, '');
                    try { extracted = JSON.parse('"' + raw + '"'); }
                    catch (_) { extracted = raw; }
                }
            }
            if (extracted != null) s = extracted;
        }
        return s.replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '  ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    },
    toHtml(t) {
        if (!t) return '';
        return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>')
            .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>').replace(/^/,'<p>').replace(/$/,'</p>');
    },
    esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
    toast(m, type='info') {
        const t = document.getElementById('toast');
        t.textContent = m; t.className = `toast ${type}`; t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3500);
    },
};

document.addEventListener('DOMContentLoaded', () => JA.init());
window.JA = JA;
