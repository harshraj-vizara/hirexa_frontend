/**
 * Scoreniq - Recruitment Pipeline
 * Unified 4-step wizard: JD → LinkedIn → Search → Dashboard
 */
const PL = {
    user: null,
    step: 1,
    postingId: null,
    pipelineId: null,
    data: {},
    pollTimer: null,
    API: window.location.origin,

    // ── DEV MODE ──────────────────────────────────────────────────────────────
    // Set DEV: true to skip all API calls and navigate freely between steps.
    // Remove or set to false before deploying to production.
    DEV: true,
    _DEV_SAMPLE: {
        postingId:  'DEV-POST-0001',
        pipelineId: 'DEV-PIPE-0001',
        step2: {
            application_url: 'https://hirexa.ai/apply/DEV-POST-0001',
            linkedin_post:   'We are hiring a **Frontend Engineer** at Vizara Technologies!\n\nJoin our team in Bengaluru and help build world-class recruitment infrastructure.\n\n📍 Bengaluru, India  |  💼 2–5 yrs  |  💰 ₹8L–15L\n\nApply: https://hirexa.ai/apply/DEV-POST-0001',
            formatted_jd:    '## Frontend Engineer\n\n**Company:** Vizara Technologies Pvt Ltd\n**Location:** Bengaluru, India\n\n### About the Role\nBuild scalable, pixel-perfect web UIs for our AI-driven recruitment platform.\n\n### Responsibilities\n- Develop features in React + TypeScript\n- Collaborate with design and backend teams\n- Own performance and accessibility\n\n### Requirements\n- 2–5 years frontend experience\n- Proficient in React, JS (ES6+), CSS\n- Familiar with REST APIs and Git',
            hiring_role:     'Frontend Engineer',
            company_name:    'Vizara Technologies Pvt Ltd',
            job_location:    'Bengaluru, India',
            budget:          'INR 800000 - 1500000',
        },
    },
    // ─────────────────────────────────────────────────────────────────────────

    init() {
        const u = localStorage.getItem('fluenzoUser');
        if (!u) { window.location.href = '/'; return; }
        this.user = JSON.parse(u);

        // Character counter
        const jd = document.getElementById('f-jd');
        if (jd) jd.addEventListener('input', () => {
            document.getElementById('f-jd-count').textContent = jd.value.length;
        });

        // Close location dropdown on outside click
        document.addEventListener('click', (e) => {
            const dd = document.getElementById('loc-dropdown');
            if (dd && !e.target.closest('.pl-location-wrap')) dd.classList.add('hidden');
        });

        // Deadline custom: the input lives INSIDE the Custom chip — selecting
        // the Custom radio reveals it via CSS (:has(:checked)). We just need to
        // focus it for instant typing, and stop the label-click from re-toggling
        // the radio while the user is editing.
        document.querySelectorAll('input[name="pl-deadline"]').forEach(r => {
            r.addEventListener('change', () => {
                if (r.value === 'custom' && r.checked) {
                    const input = document.getElementById('f-custom-deadline');
                    if (input) {
                        setTimeout(() => input.focus(), 0);
                    }
                }
            });
        });
        // Prevent clicks inside the inline number field from re-firing the
        // surrounding <label> (which would toggle the radio and steal focus).
        const customInput = document.getElementById('f-custom-deadline');
        if (customInput) {
            ['click', 'mousedown'].forEach(ev =>
                customInput.addEventListener(ev, (e) => e.stopPropagation())
            );
        }

        // Budget Range: keep entries numeric and enforce Min <= Max with live
        // feedback (red border on both fields while Min exceeds Max).
        const bminEl = document.getElementById('f-bmin');
        const bmaxEl = document.getElementById('f-bmax');
        if (bminEl && bmaxEl) {
            const checkBudget = () => {
                const lo = parseInt(bminEl.value.replace(/[^\d]/g, ''), 10);
                const hi = parseInt(bmaxEl.value.replace(/[^\d]/g, ''), 10);
                const bad = !isNaN(lo) && !isNaN(hi) && lo > hi;
                bminEl.classList.toggle('pl-invalid', bad);
                bmaxEl.classList.toggle('pl-invalid', bad);
            };
            [bminEl, bmaxEl].forEach(inp => {
                inp.addEventListener('input', () => {
                    // Digits only, capped at 10 (so a single CTC value can't run
                    // to dozens of digits — also enforced via maxlength in markup).
                    inp.value = inp.value.replace(/[^\d]/g, '').slice(0, 10);
                    checkBudget();
                });
            });
        }

        // Check URL params for existing pipeline.
        // The current step is persisted in window.location.hash (#step1..4) so
        // refresh returns the user to whichever step they were on.
        const p = new URLSearchParams(window.location.search);
        const hashStep = this._readHashStep();
        if (p.get('pipeline')) {
            this.pipelineId = p.get('pipeline');
            if (p.get('posting')) this.postingId = p.get('posting');
            // Hide all steps immediately, show loader
            document.querySelectorAll('.pl-step').forEach(s => s.classList.add('hidden'));
            this._showPageLoader(true);
            this._loadPipelineStatus().then(() => {
                this._showPageLoader(false);
                this._navigateToStep(hashStep || 4);
            }).catch(() => {
                this._showPageLoader(false);
                this._navigateToStep(hashStep || 4);
            });
        } else if (p.get('posting')) {
            this.postingId = p.get('posting');
            // Returning from a LinkedIn connect. We do NOT auto-post (that caused
            // the redirect loop) — the button just flips to the green "Post Now"
            // stage and the recruiter clicks once to publish.
            const justConnected = p.get('li_connect') === '1';
            const autoCompany = p.get('li_company') === '1';
            if (justConnected || autoCompany) {
                history.replaceState(null, '', `/c8qr?posting=${this.postingId}`);
            }
            document.querySelectorAll('.pl-step').forEach(s => s.classList.add('hidden'));
            this._showPageLoader(true);
            this._loadPostingDetail().then(() => {
                this._showPageLoader(false);
                this._navigateToStep(hashStep || 2);
                if (justConnected) {
                    setTimeout(() => {
                        this._checkLinkedIn();
                        this.toast('LinkedIn connected. Click "Post Now" to publish.', 'success');
                    }, 400);
                } else if (autoCompany) {
                    setTimeout(() => this.postToCompanyPage(null, true), 300);
                }
            }).catch(() => {
                this._showPageLoader(false);
                this._navigateToStep(hashStep || 2);
            });
        } else {
            // Brand-new posting: prefill Company Name from the organisation
            // profile (the source of truth) so it isn't retyped every time.
            this._prefillCompanyName();
        }

        if (this.DEV) this._devInit();
    },

    // Prefill the Company Name field with the org's registered name. Only fills
    // when the field is empty, so it never overwrites a value the user typed or
    // one loaded from an existing posting.
    _prefillCompanyName() {
        const el = document.getElementById('f-company');
        if (!el || el.value.trim()) return;
        let email = '';
        try { email = (JSON.parse(localStorage.getItem('fluenzoUser') || '{}').email) || ''; } catch (_) {}
        if (!email) return;
        fetch(`${this.API}/api/company/profile?email=${encodeURIComponent(email)}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (d && d.has_org && d.name && !el.value.trim()) {
                    el.value = d.name;
                    if (window.HXAValidate) window.HXAValidate.check(el, false);
                }
            })
            .catch(() => {});
    },

    // ── DEV helpers ───────────────────────────────────────────────────────────
    _devInit() {
        this.postingId  = this._DEV_SAMPLE.postingId;
        this.pipelineId = this._DEV_SAMPLE.pipelineId;
        this.data = { ...this._DEV_SAMPLE.step2 };

        // Pre-populate step 2 content so it renders immediately on first visit
        this._showStep2Content(this._DEV_SAMPLE.step2);

        // Floating step-picker bar (bottom-left, above any fixed action button)
        const bar = document.createElement('div');
        bar.id = 'dev-step-bar';
        bar.style.cssText = [
            'position:fixed', 'bottom:38px', 'left:150px', 'z-index:9999',
            'display:flex', 'align-items:center', 'gap:6px',
            'background:#24282b', 'border-radius:8px',
            'padding:5px 10px', 'box-shadow:0 2px 8px rgba(0,0,0,.35)',
            'font-family:monospace', 'font-size:11px',
        ].join(';');

        const btnStyle = [
            'background:#3a3f44', 'color:#e0e4e8', 'border:none',
            'border-radius:5px', 'padding:3px 9px', 'cursor:pointer',
            'font-family:monospace', 'font-size:11px',
        ].join(';');

        bar.innerHTML = `
            <span style="color:#eab000;letter-spacing:.06em;margin-right:2px">DEV</span>
            <button style="${btnStyle}" onclick="PL._devGoto(1)">Step 1</button>
            <button style="${btnStyle}" onclick="PL._devGoto(2)">Step 2</button>
            <button style="${btnStyle}" onclick="PL._devGoto(3)">Step 3</button>
            <button style="${btnStyle}" onclick="PL._devGoto(4)">Step 4</button>
        `;
        document.body.appendChild(bar);

        // Keyboard: Alt+1 … Alt+4
        document.addEventListener('keydown', e => {
            if (e.altKey && e.key >= '1' && e.key <= '4') {
                e.preventDefault();
                PL._devGoto(parseInt(e.key));
            }
        });
    },

    _devGoto(n) {
        this._navigateToStep(n);
        if (n === 2) {
            // Step 2 hides its content behind a loader by default; show it immediately
            setTimeout(() => this._showStep2Content(this._DEV_SAMPLE.step2), 30);
        }
        if (n === 4) {
            // Mark search as already started so _setupStep4 skips the auto-kick
            this.searchStarted = true;
        }
        // Highlight the active button in the bar
        const bar = document.getElementById('dev-step-bar');
        if (bar) bar.querySelectorAll('button').forEach((b, i) => {
            b.style.background = (i + 1 === n) ? '#4cabf6' : '#3a3f44';
            b.style.color      = (i + 1 === n) ? '#fff'    : '#e0e4e8';
        });
    },
    // ─────────────────────────────────────────────────────────────────────────

    _readHashStep() {
        const m = (window.location.hash || '').match(/step(\d+)/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return (n >= 1 && n <= 4) ? n : null;
    },

    // Custom-deadline spinner — increment/decrement #f-custom-deadline by ±1
    // clamped to [1, 90]. Wired to the up/down arrows inside .pl-chip-custom.
    bumpDeadline(delta) {
        const input = document.getElementById('f-custom-deadline');
        if (!input) return;
        const current = parseInt(input.value, 10);
        let next = isNaN(current) ? (delta > 0 ? 1 : 1) : current + delta;
        next = Math.max(1, Math.min(90, next));
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    },

    // ==================== Navigation ====================
    goToStep(n) {
        if (n > 1 && !this.postingId && !this.pipelineId) {
            return this.toast('Complete step 1 first', 'error');
        }
        this._navigateToStep(n);
    },

    _navigateToStep(n) {
        this.step = n;
        document.querySelectorAll('.pl-step').forEach(s => s.classList.add('hidden'));
        document.getElementById(`step-${n}`).classList.remove('hidden');

        // Update sidebar
        document.querySelectorAll('.pl-nav-item').forEach(item => {
            const s = parseInt(item.dataset.step);
            item.classList.remove('active', 'completed');
            if (s < n) item.classList.add('completed');
            else if (s === n) item.classList.add('active');
        });

        // Clean up polling when leaving Step 4 (Find Candidates is the polling step now)
        if (n !== 4 && this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Step-specific setup
        if (n === 3) this._setupStep3();   // Pick Interviewers
        if (n === 4) this._setupStep4();   // Find Candidates (was _setupStep3)

        // Persist current step in URL hash so a page refresh returns here
        try {
            const url = new URL(window.location.href);
            url.hash = `step${n}`;
            history.replaceState(null, '', url.toString());
        } catch (_) {}

        window.scrollTo(0, 0);
    },

    goBack() { window.location.href = '/b4kx'; },

    // Sidebar Back icon — step-aware. On Step 2/3/4 it walks the user back one
    // step (preserves the in-progress pipeline). On Step 1 there's no previous
    // step, so it falls through to the dashboard.
    sidebarBack(e) {
        if (e) e.preventDefault();
        if (this.step > 1) {
            this.goToStep(this.step - 1);
        } else {
            window.location.href = '/b4kx';
        }
    },

    // ==================== Step 1: Job Details ====================
    async submitStep1() {
        if (this.DEV) { this._devGoto(2); return; }
        const role = document.getElementById('f-role').value.trim();
        const company = document.getElementById('f-company').value.trim();
        const jd = document.getElementById('f-jd').value.trim();
        const loc = document.getElementById('f-location').value.trim();
        const joining = document.getElementById('f-joining').value;
        const grade = document.getElementById('f-grade').value;
        const cur = document.getElementById('f-currency').value;
        const bmin = document.getElementById('f-bmin').value.trim();
        const bmax = document.getElementById('f-bmax').value.trim();

        if (!role) return this.toast('Enter the job title', 'error');
        if (!company) return this.toast('Enter the company name', 'error');
        if (!jd) return this.toast('Paste the job description', 'error');
        if (!loc) return this.toast('Enter the job location', 'error');
        // Format validation on the typed fields (job title / company).
        if (window.HXAValidate) {
            for (const id of ['f-role', 'f-company']) {
                if (!window.HXAValidate.check(document.getElementById(id), true)) {
                    document.getElementById(id).focus();
                    return this.toast('Please fix the highlighted fields', 'error');
                }
            }
        }
        if (!joining) return this.toast('Select joining timeline', 'error');
        if (!grade) return this.toast('Select the role level', 'error');
        if (!bmin || !bmax) return this.toast('Enter budget range', 'error');
        // Budget sanity: Min must not exceed Max (and Max not be below Min).
        const bminNum = parseInt(String(bmin).replace(/[^\d]/g, ''), 10);
        const bmaxNum = parseInt(String(bmax).replace(/[^\d]/g, ''), 10);
        if (isNaN(bminNum) || isNaN(bmaxNum)) return this.toast('Enter a valid budget range', 'error');
        if (bminNum > bmaxNum) {
            document.getElementById('f-bmin')?.classList.add('pl-invalid');
            document.getElementById('f-bmax')?.classList.add('pl-invalid');
            return this.toast('Minimum CTC cannot be more than the maximum', 'error');
        }

        // Get deadline days
        const dlRadio = document.querySelector('input[name="pl-deadline"]:checked');
        let deadlineDays = 10;
        if (dlRadio) {
            if (dlRadio.value === 'custom') {
                const cv = parseInt(document.getElementById('f-custom-deadline').value);
                if (!cv || cv < 1 || cv > 90) return this.toast('Enter custom deadline between 1-90 days', 'error');
                deadlineDays = cv;
            } else {
                deadlineDays = parseInt(dlRadio.value);
            }
        }

        const btn = document.getElementById('btn-step1');
        btn.disabled = true;
        btn.innerHTML = '<div class="pl-btn-spinner"></div> Creating posting...';

        // Show step 2 with loader immediately
        this._navigateToStep(2);
        document.getElementById('step2-loader').classList.remove('hidden');
        document.getElementById('step2-content').classList.add('hidden');

        try {
            // 1. Create job posting. If the wizard already created a pipeline
            // (user re-entered step 1), pass pipeline_id so the new posting is
            // immediately back-linked. Without this, the new posting was an
            // orphan and apply submissions never reached the candidate list.
            const r = await fetch(`${this.API}/api/job-posting/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recruiter_email: this.user.email,
                    raw_jd: jd, hiring_role: role, company_name: company,
                    job_location: loc, joining_duration: joining,
                    budget_min: bmin, budget_max: bmax, budget_currency: cur,
                    deadline_days: deadlineDays,
                    pipeline_id: this.pipelineId || null,
                })
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'Failed to create posting');

            this.postingId = d.posting_id;
            this.data = { ...d, raw_jd: jd, grade: grade, status: 'active' };

            // 2. Create pipeline immediately (linked to posting)
            await this._createPipeline();

            history.replaceState(null, '', `/c8qr?pipeline=${this.pipelineId || ''}&posting=${d.posting_id}`);
            this._showStep2Content(d);
            this.toast('Job posting created!', 'success');

        } catch (e) {
            this.toast(e.message, 'error');
            this._navigateToStep(1);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Continue <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
        }
    },

    // ==================== Step 2: LinkedIn Post ====================
    _showStep2Content(d) {
        document.getElementById('step2-loader').classList.add('hidden');
        document.getElementById('step2-content').classList.remove('hidden');

        const urlEl = document.getElementById('app-url');
        urlEl.href = d.application_url;
        urlEl.textContent = d.application_url;

        document.getElementById('li-display').innerHTML = this._toHtml(d.linkedin_post);
        document.getElementById('li-edit').value = d.linkedin_post;
        document.getElementById('jd-display').innerHTML = this._toHtml(d.formatted_jd);
        document.getElementById('jd-edit').value = d.formatted_jd;

        // Show job info summary
        const info = document.getElementById('step2-info');
        if (info) {
            info.innerHTML = `<strong>${this._esc(this._upper(d.hiring_role))}</strong> at <strong>${this._esc(d.company_name)}</strong> &middot; ${this._esc(d.job_location)} &middot; ${this._esc(d.budget)}`;
        }

        this._checkLinkedIn();
        this._updateDeadlineBar();
        this._loadReferrals();
    },

    async _loadPostingDetail() {
        try {
            const r = await fetch(`${this.API}/api/job-posting/detail/${this.postingId}`);
            const d = await r.json();
            if (!d.success) throw new Error();
            const p = d.posting;
            this.data = {
                ...this.data,
                posting_id: p.posting_id, application_url: p.application_url,
                formatted_jd: p.formatted_jd, linkedin_post: p.linkedin_post_text,
                hiring_role: p.hiring_role, company_name: p.company_name,
                job_location: p.job_location, raw_jd: p.raw_jd,
                budget: `${p.budget_currency} ${p.budget_min} - ${p.budget_max}`,
                budget_min: p.budget_min, budget_max: p.budget_max, budget_currency: p.budget_currency,
                joining_duration: p.joining_duration,
                application_deadline: p.application_deadline,
                status: p.status,
            };

            // Populate Step 1 form fields
            const el = id => document.getElementById(id);
            if (el('f-role')) el('f-role').value = p.hiring_role || '';
            if (el('f-company')) el('f-company').value = p.company_name || '';
            if (el('f-jd')) {
                el('f-jd').value = p.raw_jd || '';
                if (el('f-jd-count')) el('f-jd-count').textContent = (p.raw_jd || '').length;
            }
            if (el('f-location')) el('f-location').value = p.job_location || '';
            if (el('f-joining') && p.joining_duration) el('f-joining').value = p.joining_duration;
            // Role level lives on the pipeline config; restore it if we have it this session.
            if (el('f-grade') && this.data.grade) el('f-grade').value = this.data.grade;
            if (el('f-currency') && p.budget_currency) el('f-currency').value = p.budget_currency;
            if (el('f-bmin') && p.budget_min) el('f-bmin').value = p.budget_min;
            if (el('f-bmax') && p.budget_max) el('f-bmax').value = p.budget_max;

            this._showStep2Content(this.data);
        } catch (_) {}
    },

    toggleEdit() {
        const d = document.getElementById('li-display');
        const e = document.getElementById('li-edit');
        const b = document.getElementById('li-edit-bar');
        if (e.classList.contains('hidden')) {
            e.value = this.data.linkedin_post;
            d.classList.add('hidden'); e.classList.remove('hidden'); b.classList.remove('hidden');
            e.focus();
        } else { this.cancelEdit(); }
    },

    async saveEdit() {
        const t = document.getElementById('li-edit').value.trim();
        if (!t) return;
        try {
            await fetch(`${this.API}/api/job-posting/update-template`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, linkedin_post_text: t })
            });
            this.data.linkedin_post = t;
            document.getElementById('li-display').innerHTML = this._toHtml(t);
            this.cancelEdit();
            this.toast('Saved!', 'success');
        } catch (_) { this.toast('Save failed', 'error'); }
    },

    cancelEdit() {
        document.getElementById('li-display').classList.remove('hidden');
        document.getElementById('li-edit').classList.add('hidden');
        document.getElementById('li-edit-bar').classList.add('hidden');
    },

    // ---------- Job Description: manual edit (mirrors the LinkedIn Post card) ----------
    toggleEditJd() {
        const d = document.getElementById('jd-display');
        const e = document.getElementById('jd-edit');
        const b = document.getElementById('jd-edit-bar');
        if (e.classList.contains('hidden')) {
            e.value = this.data.formatted_jd;
            d.classList.add('hidden'); e.classList.remove('hidden'); b.classList.remove('hidden');
            e.focus();
        } else { this.cancelEditJd(); }
    },

    async saveEditJd() {
        const t = document.getElementById('jd-edit').value.trim();
        if (!t) return;
        try {
            await fetch(`${this.API}/api/job-posting/update-template`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, formatted_jd: t })
            });
            this.data.formatted_jd = t;
            document.getElementById('jd-display').innerHTML = this._toHtml(t);
            this.cancelEditJd();
            this.toast('Saved!', 'success');
        } catch (_) { this.toast('Save failed', 'error'); }
    },

    cancelEditJd() {
        document.getElementById('jd-display').classList.remove('hidden');
        document.getElementById('jd-edit').classList.add('hidden');
        document.getElementById('jd-edit-bar').classList.add('hidden');
    },

    // ---------- Job Description: AI refine (mirrors the LinkedIn Post card) ----------
    async refineJd() {
        const inp = document.getElementById('jd-refine-input');
        const cmd = inp.value.trim();
        if (!cmd) return;
        const btn = document.getElementById('btn-jd-refine');
        const cardBody = document.getElementById('jd-card-body');
        const loader = document.getElementById('jd-refine-loader');
        btn.disabled = true; inp.disabled = true;
        if (cardBody) cardBody.classList.add('refining');
        if (loader) loader.classList.add('active');
        try {
            const r = await fetch(`${this.API}/api/job-posting/refine`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, command: cmd, current_text: this.data.formatted_jd, field: 'formatted_jd' })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.detail || 'Failed');
            this.data.formatted_jd = d.refined_text;
            document.getElementById('jd-display').innerHTML = this._toHtml(d.refined_text);
            document.getElementById('jd-edit').value = d.refined_text;
            inp.value = '';
            this.toast('Job description updated!', 'success');
        } catch (e) { this.toast(e.message, 'error'); }
        finally {
            btn.disabled = false; inp.disabled = false;
            if (cardBody) cardBody.classList.remove('refining');
            if (loader) loader.classList.remove('active');
        }
    },

    async refine() {
        const inp = document.getElementById('refine-input');
        const cmd = inp.value.trim();
        if (!cmd) return;
        const btn = document.getElementById('btn-refine');
        const cardBody = document.getElementById('li-card-body');
        const loader = document.getElementById('li-refine-loader');
        btn.disabled = true; inp.disabled = true;
        if (cardBody) cardBody.classList.add('refining');
        if (loader) loader.classList.add('active');
        try {
            const r = await fetch(`${this.API}/api/job-posting/refine`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, command: cmd, current_text: this.data.linkedin_post, field: 'linkedin_post' })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.detail || 'Failed');
            this.data.linkedin_post = d.refined_text;
            document.getElementById('li-display').innerHTML = this._toHtml(d.refined_text);
            document.getElementById('li-edit').value = d.refined_text;
            inp.value = '';
            this.toast('Template updated!', 'success');
        } catch (e) { this.toast(e.message, 'error'); }
        finally {
            btn.disabled = false; inp.disabled = false;
            if (cardBody) cardBody.classList.remove('refining');
            if (loader) loader.classList.remove('active');
        }
    },

    // LinkedIn connect/post is a TWO-STAGE button:
    //   stage 1 (not connected) → blue  "Connect LinkedIn to Post"
    //   stage 2 (connected)     → green "LinkedIn Connected · Post Now"
    // Splitting connect from post (no auto-post) is also what removes the old
    // connect↔callback redirect loop.
    _liConnected: false,

    _setLiButtonState(state) {
        const btn = document.getElementById('btn-li-post');
        if (!btn) return;
        const LI = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>';
        const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
        const SPIN = '<div class="pl-btn-spinner"></div> ';
        btn.classList.remove('pl-li-ready', 'pl-li-done');
        btn.disabled = false;
        if (state === 'connect') {
            btn.innerHTML = LI + '<span>Connect LinkedIn to Post</span>';
        } else if (state === 'connecting') {
            btn.disabled = true;
            btn.innerHTML = SPIN + '<span>Connecting…</span>';
        } else if (state === 'ready') {
            btn.classList.add('pl-li-ready');
            btn.innerHTML = LI + '<span>LinkedIn Connected · Post Now</span>';
        } else if (state === 'posting') {
            btn.disabled = true;
            btn.innerHTML = SPIN + '<span>Posting…</span>';
        } else if (state === 'posted') {
            btn.classList.add('pl-li-done');
            btn.disabled = true;
            btn.innerHTML = CHECK + '<span>Posted to LinkedIn</span>';
        }
    },

    async _checkLinkedIn() {
        try {
            const r = await fetch(`${this.API}/api/job-posting/linkedin-status?recruiter_email=${encodeURIComponent(this.user.email)}`);
            const d = await r.json();
            this._liConnected = !!d.connected;
        } catch (_) { this._liConnected = false; }
        // Don't downgrade a freshly "Posted" button back to a stage label.
        const btn = document.getElementById('btn-li-post');
        if (btn && btn.classList.contains('pl-li-done')) return;
        this._setLiButtonState(this._liConnected ? 'ready' : 'connect');
    },

    async postLinkedIn() {
        // STAGE 1 — not connected: connect ONLY, then come back. No auto-post, so
        // there is no connect↔callback redirect loop. After returning, the button
        // flips to the green "Post Now" state and the recruiter clicks once more.
        if (!this._liConnected) {
            this._setLiButtonState('connecting');
            try {
                const r = await fetch(`${this.API}/api/job-posting/post-to-linkedin`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recruiter_email: this.user.email, posting_id: this.postingId })
                });
                const d = await r.json();
                if (d.needs_linkedin_auth && d.linkedin_auth_url) {
                    this.toast('Taking you to LinkedIn to connect…', 'info');
                    localStorage.setItem('linkedin_return_to', `/c8qr?posting=${this.postingId}&li_connect=1`);
                    setTimeout(() => window.location.href = d.linkedin_auth_url, 800);
                    return;
                }
                if (d.success) {   // already connected on the backend → it posted
                    this._liConnected = true;
                    this._setLiButtonState('posted');
                    this.toast('Posted to LinkedIn!', 'success');
                    return;
                }
                throw new Error(d.message || 'Could not connect to LinkedIn');
            } catch (e) {
                this.toast(e.message, 'error');
                this._setLiButtonState('connect');
            }
            return;
        }

        // STAGE 2 — connected: publish.
        this._setLiButtonState('posting');
        try {
            const r = await fetch(`${this.API}/api/job-posting/post-to-linkedin`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recruiter_email: this.user.email, posting_id: this.postingId })
            });
            const d = await r.json();
            if (d.needs_linkedin_auth) {
                // Token went stale — drop back to the connect stage. Do NOT
                // auto-redirect (that's what looped before); let the recruiter click.
                this._liConnected = false;
                this._setLiButtonState('connect');
                this.toast(d.message || 'LinkedIn needs reconnecting — click Connect.', 'error');
                return;
            }
            if (!d.success) throw new Error(d.message || 'Failed to post');
            this._setLiButtonState('posted');
            this.toast('Posted to LinkedIn!', 'success');
        } catch (e) {
            this.toast(e.message, 'error');
            this._setLiButtonState('ready');
        }
    },

    // Post the job to a LinkedIn Company Page the recruiter administers.
    // Activates once the LinkedIn app is approved for the Community Management API
    // (w_organization_social); until then the org-scope consent fails at LinkedIn
    // and we show the reconnect prompt. Personal "Connect LinkedIn & Post" is
    // unaffected.
    async postToCompanyPage(orgId, autoAfterConnect = false) {
        const btn = document.getElementById('btn-li-company');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<div class="pl-btn-spinner"></div> Posting...';
        let posted = false;
        try {
            const r = await fetch(`${this.API}/api/job-posting/post-to-company-page`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recruiter_email: this.user.email,
                    posting_id: this.postingId,
                    organization_id: orgId || null,
                })
            });
            const d = await r.json();

            if (d.needs_linkedin_auth && d.linkedin_auth_url) {
                // Just returned from connecting and it still needs auth → stop, don't
                // re-redirect (prevents the connect↔callback loop).
                if (autoAfterConnect) {
                    this.toast(d.message || 'LinkedIn connected, but the post could not be published. Please try again.', 'error');
                    btn.innerHTML = orig;
                    return;
                }
                this.toast((d.message || 'Connect LinkedIn to post to your company page.') + ' Redirecting...', 'info');
                localStorage.setItem('linkedin_return_to', `/c8qr?posting=${this.postingId}&li_company=1`);
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
            btn.style.background = '#059669';
        } catch (e) { this.toast(e.message, 'error'); }
        finally { btn.disabled = false; if (!posted) btn.innerHTML = orig; }
    },

    // Picker shown when the recruiter administers more than one page.
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

    copy(what) {
        let text;
        if (what === 'url') text = this.data.application_url;
        else if (what === 'jd') text = this.data.formatted_jd;
        else text = this.data.linkedin_post;
        if (text) navigator.clipboard.writeText(text).then(() => this.toast('Copied!', 'success'));
    },

    // ==================== Pipeline Creation ====================
    async _createPipeline() {
        if (this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/create`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recruiter_email: this.user.email,
                    posting_id: this.postingId,
                    hiring_role: this.data.hiring_role || '',
                    company_name: this.data.company_name || '',
                    job_location: this.data.job_location || '',
                    job_description: this.data.raw_jd || this.data.formatted_jd || '',
                    config: { grade: this.data.grade || '' },
                })
            });
            const d = await r.json();
            if (d.success) {
                this.pipelineId = d.pipeline_id;
                console.log(`[Pipeline] Created: ${d.pipeline_id}`);
            }
        } catch (e) { console.error('Pipeline create error:', e); }
    },

    // ==================== Step 3: Candidate Search ====================
    searchStarted: false,
    candView: 'grid',
    _searchPollCount: 0,
    _lastCandCount: -1,

    // Pick Interviewers (Step 3) — initialised by inline script's PickInterviewers module.
    // Per recruiter request, we fire a fresh /suggest-interviewers call on EVERY
    // Step 3 visit (no caching) so JD edits between visits get reflected.
    async _setupStep3() {
        if (this.DEV) return; // skip API suggestions in dev
        const PI = window.PickInterviewers;
        if (PI && typeof PI.refresh === 'function') PI.refresh();
        if (!PI || typeof PI.setAIPanel !== 'function') return;

        // Need a pipeline id to ask the backend for AI suggestions. If we don't
        // have one yet (recruiter is still drafting Step 1/2), create one now —
        // same lazy-create pattern Step 4 uses.
        if (!this.pipelineId) {
            try { await this._createPipeline(); } catch (_) {}
        }
        if (!this.pipelineId) {
            // No pipeline → fallback panel only, no LLM call
            return;
        }

        PI.setLoading(true);
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/suggest-interviewers`);
            const d = await r.json();
            if (!d || !d.success) throw new Error('suggest failed');
            PI.setAIPanel(d.main_agents || [], d.core_values || [], {
                hiring_level: d.hiring_level,
                difficulty: d.difficulty,
                duration: d.duration,
                rationale: d.rationale,
            });
            if (d.from_fallback) {
                this.toast('AI is busy — showing a balanced default panel', 'info');
            }
        } catch (e) {
            console.warn('[Step3] suggest-interviewers failed', e);
            this.toast('Could not load AI panel suggestion. You can pick interviewers manually.', 'error');
        } finally {
            PI.setLoading(false);
        }
    },

    // Save the recruiter's final Step 3 panel before moving to Step 4.
    // Locks the panel for ALL candidates in this pipeline.
    async submitStep3() {
        const PI = window.PickInterviewers;
        if (!PI || typeof PI.getSelectedSplit !== 'function') {
            return this.goToStep(4);
        }
        const { main_agents, core_values } = PI.getSelectedSplit();
        if (!main_agents || main_agents.length === 0) {
            return this.toast('Select at least one main interview agent', 'error');
        }
        if (!this.pipelineId) {
            try { await this._createPipeline(); } catch (_) {}
        }
        if (!this.pipelineId) {
            return this.toast('Pipeline not ready yet — please go back to Step 1', 'error');
        }

        const meta = (typeof PI.getMeta === 'function') ? PI.getMeta() : {};
        const btn = document.getElementById('pi-continue-btn');
        if (btn) btn.disabled = true;
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/interviewers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    main_agents,
                    core_values,
                    difficulty: meta.difficulty || null,
                    duration: meta.duration || null,
                    hiring_level: meta.hiring_level || null,
                }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'save failed');
            this.goToStep(4);
        } catch (e) {
            console.warn('[Step3] save panel failed', e);
            this.toast('Could not save your interview panel. Please try again.', 'error');
            if (btn) btn.disabled = false;
        }
    },

    // ==================== Step 4 — Find Candidates (HIRE XA redesign) ====================
    // State for the new card grid + filters
    fc: {
        all: [],            // Full candidate list (last fetch)
        filter: 'all',      // Active filter id ('all' | 'top90' | `loc:<city>` | 'github')
        autoStarted: false, // Have we kicked off the LinkedIn search this session?
    },

    async _setupStep4() {
        if (this.DEV) { this._showFCEmpty(); return; } // skip API search in dev
        if (!this.pipelineId) await this._createPipeline();
        if (!this.pipelineId) return;

        this._searchPollCount = 0;
        this._lastCandCount = -1;

        // Check current pipeline state
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/progress`);
            const d = await r.json();
            if (d.success && d.current_step !== 'created') {
                // Search already kicked off (or finished) — pull the candidates
                this.searchStarted = true;
                await this._loadFCCandidates();
                if (d.current_step === 'searching') this._startSearchPoll();
                return;
            }
        } catch (_) {}

        // First visit → fire LinkedIn search and start polling
        if (!this.searchStarted) {
            this._showFCLoader(true, 'Sourcing candidates from LinkedIn…');
            this._autoStartSearch();
        }
    },

    // Show / hide the inline loader strip above the grid
    _showFCLoader(isLoading, label) {
        const loader = document.getElementById('fc-loader');
        const empty = document.getElementById('fc-empty');
        if (loader) {
            loader.classList.toggle('hidden', !isLoading);
            if (isLoading && label) {
                const lbl = document.getElementById('fc-loader-label');
                if (lbl) lbl.textContent = label;
            }
        }
        if (isLoading && empty) empty.classList.add('hidden');
    },

    _showFCEmpty() {
        this._showFCLoader(false);
        const empty = document.getElementById('fc-empty');
        if (empty) empty.classList.remove('hidden');
        const grid = document.getElementById('fc-grid');
        if (grid) grid.innerHTML = '';
        this._updateFCTitle(0);
        this._renderFCPills([]);
    },

    async _autoStartSearch() {
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/start-search`, { method: 'POST' });
            const d = await r.json();
            if (!d.success) throw new Error(d.detail || 'Search failed');
            this.searchStarted = true;
            this._startSearchPoll();
        } catch (e) {
            // If search already started (e.g., duplicate call), still poll
            this.searchStarted = true;
            this._startSearchPoll();
        }
    },

    async retrySearch() {
        this._searchPollCount = 0;
        this._lastCandCount = -1;
        this._showFCLoader(true, 'Searching again — re-querying LinkedIn with the latest JD…');
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/start-search`, { method: 'POST' });
            this._startSearchPoll();
        } catch (_) {
            this._startSearchPoll();
        }
    },

    _startSearchPoll() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this._searchPollCount = 0;
        this._pollSearchProgress();
        this.pollTimer = setInterval(() => this._pollSearchProgress(), 5000);
    },

    async _pollSearchProgress() {
        if (!this.pipelineId) return;
        this._searchPollCount++;

        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/progress`);
            const d = await r.json();
            if (!d.success) return;

            const c = d.counts;
            const total = c.total || 0;
            const countChanged = total !== this._lastCandCount;
            this._lastCandCount = total;

            // New candidates → re-fetch + render
            if (total > 0 && countChanged) {
                await this._loadFCCandidates();
            }

            // While loader is up and we have data, switch label so user sees activity
            const loader = document.getElementById('fc-loader');
            if (loader && !loader.classList.contains('hidden') && total > 0) {
                this._showFCLoader(true, `Found ${total} candidate${total === 1 ? '' : 's'} so far — enriching profiles…`);
            }

            // After ~40s (8 × 5s polls) — first cycle is done
            if (this._searchPollCount >= 8) {
                if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
                if (total > 0) {
                    this._showFCLoader(false);
                    await this._loadFCCandidates();
                    // Slow background refresh — picks up scoring updates
                    this.pollTimer = setInterval(() => this._slowPoll(), 30000);
                } else {
                    this._showFCEmpty();
                }
                return;
            }

            // Search wrapped up early with results → finalize
            if (d.current_step !== 'searching' && d.current_step !== 'created' && total > 0) {
                if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
                this._showFCLoader(false);
                await this._loadFCCandidates();
            }
        } catch (_) {}
    },

    async _slowPoll() {
        if (!this.pipelineId || this.step !== 4) {
            if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
            return;
        }
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/progress`);
            const d = await r.json();
            if (d.success && (d.counts.total || 0) !== this._lastCandCount) {
                this._lastCandCount = d.counts.total || 0;
                await this._loadFCCandidates();
            }
        } catch (_) {}
    },

    // Pull candidates and render the new Figma-style cards.
    async _loadFCCandidates() {
        if (!this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/candidates?limit=100`);
            const d = await r.json();
            if (!d.success) return;
            this.fc.all = d.candidates || [];
            if (this.fc.all.length === 0) {
                this._showFCEmpty();
                return;
            }
            const empty = document.getElementById('fc-empty');
            if (empty) empty.classList.add('hidden');
            this._showFCLoader(false);
            this._renderFCPills(this.fc.all);
            this._renderFCGrid();
            this._updateFCTitle(this.fc.all.length);
        } catch (_) {}
    },

    _updateFCTitle(n) {
        const el = document.getElementById('fc-count-text');
        if (el) el.textContent = `${n} candidate${n === 1 ? '' : 's'}`;
    },

    // Build dynamic filter pills from live data (Figma row).
    // Always: All. Then: Above 90% (if any candidates scored). Then: top-1 location pill.
    // (Keeping the row tight — Figma shows ~5 chips; we render only those with non-zero counts.)
    _renderFCPills(candidates) {
        const wrap = document.getElementById('fc-pills');
        if (!wrap) return;

        const above90 = candidates.filter(c => (c.resume_score || 0) >= 90).length;
        const locCounts = {};
        candidates.forEach(c => {
            const city = (c.location || '').split(',')[0].trim();
            if (city) locCounts[city] = (locCounts[city] || 0) + 1;
        });
        const topLocs = Object.entries(locCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .filter(([, n]) => n > 0);

        const pills = [
            { id: 'all', label: 'All', count: candidates.length, kind: 'active' },
        ];
        if (above90 > 0) pills.push({ id: 'top90', label: 'Above 90%', count: above90 });
        topLocs.forEach(([city, n]) => pills.push({ id: 'loc:' + city, label: city, count: n }));

        const isActive = (id) => id === this.fc.filter;
        wrap.innerHTML = pills.map(p => `
            <button class="pl-fc-pill ${isActive(p.id) ? 'active' : ''}" data-fcid="${this._esc(p.id)}">
                ${this._esc(p.label)} (${p.count})
            </button>
        `).join('');

        wrap.querySelectorAll('.pl-fc-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.fc.filter = btn.dataset.fcid;
                wrap.querySelectorAll('.pl-fc-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._renderFCGrid();
            });
        });
    },

    // Apply current filter and render the grid of candidate cards.
    _renderFCGrid() {
        const grid = document.getElementById('fc-grid');
        if (!grid) return;

        const all = this.fc.all || [];
        const filt = this.fc.filter;
        let list = all;
        if (filt === 'top90') {
            list = all.filter(c => (c.resume_score || 0) >= 90);
        } else if (filt && filt.indexOf('loc:') === 0) {
            const city = filt.slice(4).toLowerCase();
            list = all.filter(c => ((c.location || '').split(',')[0].trim().toLowerCase()) === city);
        }

        if (!list.length) {
            grid.innerHTML = '<div class="pl-fc-no-match">No candidates match this filter.</div>';
            return;
        }

        // 6 gradient classes mirror Step 3 — gives each card a stable color tied to index
        const grads = ['coral', 'yellow', 'purple', 'blue', 'green', 'dark'];
        // Card-text color for the initials, matched to each gradient
        const initialColor = {
            coral:  '#FFE6E6',
            yellow: '#FFEEAD',
            purple: '#F4F2FF',
            blue:   '#CEEAFF',
            green:  '#E2FFD7',
            dark:   '#EAB000',
        };

        grid.innerHTML = list.map((c, i) => {
            const initials = this._getInitials(c.name);
            const grad = grads[i % grads.length];
            const initCol = initialColor[grad];
            // Only show a role line when there's a real headline — the green
            // "Open to work" tag below already covers the open-to-work state.
            const roleHtml = c.current_title
                ? `<div class="pl-fc-role">${this._esc(c.current_title)}</div>`
                : '';

            const locHtml = c.location
                ? `<div class="pl-fc-cloc">
                       <svg width="10" height="10" viewBox="0 0 24 24" fill="#E85454"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
                       <span>${this._esc(c.location)}</span>
                   </div>`
                : '';

            // Whole card is the action: copy the shortlist message + open the
            // candidate's LinkedIn so the recruiter can paste (Ctrl+V) and send.
            return `<div class="pl-fc-card pl-fc-clickable" data-cand-id="${c.id}" title="Message this candidate on LinkedIn">
                <div class="pl-fc-card-head">
                    <div class="pl-fc-avatar pl-grad-${grad}" style="color:${initCol}">${initials}</div>
                    <div class="pl-fc-name-block">
                        <div class="pl-fc-name">${this._esc(c.name || 'Unknown')}</div>
                        ${roleHtml}
                    </div>
                </div>
                <span class="pl-fc-otw">Open to work</span>
                <div class="pl-fc-foot">
                    <div class="pl-fc-divider"></div>
                    ${locHtml}
                    <div class="pl-fc-msg-cta">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452z"/></svg>
                        <span>Message on LinkedIn</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Card → candidate's LinkedIn profile.
        // "Message on LinkedIn" → copy the shortlist message + open the candidate's
        // message box (stopPropagation so it doesn't also open the profile).
        grid.querySelectorAll('.pl-fc-card').forEach(card => {
            card.addEventListener('click', () => this._openCandidateProfile(card.dataset.candId));
            const msgBtn = card.querySelector('.pl-fc-msg-cta');
            if (msgBtn) {
                msgBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._messageCandidate(card.dataset.candId);
                });
            }
        });
    },

    // Card tap → open the candidate's LinkedIn profile in a new tab + mark the
    // profile as "viewed" so it counts toward the Profiles metric.
    _openCandidateProfile(candId) {
        const c = (this.fc.all || []).find(x => String(x.id) === String(candId));
        if (!c) return;
        this._markViewed(candId);
        const url = c.linkedin_url || '';
        if (url) window.open(url, '_blank', 'noopener');
        else this.toast('No LinkedIn profile link for this candidate.', 'info');
    },

    // Record (once) that the recruiter engaged with this sourced profile.
    _markViewed(candId) {
        if (!this.pipelineId || !candId) return;
        if (!this._viewedIds) this._viewedIds = new Set();
        if (this._viewedIds.has(String(candId))) return;
        this._viewedIds.add(String(candId));
        fetch(`${this.API}/api/pipeline/${encodeURIComponent(this.pipelineId)}/candidates/${candId}/viewed`,
            { method: 'POST' }).catch(() => {});
    },

    // Copy a shortlist message for this candidate and open their LinkedIn so the
    // recruiter can paste (Ctrl+V) and send. LinkedIn can't pre-fill the message
    // box via URL, so we open the messaging compose (falls back to the profile).
    _messageCandidate(candId) {
        const c = (this.fc.all || []).find(x => String(x.id) === String(candId));
        if (!c) return;
        this._markViewed(candId);

        const company = this.data.company_name || 'our company';
        const role = this.data.hiring_role || 'the role';
        const formUrl = this.data.application_url || '';
        const first = (c.name || '').trim().split(/\s+/)[0] || 'there';

        const msg =
            `Hi ${first}, you've been shortlisted by ${company} for the ${role} role.\n\n` +
            `Please click the link below to apply:\n${formUrl}`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(msg)
                .then(() => this.toast('Message copied — paste it in the chat (Ctrl+V) and send.', 'success'))
                .catch(() => this.toast('Opening LinkedIn — copy the message from the card.', 'info'));
        }

        const url = c.linkedin_url || '';
        const slug = this._linkedinSlug(url);
        const target = slug
            ? `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(slug)}`
            : (url || 'https://www.linkedin.com/messaging/');
        window.open(target, '_blank', 'noopener');
    },

    _linkedinSlug(url) {
        if (!url) return '';
        const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : '';
    },

    _getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return parts[0].substring(0, 2).toUpperCase();
    },

    // Step 4 Hire Now → /e6vn (lazy-create pipeline id if needed first)
    async launchPipeline() {
        if (!this.pipelineId) {
            try { await this._createPipeline(); } catch (_) {}
        }
        if (!this.pipelineId) {
            return this.toast('Pipeline not ready yet — please go back to Step 1', 'error');
        }
        window.location.href = `/e6vn?id=${encodeURIComponent(this.pipelineId)}`;
    },

    // ==================== Step 4: Pipeline Dashboard ====================
    async _loadPipelineStatus() {
        if (!this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/status/${this.pipelineId}`);
            const d = await r.json();
            if (d.success) {
                const p = d.pipeline;
                this.postingId = p.posting_id;
                this.data.hiring_role = p.hiring_role;
                this.data.company_name = p.company_name;
                this.data.job_location = p.job_location;
                this.data.raw_jd = p.job_description || '';

                // Populate Step 1 form fields so they're not blank when user navigates back
                const el = id => document.getElementById(id);
                if (el('f-role')) el('f-role').value = p.hiring_role || '';
                if (el('f-company')) el('f-company').value = p.company_name || '';
                if (el('f-jd')) {
                    el('f-jd').value = p.job_description || '';
                    if (el('f-jd-count')) el('f-jd-count').textContent = (p.job_description || '').length;
                }
                if (el('f-location')) el('f-location').value = p.job_location || '';

                // Load posting detail for Step 2 (linkedin post, application URL, deadline etc.)
                if (this.postingId) {
                    await this._loadPostingDetail();
                }
            }
        } catch (_) {}
    },

    async refreshDashboard() {
        if (!this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/status/${this.pipelineId}`);
            const d = await r.json();
            if (!d.success) return;
            const p = d.pipeline;

            // Header
            const statusLabel = p.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            document.getElementById('dash-role').textContent = this._upper(p.hiring_role) || 'Hiring Dashboard';
            document.getElementById('dash-subtitle').textContent = `${p.company_name || ''} ${p.job_location ? '· ' + p.job_location : ''}`;
            const badge = document.getElementById('dash-status-badge');
            badge.textContent = statusLabel;
            badge.className = 'pl-dash-status ' + (p.status === 'completed' ? 'done' : p.status === 'paused' ? 'paused' : 'active');

            // Job info bar (created date, deadline)
            this._renderJobInfo(p);

            // Sourcing & Contact
            const c = p.counts;
            const el = id => document.getElementById(id);
            el('d-found').textContent = c.total || 0;
            el('d-with-email').textContent = c.with_email || 0;
            el('d-with-phone').textContent = c.with_phone || 0;
            el('d-apps').textContent = (p.posting && p.posting.applications) || 0;
            el('d-referrals').textContent = c.referrals || 0;

            // Screening & Shortlisting
            el('d-screened').textContent = c.screened || 0;
            el('d-pre-filtered').textContent = c.pre_filtered || 0;
            el('d-scored-60').textContent = c.scored_60_plus || 0;
            el('d-ref-pass').textContent = c.referrals || 0;
            el('d-shortlisted').textContent = c.shortlisted || 0;

            // Outreach & Interviews
            el('d-contacted-email').textContent = c.contacted_email || 0;
            el('d-contacted-phone').textContent = c.contacted_phone || 0;
            el('d-contacted-wa').textContent = c.contacted_whatsapp || 0;
            el('d-contacted').textContent = c.contacted || 0;
            el('d-interviews').textContent = c.interviews_scheduled || 0;
            el('d-interviews-done').textContent = c.interviews_completed || 0;

            // Candidates table
            await this._loadCandidates();

            // Audit
            await this._loadAudit();

        } catch (e) { console.error('Dashboard refresh error:', e); }
    },

    _renderJobInfo(p) {
        const bar = document.getElementById('dash-job-info-bar');
        if (!bar) return;

        const created = new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        let deadline = '--';
        let deadlineCls = '';
        if (p.posting && p.posting.application_deadline) {
            const dl = new Date(p.posting.application_deadline);
            const now = new Date();
            const daysLeft = Math.max(0, Math.floor((dl - now) / (1000*60*60*24)));
            deadline = dl.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            if (daysLeft <= 0 || (p.posting.posting_status === 'closed')) {
                deadline += ' (Closed)';
                deadlineCls = 'closed';
            } else if (daysLeft <= 2) {
                deadline += ` (${daysLeft}d left)`;
                deadlineCls = 'warn';
            } else {
                deadline += ` (${daysLeft}d left)`;
            }
        }
        const step = p.current_step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        bar.innerHTML = `
            <span><strong>Created:</strong> ${created}</span>
            <span><strong>Deadline:</strong> <span class="${deadlineCls}">${deadline}</span></span>
            <span><strong>Current Stage:</strong> ${step}</span>
        `;
    },

    async _loadCandidates(shortlisted = false) {
        if (!this.pipelineId) return;
        try {
            const url = `${this.API}/api/pipeline/${this.pipelineId}/candidates?shortlisted=${shortlisted}&limit=100`;
            const r = await fetch(url);
            const d = await r.json();
            if (!d.success) return;

            const empty = document.getElementById('cand-empty');
            const table = document.getElementById('cand-table');
            const tbody = document.getElementById('cand-tbody');

            // Count candidates with email for overview stat
            const withEmail = d.candidates.filter(c => c.email).length;
            const el = document.getElementById('d-with-email');
            if (el) el.textContent = withEmail;

            if (d.candidates.length === 0) {
                empty.style.display = 'block';
                table.classList.add('hidden');
                document.getElementById('cand-count').textContent = '(0)';
                return;
            }
            empty.style.display = 'none';
            table.classList.remove('hidden');
            document.getElementById('cand-count').textContent = `(${d.candidates.length})`;

            tbody.innerHTML = d.candidates.map(c => {
                const isReferral = c.source === 'referral';

                // Name + title column
                const titleStr = c.current_title ? `<span class="pl-td-sub">${this._esc(c.current_title)}</span>` : '';

                // Contact column
                const emailStr = c.email ? `<span class="pl-td-email">${this._esc(c.email)}</span>` : '';
                const phoneStr = c.phone ? `<span class="pl-td-phone">${this._esc(c.phone)}</span>` : '';
                const linkedinStr = c.linkedin_url ? `<a href="${c.linkedin_url}" target="_blank" class="pl-td-linkedin">LinkedIn</a>` : '';
                const contact = emailStr || phoneStr || linkedinStr
                    ? `${emailStr}${phoneStr}${linkedinStr}`
                    : '<span class="pl-td-none">--</span>';

                // Source
                const sourceBadge = isReferral
                    ? `<span class="pl-source-badge referral">Referral</span>`
                    : `<span class="pl-source-badge">${c.source}</span>`;

                // Score
                const scoreVal = c.resume_score !== null ? Math.round(c.resume_score) : null;
                const isFiltered = scoreVal === 0 && c.resume_analysis && c.resume_analysis.pre_filter_failed;
                let score;
                if (isReferral) {
                    score = '<span class="pl-badge referral">Referral</span>';
                } else if (isFiltered) {
                    score = '<span class="pl-badge red">Filtered</span>';
                } else if (scoreVal !== null && scoreVal >= 0) {
                    score = `<span class="pl-score ${scoreVal >= 60 ? 'good' : scoreVal >= 40 ? 'mid' : 'low'}">${scoreVal}</span>`;
                } else {
                    score = '<span class="pl-score-na">--</span>';
                }

                // Status
                const status = c.is_shortlisted
                    ? '<span class="pl-badge green">Shortlisted</span>'
                    : `<span class="pl-badge gray">${(c.outreach_status || 'pending').replace(/_/g, ' ')}</span>`;

                // Interview
                const interview = c.interview_status
                    ? `<span class="pl-badge blue">${c.interview_status}</span>`
                    : '--';
                const resumeLink = c.resume_url
                    ? ` <a href="${c.resume_url}" target="_blank" class="pl-resume-link">Resume</a>`
                    : '';

                return `<tr>
                    <td><strong>${this._esc(this._upper(c.name))}</strong>${titleStr}</td>
                    <td>${contact}</td>
                    <td>${sourceBadge}</td>
                    <td>${score}</td>
                    <td>${status}</td>
                    <td>${interview}${resumeLink}</td>
                </tr>`;
            }).join('');
        } catch (_) {}
    },

    filterCandidates(filter) {
        document.querySelectorAll('.pl-filter').forEach(b => b.classList.remove('active'));
        document.querySelector(`.pl-filter[data-filter="${filter}"]`).classList.add('active');
        this._loadCandidates(filter === 'shortlisted');
    },

    async _loadAudit() {
        if (!this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/audit?limit=30`);
            const d = await r.json();
            if (!d.success) return;
            const log = document.getElementById('audit-log');
            if (d.audit_log.length === 0) {
                log.innerHTML = '<p class="pl-empty">No activity yet.</p>';
                return;
            }
            log.innerHTML = d.audit_log.map(e => {
                const time = new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const label = e.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<div class="pl-audit-item"><span class="pl-audit-action">${label}</span><span class="pl-audit-time">${time}</span></div>`;
            }).join('');
        } catch (_) {}
    },

    // ==================== Dashboard Actions ====================
    async triggerScreening() {
        if (!this.pipelineId) return;
        const btn = event.target;
        btn.disabled = true; btn.textContent = 'Screening...';
        try {
            await fetch(`${this.API}/api/pipeline/${this.pipelineId}/screen-resumes`, { method: 'POST' });
            this.toast('Resume screening started! This may take a minute.', 'success');
            setTimeout(() => { this.refreshDashboard(); btn.disabled = false; btn.textContent = 'Screen Resumes'; }, 5000);
        } catch (_) { this.toast('Failed to start screening', 'error'); btn.disabled = false; btn.textContent = 'Screen Resumes'; }
    },

    async triggerShortlist() {
        if (!this.pipelineId) return;
        const btn = event.target;
        btn.disabled = true; btn.textContent = 'Shortlisting...';
        try {
            await fetch(`${this.API}/api/pipeline/${this.pipelineId}/run-shortlist`, { method: 'POST' });
            this.toast('Shortlisting complete!', 'success');
            setTimeout(() => { this.refreshDashboard(); btn.disabled = false; btn.textContent = 'Run Shortlist'; }, 3000);
        } catch (_) { this.toast('Failed', 'error'); btn.disabled = false; btn.textContent = 'Run Shortlist'; }
    },

    async triggerOutreach() {
        if (!this.pipelineId) return;
        const btn = event.target;
        btn.disabled = true; btn.textContent = 'Starting...';
        try {
            await fetch(`${this.API}/api/pipeline/${this.pipelineId}/start-outreach`, { method: 'POST' });
            this.toast('Outreach emails being sent!', 'success');
            setTimeout(() => { this.refreshDashboard(); btn.disabled = false; btn.textContent = 'Start Outreach'; }, 5000);
        } catch (_) { this.toast('Failed', 'error'); btn.disabled = false; btn.textContent = 'Start Outreach'; }
    },

    // ==================== Deadline Management ====================
    _dlTimer: null,

    _updateDeadlineBar() {
        const bar = document.getElementById('pl-deadline-bar');
        if (!bar) return;  // deadline bar removed from UI — function is a no-op
        const deadline = this.data.application_deadline;
        if (!deadline) { bar.classList.add('hidden'); return; }

        bar.classList.remove('hidden');
        const dl = new Date(deadline);
        const now = new Date();
        const diff = dl - now;
        const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
        const hours = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
        const isClosed = this.data.status === 'closed' || diff <= 0;
        const isExpiring = !isClosed && diff > 0 && diff <= 2 * 24 * 60 * 60 * 1000;

        bar.classList.remove('expiring', 'closed');
        if (isClosed) bar.classList.add('closed');
        else if (isExpiring) bar.classList.add('expiring');

        const valEl = document.getElementById('pl-deadline-value');
        const badgeEl = document.getElementById('pl-deadline-badge');
        const actionsEl = document.getElementById('pl-deadline-actions');
        const dateStr = dl.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dl.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        if (isClosed) {
            valEl.textContent = `Closed on ${dateStr}`;
            badgeEl.textContent = 'Closed';
            actionsEl.classList.add('hidden');
        } else if (isExpiring) {
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

        if (this._dlTimer) clearInterval(this._dlTimer);
        if (!isClosed) this._dlTimer = setInterval(() => this._updateDeadlineBar(), 60000);
    },

    async extendDeadline(days) {
        if (!this.postingId) return;
        if (!confirm(`Extend application deadline by ${days} days?`)) return;
        try {
            const r = await fetch(`${this.API}/api/job-posting/extend-deadline`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId, extend_days: days })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || 'Failed');
            this.data.application_deadline = d.new_deadline;
            this.data.status = 'active';
            this._updateDeadlineBar();
            this.toast(`Deadline extended by ${days} days!`, 'success');
        } catch (e) { this.toast(e.message, 'error'); }
    },

    async closePostingNow() {
        if (!this.postingId) return;
        if (!confirm('Close this posting? No more applications will be accepted.')) return;
        try {
            const r = await fetch(`${this.API}/api/job-posting/close-posting`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ posting_id: this.postingId })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message || 'Failed');
            this.data.status = 'closed';
            this._updateDeadlineBar();
            this.toast(`Posting closed. ${d.total_applications} applications received.`, 'success');
        } catch (e) { this.toast(e.message, 'error'); }
    },

    // ==================== Referral List (Step 2) ====================
    async _loadReferrals() {
        if (!this.pipelineId) return;
        try {
            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/candidates?limit=100`);
            const d = await r.json();
            if (!d.success) return;

            const referrals = d.candidates.filter(c => c.source === 'referral');
            const list = document.getElementById('referral-list');
            const empty = document.getElementById('referral-empty');

            if (referrals.length === 0) {
                empty.style.display = 'block';
                list.querySelectorAll('.pl-referral-item').forEach(el => el.remove());
                return;
            }
            empty.style.display = 'none';

            const items = referrals.map(c => {
                const resumeLink = c.resume_url
                    ? `<a href="${c.resume_url}" target="_blank">Resume</a>`
                    : '';
                const referredBy = c.referred_by ? `Referred by ${this._esc(c.referred_by)}` : '';
                return `<div class="pl-referral-item">
                    <strong>${this._esc(c.name)}</strong>
                    <span style="font-size:12px;color:var(--muted)">${referredBy}</span>
                    <span class="pl-badge referral">Shortlisted</span>
                    ${resumeLink}
                </div>`;
            }).join('');

            // Remove old items, keep empty element
            list.querySelectorAll('.pl-referral-item').forEach(el => el.remove());
            list.insertAdjacentHTML('beforeend', items);
        } catch (_) {}
    },

    // ==================== Referral Upload ====================
    referralResumeFile: null,

    openReferralModal() {
        document.getElementById('referral-overlay').classList.remove('hidden');
        document.getElementById('referral-modal').classList.remove('hidden');
        // Reset form
        ['ref-name', 'ref-email', 'ref-phone', 'ref-by'].forEach(id => document.getElementById(id).value = '');
        this.removeReferralResume();
    },

    closeReferralModal() {
        document.getElementById('referral-overlay').classList.add('hidden');
        document.getElementById('referral-modal').classList.add('hidden');
        this.referralResumeFile = null;
    },

    handleReferralResume(input) {
        const file = input.files[0];
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'doc', 'docx'].includes(ext)) { this.toast('Only PDF, DOC, DOCX allowed', 'error'); input.value = ''; return; }
        if (file.size > 5 * 1024 * 1024) { this.toast('Max file size is 5 MB', 'error'); input.value = ''; return; }

        this.referralResumeFile = file;
        document.getElementById('ref-upload-zone').classList.add('hidden');
        document.getElementById('ref-upload-done').classList.remove('hidden');
        document.getElementById('ref-file-name').textContent = file.name;
    },

    removeReferralResume() {
        this.referralResumeFile = null;
        document.getElementById('ref-file').value = '';
        document.getElementById('ref-upload-zone').classList.remove('hidden');
        document.getElementById('ref-upload-done').classList.add('hidden');
        document.getElementById('ref-upload-text').textContent = 'Click to upload PDF, DOC, or DOCX (max 5 MB)';
    },

    async submitReferral() {
        const name = document.getElementById('ref-name').value.trim();
        const email = document.getElementById('ref-email').value.trim();
        const phone = document.getElementById('ref-phone').value.trim();
        const by = document.getElementById('ref-by').value.trim();

        if (!name) return this.toast('Enter candidate name', 'error');
        if (!by) return this.toast('Enter who referred this candidate', 'error');
        // Validate name / referred-by formats + email/phone when provided.
        if (window.HXAValidate) {
            const v = window.HXAValidate.validateAll(document.getElementById('ref-name').closest('.pl-modal-body') || document);
            if (!v.valid) { if (v.firstInvalid) v.firstInvalid.focus(); return this.toast('Please fix the highlighted fields', 'error'); }
        }
        if (!this.referralResumeFile) return this.toast('Upload the candidate resume', 'error');
        if (!this.pipelineId) return this.toast('No pipeline found', 'error');

        const btn = document.getElementById('btn-add-referral');
        btn.disabled = true;
        btn.innerHTML = '<div class="pl-btn-spinner"></div> Adding...';

        try {
            const fd = new FormData();
            fd.append('candidate_name', name);
            fd.append('candidate_email', email);
            fd.append('candidate_phone', phone);
            fd.append('referred_by', by);
            fd.append('resume', this.referralResumeFile);

            const r = await fetch(`${this.API}/api/pipeline/${this.pipelineId}/add-referral`, {
                method: 'POST', body: fd
            });
            const d = await r.json();
            if (r.status === 409) { this.toast('This candidate already exists in the pipeline', 'error'); return; }
            if (!r.ok || !d.success) throw new Error(d.detail || 'Failed');

            this.toast(d.message, 'success');
            this.closeReferralModal();
            this._loadReferrals();
            if (this.step === 4) this.refreshDashboard();
        } catch (e) { this.toast(e.message, 'error'); }
        finally {
            btn.disabled = false;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Add Referral';
        }
    },

    // ==================== Helpers ====================
    _toHtml(text) {
        if (!text) return '<span class="pl-no-content">No content generated</span>';
        // Escape, then linkify URLs. Newlines are left INTACT — the display
        // container uses white-space: pre-wrap, so blank lines between sections
        // and single line breaks for bullets render exactly as written (and match
        // how the text posts to LinkedIn). Converting newlines to <p>/<br> here
        // collapsed the spacing whenever a global reset zeroed <p> margins.
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
    },

    _showPageLoader(show) {
        let loader = document.getElementById('pl-page-loader');
        if (show) {
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'pl-page-loader';
                loader.className = 'pl-page-loader';
                loader.innerHTML = '<div class="pl-page-spinner"></div><p>Loading details...</p>';
                document.querySelector('.pl-main').prepend(loader);
            }
            loader.style.display = '';
        } else {
            if (loader) loader.style.display = 'none';
        }
    },

    // ==================== Location Autocomplete ====================
    _locTimer: null,

    searchLocation(query) {
        const dropdown = document.getElementById('loc-dropdown');
        if (!query || query.trim().length < 2) { dropdown.classList.add('hidden'); return; }

        // Bind the dropdown click once. Delegation + data-value is robust against
        // apostrophes / commas in place names (an inline onclick string is not).
        if (!this._locClickBound) {
            dropdown.addEventListener('click', (e) => {
                const item = e.target.closest('.pl-loc-item');
                if (item && item.dataset.value) this.selectLocation(item.dataset.value);
            });
            this._locClickBound = true;
        }

        clearTimeout(this._locTimer);
        this._locTimer = setTimeout(async () => {
            try {
                // Backend proxy → Geoapify (key stays server-side, cleaner results).
                const r = await fetch(`/api/geo/autocomplete?q=${encodeURIComponent(query.trim())}&limit=6`);
                const data = await r.json();
                const results = (data && data.results) || [];

                if (!results.length) { dropdown.classList.add('hidden'); return; }

                dropdown.innerHTML = results.map(loc => {
                    const value = this._esc(loc.value).replace(/"/g, '&quot;');
                    return `<div class="pl-loc-item" data-value="${value}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <div class="pl-loc-text">
                            <span class="pl-loc-name">${this._esc(loc.name)}</span>
                            <span class="pl-loc-type">${this._esc(loc.detail)}</span>
                        </div>
                    </div>`;
                }).join('');
                dropdown.classList.remove('hidden');
            } catch (_) { dropdown.classList.add('hidden'); }
        }, 250);
    },

    selectLocation(value) {
        document.getElementById('f-location').value = value;
        document.getElementById('loc-dropdown').classList.add('hidden');
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
    // Display normalization for role + candidate names: ALL CAPS.
    _upper(s) { return s == null ? '' : String(s).toUpperCase(); },

    toast(msg, type = 'info') {
        const t = document.getElementById('toast');
        t.textContent = msg; t.className = `pl-toast ${type}`;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 4000);
    },
};

document.addEventListener('DOMContentLoaded', () => PL.init());
window.PL = PL;
