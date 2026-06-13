/**
 * HIRE XA — Pipeline Monitor (Jobs posted)
 *
 * Lists all pipelines for the recruiter as a Figma-spec table:
 * Role/Company | Status | Profiles | Shortlisted | Contacted | Interviews | Selections | Created | Actions
 *
 * Numeric cells deep-link into the per-pipeline hiring dashboard / feedback
 * view so the recruiter can drill in. Toggle pauses/resumes the pipeline; the
 * Hired/Open dropdown is the role-fill outcome.
 */
const PM = {
    user: null,
    pipelines: [],
    filtered: [],
    filter: 'all',     // 'all' | 'active' | 'completed' | 'candidates'
    search: '',        // role / location / poster filter (resolved by the backend)
    refreshTimer: null,
    _loading: false,

    init() {
        const u = localStorage.getItem('fluenzoUser');
        if (!u) { window.location.href = '/'; return; }
        this.user = JSON.parse(u);

        // Header user dropdown
        const nameEl = document.getElementById('pm-username');
        const emailEl = document.getElementById('pm-useremail');
        const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-zÀ-ɏ])/g, (m, a, b) => a + b.toUpperCase());
        const display = titleCase((this.user.name || this.user.email || 'User').split('@')[0]);
        if (nameEl) nameEl.textContent = display;
        if (emailEl) emailEl.textContent = this.user.email || '';

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            const dd = document.getElementById('pm-user-dropdown');
            if (dd && !e.target.closest('.dash-user')) dd.classList.remove('open');
            // Close any open row outcome menus
            document.querySelectorAll('.pm-outcome-menu.open').forEach(m => {
                if (!e.target.closest('.pm-outcome-cell')) m.classList.remove('open');
            });
        });
        // Escape closes the JD popup
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeJobDescription();
        });

        // Search box — debounced; poster-name matching happens server-side, so
        // every keystroke re-fetches the (org-scoped) list with the query.
        const si = document.getElementById('pm-search-input');
        if (si) {
            let t;
            si.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this.search = si.value.trim();
                    this.load();
                }, 250);
            });
        }

        this.load();
        // Auto-refresh every 30s
        this.refreshTimer = setInterval(() => this.load(), 30000);
    },

    // TEMP sample data — remove before production
    _SAMPLE_DATA: {"success":true,"pipelines":[{"pipeline_id":"RP-9D83888D","posting_id":"JP-2DA63741","hiring_role":"Product Manager","company_name":"Vizara Technologies Pvt Ltd","job_location":"Remote (India)","status":"active","current_step":"sourcing","paused":false,"outcome":"open","counts":{"total":0,"profiles":0,"with_email":0,"with_phone":0,"referrals":0,"screened":0,"pre_filtered":0,"scored_60_plus":0,"shortlisted":0,"contacted":0,"contacted_email":0,"contacted_phone":0,"contacted_whatsapp":0,"interviews_scheduled":0,"interviews_completed":0,"selections":0,"applications":0},"search_started_at":null,"created_at":"2026-06-12 07:14:40.275604"},{"pipeline_id":"RP-A5897BA5","posting_id":"JP-86C6D693","hiring_role":"Frontend Engineer","company_name":"Vizara Technologies Pvt Ltd","job_location":"Bengaluru, India","status":"active","current_step":"sourcing","paused":false,"outcome":"open","counts":{"total":0,"profiles":0,"with_email":0,"with_phone":0,"referrals":0,"screened":0,"pre_filtered":0,"scored_60_plus":0,"shortlisted":0,"contacted":0,"contacted_email":0,"contacted_phone":0,"contacted_whatsapp":0,"interviews_scheduled":0,"interviews_completed":0,"selections":0,"applications":0},"search_started_at":null,"created_at":"2026-06-12 07:14:40.275604"}]},

    async load() {
        if (this._loading) return;
        this._loading = true;
        try {
            // TEMP: use sample data instead of live API
            const d = this._SAMPLE_DATA;
            if (!d.success) return;
            this.pipelines = d.pipelines || [];
            this.render();
        } catch (e) {
            console.error('[PM] load error', e);
        } finally {
            this._loading = false;
        }
    },

    // === Render ===

    render() {
        this._renderSummary();
        this._renderPills();
        this._renderTable();
    },

    _summaryCounts() {
        const all = this.pipelines;
        const active = all.filter(p => this._isActive(p)).length;
        const completed = all.filter(p => p.status === 'completed' || p.outcome === 'hired').length;
        // Candidates currently in the funnel: only those belonging to ACTIVE
        // pipelines, so the headline number reflects live work in progress
        // (excludes hired / completed / paused roles).
        const inPipeline = all
            .filter(p => this._isActive(p))
            .reduce((sum, p) => sum + ((p.counts || {}).profiles || 0), 0);
        const hiresThisQuarter = all.reduce((sum, p) => sum + ((p.counts || {}).selections || 0), 0);
        return { all: all.length, active, completed, inPipeline, hiresThisQuarter };
    },

    _isActive(p) {
        return !['paused', 'completed', 'failed'].includes(p.status) && p.outcome !== 'hired';
    },

    _renderSummary() {
        const c = this._summaryCounts();
        const el = document.getElementById('pm-summary');
        if (!el) return;
        if (this.pipelines.length === 0) {
            el.textContent = 'No pipelines yet — start your first hire below.';
            return;
        }
        el.textContent = `${c.active} active role${c.active === 1 ? '' : 's'} · ${c.inPipeline} candidate${c.inPipeline === 1 ? '' : 's'} in pipeline · ${c.hiresThisQuarter} hire${c.hiresThisQuarter === 1 ? '' : 's'} this quarter`;
    },

    _renderPills() {
        const wrap = document.getElementById('pm-pills');
        if (!wrap) return;
        const c = this._summaryCounts();
        const pills = [
            { id: 'all',        label: 'All',          count: c.all },
            { id: 'active',     label: 'Active roles', count: c.active },
            { id: 'completed',  label: 'Completed',    count: c.completed },
        ];
        wrap.innerHTML = pills.map(p => `
            <button class="pm-pill ${this.filter === p.id ? 'active' : ''}" data-fid="${p.id}">
                ${this._esc(p.label)} (${p.count})
            </button>
        `).join('');
        wrap.querySelectorAll('.pm-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.filter = btn.dataset.fid;
                this._renderPills();
                this._renderTable();
            });
        });
    },

    _filtered() {
        if (this.filter === 'active')    return this.pipelines.filter(p => this._isActive(p));
        if (this.filter === 'completed') return this.pipelines.filter(p => p.status === 'completed' || p.outcome === 'hired');
        return this.pipelines;
    },

    _renderTable() {
        const list = this._filtered();
        const tbody = document.getElementById('pm-tbody');
        const card = document.getElementById('pm-table-card');
        const empty = document.getElementById('pm-empty');
        if (!tbody) return;

        if (list.length === 0) {
            if (this.pipelines.length === 0) {
                if (empty) empty.classList.remove('hidden');
                if (card) card.classList.add('hidden');
            } else {
                if (empty) empty.classList.add('hidden');
                if (card) card.classList.remove('hidden');
                tbody.innerHTML = `<div class="pm-row pm-row-empty">No pipelines match this filter.</div>`;
            }
            return;
        }
        if (empty) empty.classList.add('hidden');
        if (card) card.classList.remove('hidden');

        tbody.innerHTML = list.map(p => this._rowHTML(p)).join('');
        // Wire row interactions (delegated would also work; per-row keeps it simple)
        tbody.querySelectorAll('.pm-toggle').forEach(t => {
            t.addEventListener('click', (e) => {
                e.stopPropagation();
                // Quick toggle flips between open ↔ paused. Hired rows have an
                // empty data-flip — the toggle button is also `disabled`, so this
                // is a defensive no-op even if it somehow fires.
                const flip = t.dataset.flip;
                if (!flip) return;
                this.setOutcome(t.dataset.pid, flip);
            });
        });
        tbody.querySelectorAll('.pm-outcome-trigger').forEach(t => {
            t.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = t.parentElement.querySelector('.pm-outcome-menu');
                // Close any other open menu first
                document.querySelectorAll('.pm-outcome-menu.open').forEach(m => {
                    if (m !== menu) m.classList.remove('open');
                });
                if (menu.classList.contains('open')) {
                    menu.classList.remove('open');
                    return;
                }
                // Add .open first so the menu is rendered (display:block) — that
                // gives _positionMenu an accurate offsetHeight to vertically center.
                menu.classList.add('open');
                this._positionMenu(t, menu);
            });
        });

        // Close any open dropdown when the table body scrolls — fixed-positioned
        // menus would otherwise float over the wrong row after a scroll.
        if (!tbody._pmScrollHooked) {
            tbody.addEventListener('scroll', () => {
                document.querySelectorAll('.pm-outcome-menu.open').forEach(m => m.classList.remove('open'));
            });
            tbody._pmScrollHooked = true;
        }
        tbody.querySelectorAll('.pm-outcome-opt').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setOutcome(opt.dataset.pid, opt.dataset.val);
            });
        });
        // Info-icon → open JD popover
        tbody.querySelectorAll('.pm-info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showJobDescription(
                    btn.dataset.posting,
                    btn.dataset.role,
                    btn.dataset.company,
                );
            });
        });
    },

    _rowHTML(p) {
        const c = p.counts || {};
        const role = this._esc(this._upper(p.hiring_role || 'Untitled role'));
        const company = this._esc(p.company_name || '');
        const loc = this._esc(p.job_location || '');
        const sub = [company, loc].filter(Boolean).join(' · ');
        const postingId = this._esc(p.posting_id || '');
        const status = this._statusBadge(p);
        const date = this._fmtDate(p.created_at);
        // Every numeric cell deep-links into the per-pipeline hiring dashboard
        // with the matching filter pre-applied — keeps the recruiter in one
        // page instead of bouncing to /g3tg which only handles a
        // specific candidate room.
        const link = (filter) => {
            const base = `/f9pj?id=${encodeURIComponent(p.pipeline_id)}`;
            return filter ? `${base}&filter=${filter}` : base;
        };
        const profilesURL    = link();
        const shortlistedURL = link('shortlisted');
        const contactedURL   = link('contacted');
        const interviewsURL  = link('interviews');
        const selectionsURL  = link('selected');

        // Single source of truth: outcome. Three states.
        //   'open'   → AI is running. Toggle ON.
        //   'paused' → HR has paused it. Toggle OFF. Re-Open from dropdown.
        //   'hired'  → role is filled. Toggle OFF + disabled. Re-Open from dropdown.
        const outcome = (p.outcome || 'open');
        const isOpen   = outcome === 'open';
        const isPaused = outcome === 'paused';
        const isHired  = outcome === 'hired';
        const pid = this._esc(p.pipeline_id);

        // Quick toggle (left switch) flips Open ↔ Paused. For Hired, the toggle
        // is disabled — the recruiter must explicitly Re-Open from the dropdown
        // since hiring is a significant state to revert.
        const toggleOn      = isOpen;
        const toggleFlip    = isOpen ? 'paused' : (isPaused ? 'open' : '');
        const toggleTitle   = isOpen
            ? 'Pause this pipeline (AI stops sending invites)'
            : isPaused
                ? 'Resume the pipeline'
                : 'Role is hired — use Re-Open from the dropdown to revert';
        const toggleDisabled = isHired ? 'disabled' : '';

        // Dropdown trigger label + colour class
        const triggerLabel = isHired ? 'Hired' : isPaused ? 'Paused' : 'Open';

        // Dropdown options — state-aware. Each option lists what action will happen.
        let menuOpts;
        if (isOpen) {
            menuOpts = [
                {val: 'paused', cls: 'paused', label: 'Pause'},
                {val: 'hired',  cls: 'hired',  label: 'Hired'},
            ];
        } else if (isPaused) {
            menuOpts = [
                {val: 'open',  cls: 'open',  label: 'Open'},
                {val: 'hired', cls: 'hired', label: 'Hired'},
            ];
        } else {  // hired
            menuOpts = [
                {val: 'open', cls: 'open', label: 'Re-Open'},
            ];
        }
        const menuHTML = menuOpts.map(o =>
            `<button class="pm-outcome-opt ${o.cls}" data-pid="${pid}" data-val="${o.val}">${o.label}</button>`
        ).join('');

        return `
        <div class="pm-row">
            <div class="pm-cell pm-cell-role" style="--w:260px">
                <div class="pm-role-line">
                    <a class="pm-role-name" href="${profilesURL}">${role}</a>
                    <button class="pm-info-btn" type="button" data-posting="${postingId}" data-role="${role}" data-company="${this._esc(company)}" title="View job description" aria-label="View job description">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    </button>
                </div>
                ${sub ? `<div class="pm-role-sub">${sub}</div>` : ''}
            </div>
            <div class="pm-cell" style="--w:120px">${status}</div>
            <div class="pm-cell pm-cell-num" style="--w:100px"><a class="pm-num" href="${profilesURL}">${c.profiles || 0}</a></div>
            <div class="pm-cell pm-cell-num" style="--w:110px"><a class="pm-num" href="${shortlistedURL}">${c.shortlisted || 0}</a></div>
            <div class="pm-cell pm-cell-num" style="--w:110px"><a class="pm-num" href="${contactedURL}">${c.contacted || 0}</a></div>
            <div class="pm-cell pm-cell-num" style="--w:110px"><a class="pm-num" href="${interviewsURL}">${c.interviews_scheduled || 0}</a></div>
            <div class="pm-cell pm-cell-num" style="--w:110px"><a class="pm-num" href="${selectionsURL}">${c.selections || 0}</a></div>
            <div class="pm-cell pm-cell-date" style="--w:100px">${date}</div>
            <div class="pm-cell pm-cell-actions" style="--w:156px">
                <button class="pm-toggle ${toggleOn ? 'on' : 'off'} ${toggleDisabled}" data-pid="${pid}" data-flip="${toggleFlip}" title="${toggleTitle}" aria-label="${toggleTitle}" ${toggleDisabled}>
                    <span class="pm-toggle-dot"></span>
                </button>
                <div class="pm-outcome-cell">
                    <button class="pm-outcome-trigger ${outcome}" type="button">
                        <span>${triggerLabel}</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div class="pm-outcome-menu">
                        ${menuHTML}
                    </div>
                </div>
            </div>
        </div>
        `;
    },

    _statusBadge(p) {
        // Outcome drives the badge; run-state only fills the gaps.
        //   outcome='hired'  → green "Hired"
        //   outcome='paused' → grey "Paused" (HR-paused, not hired)
        //   else             → derive from pipeline run state.
        let kind = 'searching';
        let label = 'Searching';
        if (p.outcome === 'hired') {
            kind = 'completed'; label = 'Hired';
        } else if (p.outcome === 'paused') {
            kind = 'disabled'; label = 'Paused';
        } else if (p.status === 'completed') {
            kind = 'completed'; label = 'Completed';
        } else if (p.paused || p.status === 'paused') {
            kind = 'disabled'; label = 'Paused';
        } else if (p.current_step === 'interviewing' || p.current_step === 'scheduling') {
            kind = 'interviewing'; label = 'Interviewing';
        } else if (p.status === 'failed') {
            kind = 'disabled'; label = 'Failed';
        }
        return `<span class="pm-status pm-status-${kind}">${label}</span>`;
    },

    _fmtDate(iso) {
        if (!iso) return '';
        // Parse "YYYY-MM-DD HH:MM:SS..." → "DD MMM YY"
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const yy = m[1].slice(-2);
        const mm = months[parseInt(m[2], 10) - 1] || '';
        const dd = m[3];
        return `${dd} ${mm} ${yy}`;
    },

    // === Actions ===

    async setOutcome(pipelineId, val) {
        // Optimistic update so the toggle responds instantly
        const target = this.pipelines.find(p => p.pipeline_id === pipelineId);
        const prevOutcome = target ? target.outcome : null;
        if (target) {
            target.outcome = val;
            // Anything other than 'open' means the pipeline is paused under the hood.
            target.paused = (val !== 'open');
            this._renderTable();
        }

        try {
            const r = await fetch(`/api/pipeline/${encodeURIComponent(pipelineId)}/outcome`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome: val }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'failed');
            const msg = {
                open:   prevOutcome === 'hired'
                    ? 'Role re-opened — pipeline resumed'
                    : 'Pipeline resumed — AI outreach is back on',
                paused: 'Pipeline paused — AI will not send any new invites',
                hired:  'Role marked as filled — pipeline paused',
            }[val] || 'Outcome updated';
            this.toast(msg, 'success');
            // Re-fetch in background to pick up server-side side effects (status changes etc.)
            this.load();
        } catch (e) {
            // Roll back optimistic change
            if (target) {
                target.outcome = prevOutcome;
                target.paused = prevOutcome !== 'open';
                this._renderTable();
            }
            this.toast(`Could not update outcome: ${e.message || e}`, 'error');
        }
    },

    newRole() {
        // Send the recruiter to the recruitment pipeline wizard (/pipeline)
        // so they can spin up a fresh role from scratch.
        window.location.href = '/c8qr';
    },

    // === Job Description popup ===
    async showJobDescription(postingId, role, company) {
        if (!postingId) {
            this.toast('No posting linked to this pipeline.', 'error');
            return;
        }
        const overlay = document.getElementById('pm-jd-overlay');
        const titleEl = document.getElementById('pm-jd-title');
        const subEl = document.getElementById('pm-jd-sub');
        const bodyEl = document.getElementById('pm-jd-body');
        if (!overlay || !bodyEl) return;

        titleEl.textContent = role || 'Job Description';
        subEl.textContent = company || '';
        bodyEl.innerHTML = '<div class="pm-jd-loading">Loading job description…</div>';
        overlay.classList.remove('hidden');

        try {
            const r = await fetch(`/api/job-posting/detail/${encodeURIComponent(postingId)}`);
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.detail || 'failed');
            const formatted = (d.posting && d.posting.formatted_jd) || '';
            const raw = (d.posting && d.posting.raw_jd) || '';
            // Prefer the LLM-formatted version, but if it looks like an LLM
            // apology / error response (sometimes the model failed during
            // pipeline creation), fall back to the recruiter's raw input.
            const looksLikeApology = this._isLlmApology(formatted);
            const jd = (formatted && !looksLikeApology) ? formatted : raw;
            if (!jd.trim()) {
                bodyEl.innerHTML = '<p class="pm-jd-empty">No job description recorded for this role.</p>';
                return;
            }
            bodyEl.innerHTML = this._jdToHtml(jd);
        } catch (e) {
            bodyEl.innerHTML = `<p class="pm-jd-empty">Couldn't load job description: ${this._esc(e.message || 'unknown error')}</p>`;
        }
    },

    _isLlmApology(text) {
        if (!text) return false;
        const t = text.trim().toLowerCase();
        if (t.length > 320) return false;  // real JDs are longer than a one-liner apology
        const tells = [
            'i apologize',
            "i'm unable",
            'i am unable',
            "i can't process",
            "i cannot process",
            'please try again',
            'unable to process your request',
            'unable to generate',
        ];
        return tells.some(s => t.includes(s));
    },

    closeJobDescription() {
        const overlay = document.getElementById('pm-jd-overlay');
        if (overlay) overlay.classList.add('hidden');
    },

    _jdToHtml(text) {
        // Convert plain text JD to safe HTML — escape, then preserve paragraph breaks.
        const safe = this._esc(text);
        return safe
            .split(/\n{2,}/)
            .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
            .join('');
    },

    logout(e) {
        e && e.preventDefault();
        localStorage.removeItem('fluenzoUser');
        localStorage.removeItem('currentSession');
        window.location.href = '/';
    },

    // Anchor the (position:fixed) outcome menu directly under the trigger button
    // so it visually opens DOWNWARD from the trigger, matching the Figma. Using
    // fixed coords lets the menu escape the .pm-tbody overflow clip.
    _positionMenu(trigger, menu) {
        const rect = trigger.getBoundingClientRect();
        // Use offsetWidth (integer pixel box width) so the menu's width is
        // exactly the trigger's rendered box width — no sub-pixel rounding
        // mismatch. Setting width, min-width AND max-width locks it down so
        // option text can't push the menu wider OR narrower than the trigger.
        const menuWidth = Math.max(56, trigger.offsetWidth);
        let left = rect.right - menuWidth;
        if (left < 8) left = 8;
        if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
        // Pull the menu UP so its top tucks ~9px under the trigger pill. The
        // pill (z-index 250) paints over this overlap, so the menu reads as
        // sliding out from beneath the cylinder.
        const top = rect.bottom - 9;
        menu.style.width = `${menuWidth}px`;
        menu.style.minWidth = `${menuWidth}px`;
        menu.style.maxWidth = `${menuWidth}px`;
        menu.style.top  = `${Math.round(top)}px`;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.right = 'auto';
    },

    // === Helpers ===
    toast(msg, type = 'info') {
        const t = document.getElementById('pm-toast');
        if (!t) return;
        t.textContent = msg;
        t.className = `pl-toast ${type}`;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 3500);
    },
    _esc(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    },
    // Display normalization for role names in the Role/Company column:
    // ALL CAPS. "ai/ml engineer" → "AI/ML ENGINEER". Company + location
    // subline (rendered separately) stays normal-case.
    _upper(s) {
        if (s == null) return '';
        return String(s).toUpperCase();
    },
};

document.addEventListener('DOMContentLoaded', () => PM.init());
window.PM = PM;
