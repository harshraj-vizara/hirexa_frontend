/* Hire XA — Quick Interview (single page)
   Flow:
     1. Recruiter picks an existing recruitment pipeline ("Interview for")
     2. System reads that pipeline's saved interview panel (config.recruiter_panel)
        and renders the agents pre-selected. Recruiter can override.
     3. Recruiter drops a resume + name + email and hits "Send interview invite".
     4. POST /api/pipeline/{id}/add-referral fires the existing referral path:
        candidate is auto-shortlisted + interview built + Twilio/email invites sent
        in the background (currently silenced by OUTREACH kill-switch on staging).
*/
(function () {
    const API = '';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    // Display normalization for role names: ALL CAPS.
    const upper = s => (s == null ? '' : String(s).toUpperCase());

    const GRAD_CLASSES = ['qi-grad-coral', 'qi-grad-purple', 'qi-grad-blue', 'qi-grad-green', 'qi-grad-yellow'];

    // Mirrors src/screening_round_interview.py AGENT_PROFILES + CORE_VALUES_AGENTS
    const AGENT_CATALOG = {
        priya:   { name: 'Priya',   role: 'HR' },
        arjun:   { name: 'Arjun',   role: 'Domain Expert' },
    };
    // Mirrors src/screening_round_interview.py CORE_VALUES_AGENTS — real agent
    // names + their evaluator role labels.
    const CV_CATALOG = {
        cv_integrity:      { name: 'Kavita Verma',     role: 'Integrity Evaluator' },
        cv_innovation:     { name: 'Rohit Bansal',     role: 'Innovation Assessor' },
        cv_accountability: { name: 'Nisha Patel',      role: 'Accountability Analyst' },
        cv_honesty:        { name: 'Aditya Rao',       role: 'Honesty Evaluator' },
        cv_respect:        { name: 'Sunita Joshi',     role: 'Respect Assessor' },
        cv_passion:        { name: 'Karan Malhotra',   role: 'Passion Evaluator' },
        cv_customer_focus: { name: 'Ritu Agarwal',     role: 'Customer Focus Analyst' },
        cv_excellence:     { name: 'Manish Tiwari',    role: 'Excellence Assessor' },
        cv_teamwork:       { name: 'Pooja Saxena',     role: 'Teamwork Evaluator' },
        cv_transparency:   { name: 'Naveen Kumar',     role: 'Transparency Assessor' },
        cv_diversity:      { name: 'Shreya Menon',     role: 'D&I Evaluator' },
        cv_learning:       { name: 'Amit Chandra',     role: 'Learning Assessor' },
        cv_adaptability:   { name: 'Swati Deshmukh',   role: 'Adaptability Analyst' },
        cv_ownership:      { name: 'Harsh Jain',       role: 'Ownership Evaluator' },
        cv_empathy:        { name: 'Anjali Bhatt',     role: 'Empathy Assessor' },
        cv_courage:        { name: 'Vivek Sinha',      role: 'Courage Evaluator' },
        cv_results:        { name: 'Tanvi Kulkarni',   role: 'Results Analyst' },
        cv_simplicity:     { name: 'Suresh Pillai',    role: 'Simplicity Assessor' },
        cv_social_resp:    { name: 'Divya Nambiar',    role: 'Social Responsibility' },
        cv_sustainability: { name: 'Pranav Hegde',     role: 'Sustainability Assessor' },
        cv_communication:  { name: 'Lata Mishra',      role: 'Communication Analyst' },
        cv_leadership:     { name: 'Gaurav Thakur',    role: 'Leadership Evaluator' },
        cv_fairness:       { name: 'Rekha Dasgupta',   role: 'Fairness Assessor' },
        cv_creativity:     { name: 'Siddharth Mohan',  role: 'Creativity Evaluator' },
        cv_community:      { name: 'Isha Rawat',       role: 'Community Assessor' },
    };

    const QI = {
        pipelines: [],
        selectedPipelineId: null,
        selectedRole: null,
        selectedAgents: new Set(),
        suggestedAgents: new Set(),
        resumeFile: null,
        showAllAgents: false,
        recruiterEmail: '',

        logout(e) {
            if (e) e.preventDefault();
            localStorage.removeItem('fluenzoUser');
            localStorage.removeItem('fluenzo_user');
            localStorage.removeItem('currentSession');
            window.location.href = '/';
        },

        goBack() { window.location.href = '/b4kx'; },

        _toast(msg, kind) {
            const t = $('qi-toast');
            t.textContent = msg;
            t.className = 'qi-toast' + (kind ? ' ' + kind : '');
            t.classList.remove('hidden');
            clearTimeout(this._tt);
            this._tt = setTimeout(() => t.classList.add('hidden'), 3000);
        },

        _initUser() {
            try {
                const u = JSON.parse(localStorage.getItem('fluenzoUser') || localStorage.getItem('fluenzo_user') || 'null');
                if (u) {
                    this.recruiterEmail = u.email || '';
                    if ($('qi-username')) $('qi-username').textContent = u.name || (u.email ? u.email.split('@')[0] : 'User');
                    if ($('qi-useremail')) $('qi-useremail').textContent = u.email || '';
                } else {
                    window.location.href = '/';
                }
            } catch (e) { /* noop */ }

            document.addEventListener('click', e => {
                const userDd = $('qi-user-dropdown');
                if (userDd && !userDd.contains(e.target)) userDd.classList.remove('open');
                const roleMenu = $('qi-role-menu');
                const roleTrig = $('qi-role-trigger');
                if (roleMenu && roleTrig && !roleMenu.contains(e.target) && !roleTrig.contains(e.target)) {
                    roleMenu.classList.add('hidden');
                    roleTrig.classList.remove('open');
                }
            });
        },

        // Merge the org's CUSTOM core-value agents (cv_c*) into CV_CATALOG so they
        // render + are selectable like the built-ins. The interview engine already
        // resolves and runs them, so a selected custom agent asks questions
        // exactly like a normal core-value agent.
        async _loadCustomAgents() {
            if (!this.recruiterEmail) return;
            try {
                const r = await fetch(`${API}/api/company/profile?email=${encodeURIComponent(this.recruiterEmail)}`);
                if (!r.ok) return;
                const d = await r.json();
                const list = (d && Array.isArray(d.custom_agents)) ? d.custom_agents : [];
                list.forEach(c => {
                    if (!c || !c.id) return;
                    CV_CATALOG[c.id] = {
                        name: c.agent || c.name || 'Interviewer',
                        role: c.role || ((c.name || 'Core Value') + ' Evaluator'),
                    };
                });
            } catch (e) { /* noop — falls back to built-ins only */ }
        },

        async _loadPipelines() {
            if (!this.recruiterEmail) return;
            try {
                const r = await fetch(`${API}/api/pipeline/list?recruiter_email=${encodeURIComponent(this.recruiterEmail)}`);
                const d = await r.json();
                this.pipelines = (d && d.pipelines) ? d.pipelines : [];
                this._renderRoleOptions('');
            } catch (e) {
                console.error('[QI] loadPipelines failed:', e);
                $('qi-role-options').innerHTML = '<div class="qi-role-empty">Could not load roles. Try again.</div>';
            }
        },

        _renderRoleOptions(query) {
            const box = $('qi-role-options');
            const q = (query || '').trim().toLowerCase();
            // Filter out roles that are closed/hired so we don't route candidates to a frozen role.
            const list = this.pipelines.filter(p => {
                const cfg = p.config || {};
                const isHired = (cfg.outcome === 'hired');
                const isPaused = (p.paused === true || p.status === 'paused');
                if (isHired || isPaused) return false;
                if (!q) return true;
                return ((p.hiring_role || '').toLowerCase().includes(q)
                     || (p.company_name || '').toLowerCase().includes(q));
            });
            if (!list.length) {
                box.innerHTML = `<div class="qi-role-empty">${q ? 'No matching roles.' : 'No active roles yet. Create one from the dashboard first.'}</div>`;
                return;
            }
            box.innerHTML = list.map(p => {
                const role = esc(upper(p.hiring_role || 'Role'));
                const meta = [p.company_name, p.job_location].filter(Boolean).map(esc).join(' · ');
                return `
                    <div class="qi-role-option" data-id="${esc(p.pipeline_id)}">
                        <span class="qi-role-option-title">${role}</span>
                        ${meta ? `<span class="qi-role-option-meta">${meta}</span>` : ''}
                    </div>
                `;
            }).join('');

            box.querySelectorAll('.qi-role-option').forEach(el => {
                el.addEventListener('click', () => this._pickRole(el.getAttribute('data-id')));
            });
        },

        async _pickRole(pipelineId) {
            const pipe = this.pipelines.find(p => p.pipeline_id === pipelineId);
            if (!pipe) return;
            this.selectedPipelineId = pipelineId;
            this.selectedRole = pipe;

            const trigger = $('qi-role-trigger');
            $('qi-role-text').textContent = upper(pipe.hiring_role || 'Role') + (pipe.company_name ? ' · ' + pipe.company_name : '');
            trigger.classList.add('has-value');
            trigger.classList.remove('open');
            $('qi-role-menu').classList.add('hidden');

            $('qi-role-hint').classList.remove('hidden');
            $('qi-role-hint-text').textContent = 'Loading the interview panel for this role…';

            try {
                const r = await fetch(`${API}/api/pipeline/status/${encodeURIComponent(pipelineId)}`);
                const d = await r.json();
                const status = d && d.pipeline ? d.pipeline : {};
                let cfg = status.config || {};
                if (typeof cfg === 'string') {
                    try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; }
                }
                const panel = cfg.recruiter_panel || null;

                if (panel && (panel.main_agents || []).length) {
                    const agents = [...(panel.main_agents || []), ...(panel.core_values || [])];
                    this._setSuggestedAgents(agents);
                    $('qi-role-hint-text').textContent = 'Using the interview panel you saved for this role. Tap any agent to add or remove.';
                } else {
                    $('qi-role-hint-text').textContent = 'No saved panel yet — asking AI to suggest one…';
                    const sr = await fetch(`${API}/api/pipeline/${encodeURIComponent(pipelineId)}/suggest-interviewers`);
                    const sd = await sr.json();
                    if (sd && sd.success) {
                        const agents = [...(sd.main_agents || []), ...(sd.core_values || [])];
                        this._setSuggestedAgents(agents);
                        $('qi-role-hint-text').textContent = 'AI picked these agents based on the JD. Tap to adjust.';
                    } else {
                        this._setSuggestedAgents(['priya', 'rajesh', 'deepa']);
                        $('qi-role-hint-text').textContent = 'Showing a balanced default panel. Adjust as needed.';
                    }
                }
            } catch (e) {
                console.error('[QI] pickRole failed:', e);
                this._setSuggestedAgents(['priya', 'rajesh', 'deepa']);
                $('qi-role-hint-text').textContent = 'Showing a default panel — could not reach AI right now.';
            }

            this._renderInterviewers();
            this._refreshSubmitState();
        },

        _setSuggestedAgents(agentIds) {
            // Always force priya — she opens every interview
            const ids = Array.from(new Set(['priya', ...(agentIds || []).filter(Boolean)]));
            this.suggestedAgents = new Set(ids);
            this.selectedAgents = new Set(ids);
        },

        _renderInterviewers() {
            const grid = $('qi-int-grid');
            if (!this.selectedPipelineId) {
                grid.innerHTML = `<div class="qi-int-placeholder">Pick a role first — we'll suggest the right interview panel for it.</div>`;
                $('qi-int-toggle').classList.add('hidden');
                return;
            }

            const showFull = this.showAllAgents;
            const baseIds = showFull
                ? [...Object.keys(AGENT_CATALOG), ...Object.keys(CV_CATALOG)]
                : Array.from(this.suggestedAgents);

            const visible = new Set(baseIds);
            this.selectedAgents.forEach(id => visible.add(id));

            const list = Array.from(visible);
            grid.innerHTML = list.map((id, i) => {
                const isCV = id.startsWith('cv_');
                const entry = isCV ? CV_CATALOG[id] : AGENT_CATALOG[id];
                if (!entry) return '';
                const name = entry.name;
                const tag = entry.role;
                const initial = name.charAt(0).toUpperCase();
                const grad = GRAD_CLASSES[i % GRAD_CLASSES.length];
                const selected = this.selectedAgents.has(id) ? ' is-selected' : '';
                return `
                    <div class="qi-int-card${selected}" data-id="${esc(id)}" title="${esc(name)} · ${esc(tag)}">
                        <div class="qi-int-top">
                            <div class="qi-int-avatar ${grad}">${esc(initial)}</div>
                            <span class="qi-int-tick"></span>
                        </div>
                        <div class="qi-int-body">
                            <span class="qi-int-name">${esc(name)}</span>
                            <span class="qi-int-tag">${esc(tag)}</span>
                        </div>
                    </div>
                `;
            }).join('');

            grid.querySelectorAll('.qi-int-card').forEach(el => {
                el.addEventListener('click', () => this._toggleAgent(el.getAttribute('data-id')));
            });

            const toggleBtn = $('qi-int-toggle');
            toggleBtn.classList.remove('hidden');
            toggleBtn.textContent = this.showAllAgents ? 'Show suggested only' : 'Show all agents';
        },

        _toggleAgent(id) {
            if (!id) return;
            if (id === 'priya') {
                this._toast("Priya is the HR opener and stays on every panel.");
                return;
            }
            if (this.selectedAgents.has(id)) this.selectedAgents.delete(id);
            else this.selectedAgents.add(id);
            this._renderInterviewers();
            this._refreshSubmitState();
        },

        _refreshSubmitState() {
            const ok = !!(this.resumeFile && this.selectedPipelineId && $('qi-name').value.trim() && $('qi-email').value.trim());
            $('qi-submit').disabled = !ok;
        },

        _wireForm() {
            const dz = $('qi-dropzone');
            const file = $('qi-resume');
            const fn = $('qi-dz-filename');

            const setFile = f => {
                this.resumeFile = f;
                if (f) {
                    fn.textContent = f.name;
                    fn.classList.remove('hidden');
                    dz.classList.add('has-file');
                } else {
                    fn.textContent = '';
                    fn.classList.add('hidden');
                    dz.classList.remove('has-file');
                }
                this._refreshSubmitState();
            };

            // Open file picker on dropzone click (the <label> already triggers
            // the hidden input, but this also covers programmatic events).
            file.addEventListener('change', e => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) { this._toast('Resume must be under 5 MB.', 'error'); return; }
                if (!/\.(pdf|doc|docx)$/i.test(f.name)) { this._toast('Only PDF / DOC / DOCX allowed.', 'error'); return; }
                setFile(f);
            });

            ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
                e.preventDefault(); dz.classList.add('is-drag');
            }));
            ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
                e.preventDefault(); dz.classList.remove('is-drag');
            }));
            dz.addEventListener('drop', e => {
                const f = e.dataTransfer.files && e.dataTransfer.files[0];
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) { this._toast('Resume must be under 5 MB.', 'error'); return; }
                if (!/\.(pdf|doc|docx)$/i.test(f.name)) { this._toast('Only PDF / DOC / DOCX allowed.', 'error'); return; }
                setFile(f);
            });

            $('qi-name').addEventListener('input', () => this._refreshSubmitState());
            $('qi-email').addEventListener('input', () => this._refreshSubmitState());
            $('qi-phone').addEventListener('input', () => this._refreshSubmitState());

            $('qi-role-trigger').addEventListener('click', e => {
                e.stopPropagation();
                const menu = $('qi-role-menu');
                const isHidden = menu.classList.toggle('hidden');
                $('qi-role-trigger').classList.toggle('open', !isHidden);
                if (!isHidden) setTimeout(() => $('qi-role-search').focus(), 50);
            });
            $('qi-role-search').addEventListener('input', e => {
                this._renderRoleOptions(e.target.value);
            });

            $('qi-int-toggle').addEventListener('click', () => {
                this.showAllAgents = !this.showAllAgents;
                this._renderInterviewers();
            });
        },

        async _maybeSavePanelOverride() {
            // If recruiter changed the suggested panel, persist the override at the
            // pipeline level so build_interview_for_candidate uses it for this referral.
            const current = Array.from(this.selectedAgents).sort();
            const original = Array.from(this.suggestedAgents).sort();
            if (current.length === original.length && current.every((v, i) => v === original[i])) {
                return;
            }
            const main_agents = current.filter(id => !id.startsWith('cv_'));
            const core_values = current.filter(id => id.startsWith('cv_'));
            try {
                await fetch(`${API}/api/pipeline/${encodeURIComponent(this.selectedPipelineId)}/interviewers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ main_agents, core_values }),
                });
            } catch (e) {
                console.error('[QI] save panel override failed (non-fatal):', e);
            }
        },

        async submit() {
            if ($('qi-submit').disabled) return;
            const name = $('qi-name').value.trim();
            const email = $('qi-email').value.trim();
            const phone = $('qi-phone').value.trim();
            if (!name || !email) { this._toast('Name and email are required.', 'error'); return; }
            // Shared field validation (name = letters only, valid email, valid phone).
            if (window.HXAValidate) {
                const v = window.HXAValidate.validateAll($('qi-name').closest('.qi-input-grid') || document);
                if (!v.valid) { if (v.firstInvalid && v.firstInvalid.focus) v.firstInvalid.focus(); this._toast('Please fix the highlighted fields.', 'error'); return; }
            }
            if (!this.resumeFile) { this._toast('Drop a resume to continue.', 'error'); return; }
            if (!this.selectedPipelineId) { this._toast('Pick a role first.', 'error'); return; }

            const btn = $('qi-submit');
            const label = $('qi-submit-label');
            btn.disabled = true;
            label.textContent = 'Sending…';

            try {
                await this._maybeSavePanelOverride();

                const fd = new FormData();
                fd.append('candidate_name', name);
                fd.append('candidate_email', email);
                if (phone) fd.append('candidate_phone', phone);
                fd.append('referred_by', this.recruiterEmail || 'Quick Interview');
                // Quick Interview is an explicit "send the invite now" action,
                // so opt into the immediate-fire branch on the backend.
                fd.append('fire_invite', 'true');
                fd.append('resume', this.resumeFile);

                const r = await fetch(`${API}/api/pipeline/${encodeURIComponent(this.selectedPipelineId)}/add-referral`, {
                    method: 'POST',
                    body: fd,
                });
                const d = await r.json();
                if (!r.ok || !d.success) {
                    throw new Error(d.detail || d.message || 'Server rejected the referral.');
                }
                this._toast(`${name} added — interview invite is on its way.`, 'success');
                setTimeout(() => {
                    window.location.href = `/f9pj?id=${encodeURIComponent(this.selectedPipelineId)}`;
                }, 1200);
            } catch (e) {
                console.error('[QI] submit failed:', e);
                this._toast(e.message || 'Could not send the invite. Try again.', 'error');
                btn.disabled = false;
                label.textContent = 'Send interview invite';
            }
        },
    };

    window.QI = QI;
    document.addEventListener('DOMContentLoaded', async () => {
        QI._initUser();
        QI._wireForm();
        // Load the org's custom interviewer agents before pipelines / deep-link
        // auto-pick, so the panel can render + select them from the first paint.
        await QI._loadCustomAgents();
        await QI._loadPipelines();
        // Deep-link from /hiring-dashboard's "+ Add Candidate" button (and
        // anywhere else that wants to drop the recruiter here with a role
        // already chosen): /p8eu?pipeline=<id> auto-picks that role so the
        // "Interview for" dropdown is set and the panel loads automatically.
        const preselectId = new URLSearchParams(window.location.search).get('pipeline');
        if (preselectId && QI.pipelines.some(p => p.pipeline_id === preselectId)) {
            await QI._pickRole(preselectId);
        }
    });
})();
