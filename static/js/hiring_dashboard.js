/**
 * HIRE XA — Hiring Dashboard (per-pipeline detail)
 *
 * Reached as /f9pj?id=<pipeline_id> when the recruiter clicks a
 * role/company in the monitor table. Pulls pipeline metadata + candidate
 * list and renders a table whose column set adapts to the active filter:
 *
 *   Profile     S.No | Candidate | Contact | Source | Resume | Match% | Status | Platform | Interview
 *   Shortlisted S.No | Candidate | Contact | Source | Resume | Match% | Status
 *   Contacted   S.No | Candidate | Contact | Source | Resume | Match% | Status | Platform
 *   Interviews  S.No | Candidate | Contact | Source | Resume | Match% | Status | Platform | Interview
 *   Selected    S.No | Candidate | Contact | Source | Resume | Match% | Status | Platform | Interview | Score
 *
 * Match% is the resume match (resume_score, 0-100 shown as percent).
 * Score (Selected only) is the interview panel average on the 0-10 scale
 * (backend gives 0-100, divided here for display, e.g. 63 -> "6.3").
 */
const HD = {
    user: null,
    pipelineId: null,
    pipeline: null,
    candidates: [],
    filter: 'profile',     // profile | shortlisted | contacted | interviews | selected
    search: '',
    refreshTimer: null,
    _loading: false,

    // Column registry — each filter shows a subset.
    // `match` is the resume match score (e.g. 85%). `score` is the interview
    // panel score on the 0-10 scale (e.g. 6.3) and only appears in Selected.
    // Default alignment is centered (see .hd-th / .hd-cell). Columns with
    // multi-line text (Candidate name + role, Contact email + phone) opt out
    // via `align: 'left'` so the longer content reads naturally instead of
    // hugging the column centre.
    COLUMNS: {
        sn:        { w: 60,  label: 'S No.' },
        candidate: { w: 200, label: 'Candidate', align: 'left' },
        contact:   { w: 230, label: 'Contact',   align: 'left' },
        source:    { w: 100, label: 'Source' },
        resume:    { w: 95,  label: 'Resume' },
        match:     { w: 70,  label: 'Match%' },
        status:    { w: 110, label: 'Status' },
        platform:  { w: 95,  label: 'Platform' },
        interview: { w: 130, label: 'Interview' },
        score:     { w: 90,  label: 'Score' },
    },
    FILTER_COLUMNS: {
        profile:     ['sn','candidate','contact','source','resume','match','status','platform','interview'],
        shortlisted: ['sn','candidate','contact','source','resume','match','status'],
        contacted:   ['sn','candidate','contact','source','resume','match','status','platform'],
        interviews:  ['sn','candidate','contact','source','resume','match','status','platform','interview'],
        selected:    ['sn','candidate','contact','source','resume','match','status','platform','interview','score'],
    },

    init() {
        const u = localStorage.getItem('fluenzoUser');
        if (!u) { window.location.href = '/'; return; }
        this.user = JSON.parse(u);

        // Header user dropdown
        const display = (this.user.name || this.user.email || 'User').split('@')[0];
        const nameEl  = document.getElementById('hd-username');
        const emailEl = document.getElementById('hd-useremail');
        if (nameEl)  nameEl.textContent  = display;
        if (emailEl) emailEl.textContent = this.user.email || '';

        // Pipeline id from URL
        const p = new URLSearchParams(window.location.search);
        this.pipelineId = p.get('id');
        if (!this.pipelineId) {
            this.toast('No pipeline id in URL — redirecting to the jobs page', 'error');
            setTimeout(() => window.location.href = '/d2mw', 1500);
            return;
        }
        // Allow ?filter=shortlisted etc. so the monitor's numeric cells deep-link
        // straight into the right view.
        const reqFilter = p.get('filter');
        if (reqFilter && ['profile','shortlisted','contacted','interviews','selected'].includes(reqFilter)) {
            this.filter = reqFilter;
        } else if (p.get('shortlisted') === '1') {
            this.filter = 'shortlisted';
        } else if (p.get('contacted') === '1') {
            this.filter = 'contacted';
        } else if (p.get('selected') === '1') {
            this.filter = 'selected';
        }

        // Close user dropdown on outside click
        document.addEventListener('click', (e) => {
            const dd = document.getElementById('hd-user-dropdown');
            if (dd && !e.target.closest('.dash-user')) dd.classList.remove('open');
        });

        // Search input — debounced
        const si = document.getElementById('hd-search-input');
        if (si) {
            let t;
            si.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this.search = si.value.toLowerCase().trim();
                    this._renderTable();
                }, 150);
            });
        }

        // Paint a skeleton immediately so the page isn't a half-broken
        // sliver while the first /candidates fetch is in flight: pills
        // (with 0 counts), thead (proper column set for the active filter
        // — gives the fit-content card a real width), and the CTA row
        // width (so the button doesn't sit at the far left at left:146).
        this._renderPills();
        this._renderTable();

        this.load();
        this.refreshTimer = setInterval(() => this.load(), 30000);
    },

    async load() {
        if (this._loading) return;
        this._loading = true;
        try {
            const viewer = (this.user && this.user.email) || '';
            const [statusR, candR] = await Promise.all([
                fetch(`/api/pipeline/status/${encodeURIComponent(this.pipelineId)}?viewer=${encodeURIComponent(viewer)}`),
                fetch(`/api/pipeline/${encodeURIComponent(this.pipelineId)}/candidates?limit=200`),
            ]);
            const statusD = await statusR.json();
            const candD   = await candR.json();
            if (!statusD.success) throw new Error(statusD.detail || 'pipeline not found');

            this.pipeline   = statusD.pipeline || {};
            this.candidates = (candD && candD.candidates) || [];
            this.render();
        } catch (e) {
            console.warn('[HD] load failed', e);
        } finally {
            this._loading = false;
        }
    },

    // === Render ===

    render() {
        this._renderHeader();
        this._renderPills();
        this._renderTable();
    },

    _renderHeader() {
        const p = this.pipeline || {};
        const role    = this._upper(p.hiring_role || 'Untitled role');
        const company = p.company_name || '';
        const loc     = p.job_location || '';

        const roleEl = document.getElementById('hd-role');
        const subEl  = document.getElementById('hd-company-loc');
        if (roleEl) roleEl.textContent = role;
        if (subEl)  subEl.textContent  = [company, loc].filter(Boolean).join(' · ') || ' ';

        const ctcEl = document.getElementById('hd-ctc');
        if (ctcEl) {
            const posting = p.posting || {};
            const bmin = (posting.budget_min || '').toString().trim();
            const bmax = (posting.budget_max || '').toString().trim();
            const cur  = (posting.budget_currency || '').toString().trim();
            if (bmin && bmax) {
                const prefix = cur && cur !== 'INR' ? `${cur} ` : '';
                ctcEl.textContent = `CTC: ${prefix}${bmin} - ${bmax}`;
                ctcEl.classList.remove('hidden');
            } else {
                ctcEl.classList.add('hidden');
            }
        }

        // "Posted by: Name (Role)" — shown only to the org admin (the backend
        // reports viewer_is_admin), so an added user viewing their own role
        // never sees it. Name is underlined per Figma.
        const postedEl = document.getElementById('hd-posted-by');
        if (postedEl) {
            const pb = p.posted_by;
            if (p.viewer_is_admin && pb && pb.name) {
                const roleSuffix = pb.role ? ` (${pb.role})` : '';
                postedEl.innerHTML = `Posted by: <span class="hd-posted-name">${this._esc(pb.name + roleSuffix)}</span>`;
                postedEl.classList.remove('hidden');
            } else {
                postedEl.classList.add('hidden');
            }
        }

        // Status pill — derived from pipeline state (matches monitor logic)
        const pillEl = document.getElementById('hd-status-pill');
        if (pillEl) {
            const cfg = p.config || {};
            const outcome = (cfg.outcome) || 'open';
            const status  = p.status || '';
            const step    = p.current_step || '';
            let cls = 'searching', label = 'Searching';
            if (outcome === 'hired') {
                cls = 'completed'; label = 'Hired';
            } else if (status === 'completed') {
                cls = 'completed'; label = 'Completed';
            } else if (status === 'paused') {
                cls = 'disabled'; label = 'Disabled';
            } else if (step === 'interviewing' || step === 'scheduling') {
                cls = 'interviewing'; label = 'Interviewing';
            } else if (status === 'failed') {
                cls = 'disabled'; label = 'Failed';
            }
            pillEl.className = 'hd-status-pill ' + cls;
            pillEl.textContent = label;
        }

        const createdEl  = document.getElementById('hd-created');
        const deadlineEl = document.getElementById('hd-deadline');
        if (createdEl)  createdEl.textContent = this._fmtDateLong(p.created_at);
        if (deadlineEl) {
            // Prefer the job posting's application_deadline; fall back to the
            // pipeline's search_ends_at for older pipelines that don't have a
            // posting attached.
            const dl = (p.posting && p.posting.application_deadline) || p.search_ends_at;
            const dlText = this._fmtDateLong(dl);
            const closed = dl ? (new Date(dl) < new Date()) : false;
            // Per Figma: when the deadline has passed, the entire date value
            // (and "(Closed)" suffix) renders in red. Label stays gray.
            deadlineEl.classList.toggle('closed', !!(dl && closed));
            deadlineEl.textContent = (dl && closed)
                ? `${dlText} (Closed)`
                : dlText;
        }
    },

    // "Engaged" = a profile the recruiter actually acted on: a tapped LinkedIn
    // profile (is_viewed), a form applicant, or a referral. Untapped sourced
    // LinkedIn profiles are not counted here (they're handled in Step 4).
    _isEngaged(c) {
        return (c.source !== 'linkedin') || c.is_viewed === true;
    },

    _filteredCounts() {
        const all = this.candidates;
        return {
            profile:     all.filter(c => this._isEngaged(c)).length,
            shortlisted: all.filter(c => c.is_shortlisted).length,
            contacted:   all.filter(c => c.outreach_status && c.outreach_status !== 'pending').length,
            interviews:  all.filter(c => c.interview_room_id).length,
            // Threshold is on the 0-100 scaled value (raw 0-10 panel avg x 10),
            // so > 60 = strictly above 6.0 on the interview scale shown in the
            // Score column (a panel average of exactly 6.0 is NOT Selected).
            selected:    all.filter(c => c.interview_status === 'completed' && (c.interview_score || 0) > 60).length,
        };
    },

    _renderPills() {
        const wrap = document.getElementById('hd-pills');
        if (!wrap) return;
        const c = this._filteredCounts();
        const pills = [
            { id: 'profile',     label: 'Profile',     count: c.profile },
            { id: 'shortlisted', label: 'Shortlisted', count: c.shortlisted },
            { id: 'contacted',   label: 'Contacted',   count: c.contacted },
            { id: 'interviews',  label: 'Interviews',  count: c.interviews },
            { id: 'selected',    label: 'Selected',    count: c.selected },
        ];
        wrap.innerHTML = pills.map(p =>
            `<button class="hd-pill ${this.filter === p.id ? 'active' : ''}" data-fid="${p.id}">${this._esc(p.label)} (${p.count})</button>`
        ).join('');
        wrap.querySelectorAll('.hd-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.filter = btn.dataset.fid;
                this._renderPills();
                this._renderTable();
            });
        });
    },

    _filteredList() {
        let list = this.candidates || [];
        switch (this.filter) {
            case 'shortlisted': list = list.filter(c => c.is_shortlisted); break;
            case 'contacted':   list = list.filter(c => c.outreach_status && c.outreach_status !== 'pending'); break;
            case 'interviews':  list = list.filter(c => c.interview_room_id); break;
            case 'selected':    list = list.filter(c => c.interview_status === 'completed' && (c.interview_score || 0) > 60); break;
            default:            list = list.filter(c => this._isEngaged(c)); break;  // 'profile' = engaged only
        }
        if (this.search) {
            const q = this.search;
            list = list.filter(c => (
                (c.name || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q) ||
                (c.current_title || '').toLowerCase().includes(q) ||
                (c.current_company || '').toLowerCase().includes(q)
            ));
        }
        return list;
    },

    _renderTable() {
        const list  = this._filteredList();
        const tbody = document.getElementById('hd-tbody');
        const thead = document.getElementById('hd-thead');
        const card  = document.getElementById('hd-table-card');
        const empty = document.getElementById('hd-empty');
        if (!tbody || !thead) return;

        // Column set depends on the active filter (Shortlisted hides Platform/
        // Interview, Selected adds an extra Score column, etc.).
        const cols = this.FILTER_COLUMNS[this.filter] || this.FILTER_COLUMNS.profile;
        thead.innerHTML = cols.map(k => {
            const col = this.COLUMNS[k];
            const alignCls = col.align === 'left' ? 'hd-align-left' : '';
            return `<div class="hd-th ${alignCls}" style="--w:${col.w}px">${this._esc(col.label)}</div>`;
        }).join('');

        // CTA row is absolute-positioned at .hd-main's bottom; its width must
        // mirror the table card's natural width (sum of column widths + gaps
        // + 18px horizontal padding on each side) so the button's right edge
        // Lock the cta-row AND the toolbar (filter pills + search box) to the
        // table card's per-filter width so the search bar's right edge and the
        // Add Candidate button's right edge both line up with the table card's
        // right border. Table card uses width: fit-content → width = column
        // sum + gaps + horizontal row padding.
        const totalW = cols.reduce((s, k) => s + this.COLUMNS[k].w, 0)
                     + (cols.length - 1) * 12  // 12px gap between cells
                     + 36;                     // 18px left + 18px right padding
        const ctaRow = document.getElementById('hd-cta-row');
        if (ctaRow) ctaRow.style.width = `${totalW}px`;
        const toolbar = document.querySelector('.hd-toolbar');
        if (toolbar) toolbar.style.width = `${totalW}px`;

        // Pre-data: pipeline metadata hasn't arrived yet. Keep the card
        // visible (so the user sees the proper layout instead of a 36px
        // sliver) and drop a Loading row in the body. Without this branch
        // the empty-candidates path below would hide the card entirely.
        if (this.pipeline == null) {
            if (empty) empty.classList.add('hidden');
            if (card)  card.classList.remove('hidden');
            tbody.innerHTML = `<div class="hd-row hd-row-empty">Loading candidates…</div>`;
            return;
        }

        if (list.length === 0) {
            if (this.candidates.length === 0) {
                if (empty) empty.classList.remove('hidden');
                if (card)  card.classList.add('hidden');
            } else {
                if (empty) empty.classList.add('hidden');
                if (card)  card.classList.remove('hidden');
                tbody.innerHTML = `<div class="hd-row hd-row-empty">No candidates match this filter.</div>`;
            }
            return;
        }
        if (empty) empty.classList.add('hidden');
        if (card)  card.classList.remove('hidden');

        tbody.innerHTML = list.map((c, i) => this._rowHTML(c, i, cols)).join('');
    },

    _rowHTML(c, idx, cols) {
        const cells = cols.map(key => this._cellHTML(key, c, idx)).join('');
        return `<div class="hd-row">${cells}</div>`;
    },

    _cellHTML(key, c, idx) {
        const col = this.COLUMNS[key];
        const w = col ? col.w : 100;
        const alignCls = (col && col.align === 'left') ? 'hd-align-left' : '';
        const wrap = (inner, extraCls = '') =>
            `<div class="hd-cell ${alignCls} ${extraCls}" style="--w:${w}px">${inner}</div>`;

        switch (key) {
            case 'sn':
                return wrap(idx + 1, 'hd-cell-sn');

            case 'candidate': {
                const name = this._esc(this._upper(c.name || 'Unknown'));
                const role = this._esc(c.current_title || '—');
                const candIdAttr = c.candidate_id != null ? `'${this._esc(String(c.candidate_id))}'` : 'null';
                const roomIdAttr = c.interview_room_id ? `'${this._esc(c.interview_room_id)}'` : 'null';
                return wrap(`
                    <button class="hd-cand-name hd-cand-link" onclick="HD.openFeedback(${roomIdAttr}, ${candIdAttr})" title="Open candidate feedback">${name}</button>
                    <div class="hd-cand-role">${role}</div>
                `);
            }

            case 'contact': {
                const email = c.email ? this._esc(c.email) : '';
                const phone = c.phone ? this._esc(c.phone) : '';
                const inner = (email || phone)
                    ? `<div>
                           ${email ? `<div class="hd-contact-email">${email}</div>` : ''}
                           ${phone ? `<div class="hd-contact-phone">${phone}</div>` : ''}
                       </div>`
                    : `<span class="hd-contact-empty">Enriching…</span>`;
                return wrap(inner);
            }

            case 'source': {
                const src = (c.source || 'other').toLowerCase();
                const srcCls = ['linkedin','referral','application'].includes(src) ? src : 'other';
                const srcLabel = src.charAt(0).toUpperCase() + src.slice(1);
                return wrap(`<span class="hd-source hd-source-${srcCls}">${this._esc(srcLabel)}</span>`);
            }

            case 'resume': {
                const inner = c.resume_url
                    ? `<a class="hd-preview-btn" href="${this._esc(c.resume_url)}" target="_blank" rel="noopener">
                           <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                           Preview
                       </a>`
                    : `<span class="hd-preview-btn disabled">No file</span>`;
                return wrap(inner);
            }

            case 'match': {
                const v = c.resume_score;
                const inner = (v != null && v > 0)
                    ? `<span class="hd-score">${Math.round(v)}%</span>`
                    : `<span class="hd-score empty">—</span>`;
                return wrap(inner);
            }

            case 'status': {
                let statusLabel = 'Sourced';
                let statusCls = 'muted';
                if (c.is_shortlisted) {
                    statusLabel = 'Shortlisted';
                    statusCls = '';
                } else if (c.resume_score === 0) {
                    statusLabel = 'Pre-filtered';
                    statusCls = 'muted';
                } else if (c.resume_score != null) {
                    statusLabel = 'Screened';
                    statusCls = 'muted';
                }
                return wrap(`<span class="hd-cand-status ${statusCls}">${this._esc(statusLabel)}</span>`);
            }

            case 'platform': {
                // Email envelope + official WhatsApp brand logo. Colors reflect
                // whether the candidate has that channel on their profile (Figma
                // intent — channel availability, not delivery state).
                const emailActive    = !!(c.email && c.email.trim());
                const whatsappActive = !!(c.phone && c.phone.trim());
                const emailFill   = emailActive ? '#CEEAFF' : '#D9D9D9';
                const emailStroke = emailActive ? '#4CABF6' : '#636363';
                const emailSvg = `
                    <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden="true">
                        <path d="M3 3h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="${emailFill}" stroke="${emailStroke}" stroke-width="1"/>
                        <path d="M3 5l9 6.5L21 5" fill="none" stroke="${emailStroke}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
                const waMain  = whatsappActive ? '#25D366' : '#9B9C9E';
                const waInner = '#FFFFFF';
                const whatsappSvg = `
                    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
                        <path fill="${waMain}" d="M16 0C7.163 0 0 7.163 0 16c0 2.825.731 5.605 2.122 8.052L0 32l8.135-2.123A15.886 15.886 0 0 0 16 32c8.837 0 16-7.163 16-16S24.837 0 16 0z"/>
                        <path fill="${waInner}" d="M22.795 18.967c-.388-.194-2.295-1.131-2.65-1.261-.355-.13-.614-.194-.873.194-.258.388-1.001 1.261-1.227 1.519-.226.258-.452.291-.84.097-.388-.194-1.638-.604-3.121-1.926-1.154-1.029-1.933-2.3-2.16-2.688-.226-.388-.024-.598.17-.792.175-.174.388-.452.581-.679.194-.226.258-.388.388-.646.13-.258.065-.485-.032-.679-.097-.194-.873-2.105-1.196-2.881-.315-.756-.635-.654-.873-.666-.226-.011-.484-.013-.743-.013-.258 0-.679.097-1.034.485-.355.388-1.357 1.325-1.357 3.235s1.389 3.752 1.583 4.011c.194.258 2.736 4.18 6.629 5.86.927.4 1.65.639 2.213.818.93.296 1.776.254 2.444.154.745-.111 2.295-.939 2.618-1.844.323-.905.323-1.681.226-1.844-.097-.162-.355-.258-.743-.452z"/>
                    </svg>
                `;
                return wrap(`
                    <div class="hd-platform">
                        <span class="hd-platform-icon email" title="${emailActive ? 'Email available' : 'No email on file'}">${emailSvg}</span>
                        <span class="hd-platform-icon whatsapp" title="${whatsappActive ? 'Phone available for WhatsApp' : 'No phone on file'}">${whatsappSvg}</span>
                    </div>
                `);
            }

            case 'interview':
                return wrap(this._interviewPill(c));

            case 'score': {
                // Selected-only column: interview panel average on the 0-10
                // scale. Backend stores it as raw_avg x 10 (0-100), so divide
                // back down for display (e.g. 63 -> "6.3"). Format as "X.X / 10"
                // with the score color-coded by band: >=7 green, 4-7 amber,
                // <4 red. Whole numbers (e.g. 9) drop the trailing zero.
                // "/ 10" stays neutral gray.
                const iv = c.interview_score;
                if (iv == null) {
                    return wrap(`<span class="hd-score empty">—</span>`);
                }
                const num = iv / 10;
                const display = (num === Math.floor(num)) ? num.toString() : num.toFixed(1);
                const band = num >= 7 ? 'high' : (num >= 4 ? 'mid' : 'low');
                const inner = `<span class="hd-score hd-score-${band}">${display}</span>`
                            + `<span class="hd-score-denom"> / 10</span>`;
                return wrap(inner);
            }
        }
        return wrap('');
    },

    _interviewPill(c) {
        const status = (c.interview_status || '').toLowerCase();
        if (!c.interview_room_id) return `<span class="hd-iv-pill none">Not scheduled</span>`;
        if (status === 'expired')   return `<span class="hd-iv-pill expired">Didn't Appear</span>`;
        if (status === 'completed') {
            // Pick Selected / Rejected from the interview score (avg of
            // agent_feedbacks). If feedback hasn't been generated yet, fall
            // back to the neutral "Interviewed" label. > 60 = strictly above
            // 6.0 on the 0-10 scale shown in the Selected filter's Score
            // column (a panel average of exactly 6.0 is NOT Selected).
            const score = c.interview_score;
            if (score == null) return `<span class="hd-iv-pill interviewed">Interviewed</span>`;
            if (score > 60)    return `<span class="hd-iv-pill selected">Selected</span>`;
            return `<span class="hd-iv-pill rejected">Rejected</span>`;
        }
        if (status === 'scheduled') return `<span class="hd-iv-pill interviewing">Interviewing</span>`;
        if (status === 'in_progress' || status === 'active') return `<span class="hd-iv-pill interviewing">Interviewing</span>`;
        return `<span class="hd-iv-pill scheduled">${this._esc(status || 'Scheduled')}</span>`;
    },

    // === Actions ===

    addCandidate() {
        // Hand off to Quick Interview with this pipeline pre-selected as the
        // "Interview for" role. The Quick Interview page reads ?pipeline=<id>
        // on load and auto-picks the role so the recruiter goes straight to
        // dropping a resume + sending the invite.
        window.location.href = `/p8eu?pipeline=${encodeURIComponent(this.pipelineId)}`;
    },

    openFeedback(roomId, candidateId) {
        const base = `/g3tg?pipeline=${encodeURIComponent(this.pipelineId)}`;
        if (roomId) {
            window.location.href = `${base}&room=${encodeURIComponent(roomId)}`;
        } else if (candidateId) {
            window.location.href = `${base}&candidate=${encodeURIComponent(candidateId)}`;
        } else {
            window.location.href = base;
        }
    },

    logout(e) {
        e && e.preventDefault();
        localStorage.removeItem('fluenzoUser');
        localStorage.removeItem('currentSession');
        window.location.href = '/';
    },

    // === Helpers ===

    _fmtDateLong(iso) {
        if (!iso) return '—';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '—';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const yyyy = m[1];
        const mm = months[parseInt(m[2], 10) - 1] || '';
        const dd = m[3];
        return `${dd} ${mm} ${yyyy}`;
    },

    toast(msg, type = 'info') {
        const t = document.getElementById('hd-toast');
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
    // Display normalization for role + candidate names: ALL CAPS.
    // "ai/ml engineer" → "AI/ML ENGINEER", "harsh raj" → "HARSH RAJ".
    // Subtitles (current_title, company, location) stay normal-case.
    _upper(s) {
        if (s == null) return '';
        return String(s).toUpperCase();
    },
};

document.addEventListener('DOMContentLoaded', () => HD.init());
window.HD = HD;
