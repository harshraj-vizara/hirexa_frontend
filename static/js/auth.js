/**
 * Scoreniq - Authentication Module
 * Handles login, register, and password reset
 */

const Auth = {
    currentEmail: '',
    API_BASE: window.location.origin,
    googleClientId: null,

    // Organisation setup state
    selectedCoreValues: [],
    MAX_CORE_VALUES: 5,
    // Custom core-value agents drafted during workplace setup (held client-side
    // because the org row does not exist yet; persisted on org-setup submit).
    customAgents: [],
    _voiceCatalog: null,

    // The 25 core-value interviewer agents (mirrors CORE_VALUES_AGENTS in
    // src/screening_round_interview.py). id -> submitted value; name -> label;
    // agent -> the evaluator persona shown as the card subtitle.
    CORE_VALUES: [
        { id: 'cv_integrity',       name: 'Integrity',                agent: 'Kavita Verma' },
        { id: 'cv_innovation',      name: 'Innovation',               agent: 'Rohit Bansal' },
        { id: 'cv_accountability',  name: 'Accountability',           agent: 'Nisha Patel' },
        { id: 'cv_honesty',         name: 'Honesty',                  agent: 'Aditya Rao' },
        { id: 'cv_respect',         name: 'Respect',                  agent: 'Sunita Joshi' },
        { id: 'cv_passion',         name: 'Passion',                  agent: 'Karan Malhotra' },
        { id: 'cv_customer_focus',  name: 'Customer Focus',           agent: 'Ritu Agarwal' },
        { id: 'cv_excellence',      name: 'Excellence',               agent: 'Manish Tiwari' },
        { id: 'cv_teamwork',        name: 'Teamwork & Collaboration', agent: 'Pooja Saxena' },
        { id: 'cv_transparency',    name: 'Transparency',             agent: 'Naveen Kumar' },
        { id: 'cv_diversity',       name: 'Diversity & Inclusion',    agent: 'Shreya Menon' },
        { id: 'cv_learning',        name: 'Continuous Learning',      agent: 'Amit Chandra' },
        { id: 'cv_adaptability',    name: 'Adaptability & Agility',   agent: 'Swati Deshmukh' },
        { id: 'cv_ownership',       name: 'Ownership Mindset',        agent: 'Harsh Jain' },
        { id: 'cv_empathy',         name: 'Empathy',                  agent: 'Anjali Bhatt' },
        { id: 'cv_courage',         name: 'Courage',                  agent: 'Vivek Sinha' },
        { id: 'cv_results',         name: 'Results Orientation',      agent: 'Tanvi Kulkarni' },
        { id: 'cv_simplicity',      name: 'Simplicity',               agent: 'Suresh Pillai' },
        { id: 'cv_social_resp',     name: 'Social Responsibility',    agent: 'Divya Nambiar' },
        { id: 'cv_sustainability',  name: 'Sustainability',           agent: 'Pranav Hegde' },
        { id: 'cv_communication',   name: 'Communication',            agent: 'Lata Mishra' },
        { id: 'cv_leadership',      name: 'Leadership',               agent: 'Gaurav Thakur' },
        { id: 'cv_fairness',        name: 'Fairness & Equity',        agent: 'Rekha Dasgupta' },
        { id: 'cv_creativity',      name: 'Creativity',               agent: 'Siddharth Mohan' },
        { id: 'cv_community',       name: 'Community & Belonging',    agent: 'Isha Rawat' },
    ],
    CV_GRADIENTS: [
        'linear-gradient(141.93deg, #DE9CA7 58.77%, #FFD7DD 98.19%)', // pink
        'linear-gradient(141.93deg, #8A7CF0 58.77%, #C3BCFA 98.19%)', // purple
        'linear-gradient(141.93deg, #5BB4E3 58.77%, #B8E2F7 98.19%)', // blue
        'linear-gradient(141.93deg, #79C28C 58.77%, #C2E8CD 98.19%)', // green
        'linear-gradient(141.93deg, #F2B33D 58.77%, #FBE0A6 98.19%)', // amber
        'linear-gradient(141.93deg, #E1786F 58.77%, #F6C2BC 98.19%)', // coral
        'linear-gradient(141.93deg, #4CABF6 58.77%, #B6DEFB 98.19%)', // sky
        'linear-gradient(141.93deg, #B07CD0 58.77%, #E2C6F0 98.19%)', // violet
    ],

    init() {
        this.bindEvents();
        // A Microsoft redirect carries its result in the URL fragment; handle it
        // before checkAuth so a brand-new user lands on org setup, not the
        // dashboard. If a fragment was consumed, skip the redirect-if-logged-in.
        if (this.initOAuthResume()) {
            this.initGoogleAuth();
            return;
        }
        this.checkAuth();
        this.maybeOpenLoginModal();
        this.initGoogleAuth();
    },

    // Open the login window directly (instead of the landing hero) when:
    //  - ?login=1  → invited recruiters' email link
    //  - ?msg=...  → an auto-logout bounce (e.g. account deleted), with the
    //                reason shown inside the login panel.
    maybeOpenLoginModal() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const msg = params.get('msg');
            if ((params.get('login') === '1' || msg) && typeof this.openModal === 'function') {
                this.openModal('login');
            }
            if (msg) {
                if (typeof this.showLoginMsg === 'function') this.showLoginMsg(msg, 'error');
                // Drop the query so a refresh doesn't keep re-showing it.
                try { history.replaceState(null, '', window.location.pathname); } catch (_) {}
            }
        } catch (_) {}
    },

    bindEvents() {
        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Form submissions
        document.getElementById('login-form')?.addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('setpw-form')?.addEventListener('submit', (e) => this.handleSetPassword(e));
        document.getElementById('register-form')?.addEventListener('submit', (e) => this.handleRegister(e));
        document.getElementById('orgsetup-form')?.addEventListener('submit', (e) => this.handleOrgSetup(e));
        document.getElementById('orgotp-form')?.addEventListener('submit', (e) => this.handleOrgOTP(e));
        document.getElementById('verify-form')?.addEventListener('submit', (e) => this.handleVerifyOTP(e));
        document.getElementById('forgot-form')?.addEventListener('submit', (e) => this.handleForgotPassword(e));
        document.getElementById('reset-form')?.addEventListener('submit', (e) => this.handleResetPassword(e));

        // Clear register inline error as the user corrects fields
        ['register-name', 'register-email', 'register-password'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('input', () => this.clearFieldError('register-error', ['register-email', 'register-password']));
        });

        // Core Values: render the agent cards and wire the dropdown toggle
        this.renderCoreValueCards();
        const cvTrigger = document.getElementById('org-values-trigger');
        cvTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCoreValuesPanel();
        });
        // Close the panel when clicking outside the multi-select
        document.addEventListener('click', (e) => {
            const ms = document.getElementById('org-values-ms');
            if (ms && !ms.contains(e.target)) this.closeCoreValuesPanel();
        });

        // Create-your-own core-value agent builder
        document.getElementById('orgcv-create-form')?.addEventListener('submit', (e) => this.handleCreateAgent(e));
        document.getElementById('orgcv-back')?.addEventListener('click', () => this.backToOrgSetup());
        document.getElementById('orgcv-preview')?.addEventListener('click', () => this.previewVoice());
        document.getElementById('orgcv-gender')?.addEventListener('change', () => { this._stopVoicePreview(); this.populateVoiceOptions(); });
        document.getElementById('orgcv-voice')?.addEventListener('change', () => this._stopVoicePreview());

        // Company logo upload: reflect the chosen file name
        const orgLogo = document.getElementById('org-logo');
        orgLogo?.addEventListener('change', () => {
            const label = document.getElementById('org-logo-label');
            const text = document.getElementById('org-logo-text');
            const file = orgLogo.files && orgLogo.files[0];
            if (file) {
                text.textContent = this.shortenFileName(file.name, 30);
                text.title = file.name; // full name on hover
                label.classList.add('has-file');
            } else {
                text.textContent = 'Upload Company Logo (Optional)';
                text.removeAttribute('title');
                label.classList.remove('has-file');
            }
        });

        // OTP input auto-focus
        this.setupOTPInputs();
    },

    checkAuth() {
        const user = localStorage.getItem('fluenzoUser');
        if (user) {
            window.location.href = '/b4kx';
        }
    },

    switchTab(tabName) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');

        // Move tab indicator
        const indicator = document.querySelector('.tab-indicator');
        if (indicator) {
            indicator.style.transform = tabName === 'register' ? 'translateX(100%)' : 'translateX(0)';
        }

        this.hideAllPanels();
        document.getElementById(`${tabName}-panel`)?.classList.add('active');
        const tabsEl = document.getElementById('auth-tabs');
        if (tabsEl) tabsEl.style.display = 'flex';
        this.hideMessage();
        this.clearLoginMsg();
    },

    hideAllPanels() {
        document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
        // Clear any transient status message so it doesn't linger on the next panel.
        document.querySelectorAll('[data-auth-msg]').forEach(el => {
            el.textContent = '';
            el.classList.remove('show', 'success', 'error');
        });
    },

    showPanel(panelId) {
        this.hideAllPanels();
        document.getElementById(panelId)?.classList.add('active');
        const tabsEl = document.getElementById('auth-tabs');
        if (tabsEl) tabsEl.style.display = 'none';
    },

    // Status feedback (errors, "Signing in…", "Login successful") is shown in the
    // message slot INSIDE the currently active modal panel — login, signup,
    // verify, etc. — so it never lands on the page banner behind the open modal.
    // Only when the modal is closed (e.g. a redirect landed with ?msg=…) does it
    // fall back to the hero banner.
    showMessage(text, type = 'error') {
        const modalOpen = document.getElementById('auth-modal')?.classList.contains('show');
        const panel = document.querySelector('.auth-panel.active');
        const el = panel && panel.querySelector('[data-auth-msg]');
        if (modalOpen && el) {
            this.renderPanelMsg(el, text, type);
            return;
        }
        const alert = document.getElementById('auth-alert');
        if (alert) {
            alert.textContent = text;
            alert.className = `alert alert-${type} show`;
            setTimeout(() => this.hideMessage(), 5000);
        }
    },

    // Write a status message into a panel's slot. Works for both the boxed-now-
    // plain .auth-inline-msg elements and the .reg-error elements (signup flow).
    renderPanelMsg(el, text, type = 'error') {
        el.textContent = text || '';
        if (el.classList.contains('reg-error')) {
            el.classList.toggle('show', !!text);
            el.classList.toggle('success', type === 'success');
        } else {
            el.className = 'auth-inline-msg' + (text ? ' show ' + type : '');
        }
    },

    hideMessage() {
        const alert = document.getElementById('auth-alert');
        if (alert) {
            alert.className = 'alert';
        }
    },

    // Login feedback shown INSIDE the modal's login panel (not the hero page
    // banner that sits behind the modal). Falls back to the page banner if the
    // inline element isn't present.
    showLoginMsg(text, type = 'error') {
        const el = document.getElementById('login-msg');
        if (!el) { this.showMessage(text, type); return; }
        el.textContent = text;
        el.className = 'auth-inline-msg show ' + type;
    },

    clearLoginMsg() {
        const el = document.getElementById('login-msg');
        if (el) { el.textContent = ''; el.className = 'auth-inline-msg'; }
    },

    // ==================== Validation ====================

    // Free / personal email providers that are NOT valid company domains.
    FREE_EMAIL_DOMAINS: new Set([
        'gmail.com', 'googlemail.com',
        'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
        'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
        'aol.com', 'icloud.com', 'me.com', 'mac.com',
        'protonmail.com', 'proton.me', 'pm.me',
        'zoho.com', 'zohomail.com', 'gmx.com', 'gmx.net', 'mail.com',
        'yandex.com', 'yandex.ru', 'tutanota.com', 'fastmail.com',
        'rediffmail.com', 'rediff.com'
    ]),

    // A work email must be well-formed and on a real company domain (not a
    // personal/free provider like gmail.com, e.g. harsh.raj@vizaratech.com).
    isCompanyEmail(email) {
        const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(String(email || '').trim().toLowerCase());
        if (!match) return false;
        return !this.FREE_EMAIL_DOMAINS.has(match[1]);
    },

    // Password: at least 8 chars, with both letters and numbers.
    isValidPassword(pw) {
        pw = String(pw || '');
        return pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
    },

    showFieldError(errorId, message, inputIds = []) {
        const el = document.getElementById(errorId);
        if (el) {
            el.textContent = message;
            el.classList.remove('success');  // a validation error is never green
            el.classList.add('show');
        }
        inputIds.forEach(id => document.getElementById(id)?.classList.add('has-error'));
    },

    clearFieldError(errorId, inputIds = []) {
        const el = document.getElementById(errorId);
        if (el) {
            el.textContent = '';
            el.classList.remove('show', 'success');
        }
        inputIds.forEach(id => document.getElementById(id)?.classList.remove('has-error'));
    },

    // Middle-truncate a filename so the extension stays visible
    // e.g. "vizara_logo_final_version.jpg" -> "vizara_logo_final_v….jpg"
    shortenFileName(name, max = 30) {
        if (!name || name.length <= max) return name;
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 ? name.slice(dot) : '';
        const base = dot > 0 ? name.slice(0, dot) : name;
        const keep = Math.max(4, max - ext.length - 1);
        return base.slice(0, keep) + '…' + ext;
    },

    // ==================== Core Values picker ====================

    renderCoreValueCards() {
        const grid = document.getElementById('org-values-grid');
        if (!grid) return;
        const cards = this.CORE_VALUES.map((cv, i) => {
            const gradient = this.CV_GRADIENTS[i % this.CV_GRADIENTS.length];
            const initial = (cv.name || '?').charAt(0).toUpperCase();
            return `
                <button type="button" class="reg-cv-card" data-cv="${cv.id}">
                    <span class="reg-cv-avatar" style="background:${gradient}">${initial}</span>
                    <span class="reg-cv-name">${cv.name}</span>
                </button>`;
        });
        // "Create your own" entry — opens the custom-agent builder.
        cards.push(`
            <button type="button" class="reg-cv-card reg-cv-create" id="org-cv-create-card">
                <span class="reg-cv-avatar">+</span>
                <span class="reg-cv-name">Create your own</span>
            </button>`);
        grid.innerHTML = cards.join('');

        grid.querySelectorAll('.reg-cv-card[data-cv]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCoreValue(card.dataset.cv);
            });
        });
        document.getElementById('org-cv-create-card')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openCreateAgentPanel();
        });
        this.updateCoreValuesUI();
    },

    toggleCoreValue(id) {
        const idx = this.selectedCoreValues.indexOf(id);
        if (idx >= 0) {
            this.selectedCoreValues.splice(idx, 1);
        } else {
            if (this.selectedCoreValues.length >= this.MAX_CORE_VALUES) return; // cap at 10
            this.selectedCoreValues.push(id);
        }
        this.clearFieldError('orgsetup-error');
        this.updateCoreValuesUI();
    },

    updateCoreValuesUI() {
        const selected = this.selectedCoreValues;
        const atLimit = selected.length >= this.MAX_CORE_VALUES;

        // Card highlight + disable unselected ones once the limit is reached.
        // The "Create your own" card has no data-cv, so it is never disabled.
        document.querySelectorAll('#org-values-grid .reg-cv-card[data-cv]').forEach(card => {
            const isSel = selected.includes(card.dataset.cv);
            card.classList.toggle('selected', isSel);
            card.classList.toggle('disabled', atLimit && !isSel);
        });

        // Count badge
        const count = document.getElementById('org-values-count');
        if (count) {
            count.textContent = `${selected.length}/${this.MAX_CORE_VALUES}`;
            count.classList.toggle('at-limit', atLimit);
        }

        // Trigger label
        const label = document.getElementById('org-values-label');
        if (label) {
            if (!selected.length) {
                label.textContent = 'Core Values';
                label.classList.remove('has-value');
            } else {
                const names = selected
                    .map(id => (this.CORE_VALUES.find(c => c.id === id) || {}).name)
                    .filter(Boolean);
                label.textContent = names.length <= 2
                    ? names.join(', ')
                    : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
                label.classList.add('has-value');
            }
        }
    },

    toggleCoreValuesPanel() {
        const panel = document.getElementById('org-values-panel');
        if (!panel) return;
        panel.hidden ? this.openCoreValuesPanel() : this.closeCoreValuesPanel();
    },

    openCoreValuesPanel() {
        document.getElementById('org-values-panel')?.removeAttribute('hidden');
        document.getElementById('org-values-trigger')?.setAttribute('aria-expanded', 'true');
    },

    closeCoreValuesPanel() {
        document.getElementById('org-values-panel')?.setAttribute('hidden', '');
        document.getElementById('org-values-trigger')?.setAttribute('aria-expanded', 'false');
    },

    // ==================== Create-your-own core-value agent ====================

    async openCreateAgentPanel() {
        this.closeCoreValuesPanel();
        this._stopVoicePreview();
        // Reset the form
        ['orgcv-value', 'orgcv-agent', 'orgcv-desc'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const gender = document.getElementById('orgcv-gender');
        if (gender) gender.value = 'female';
        this.clearFieldError('orgcv-error');
        this.showPanel('orgcv-create-panel');
        await this.populateVoiceOptions();
    },

    backToOrgSetup() {
        this._stopVoicePreview();
        this.showPanel('orgsetup-panel');
    },

    // Fetch the curated Sarvam voice catalog once and cache it.
    async loadVoiceCatalog() {
        if (this._voiceCatalog) return this._voiceCatalog;
        try {
            const res = await fetch(`${this.API_BASE}/api/core-value-agents/voices`);
            const data = await res.json();
            this._voiceCatalog = Array.isArray(data.voices) ? data.voices : [];
        } catch (_) {
            this._voiceCatalog = [];
        }
        return this._voiceCatalog;
    },

    // Fill the voice <select> with the speakers matching the chosen gender.
    async populateVoiceOptions() {
        const sel = document.getElementById('orgcv-voice');
        if (!sel) return;
        const gender = (document.getElementById('orgcv-gender') || {}).value || 'female';
        const catalog = await this.loadVoiceCatalog();
        const voices = catalog.filter(v => v.gender === gender);
        sel.innerHTML = voices.map(v => `<option value="${v.voice}">${v.label}</option>`).join('')
            || '<option value="">No voices available</option>';
    },

    // Swap the preview button between its three clear states so the user always
    // knows what a click will do: idle (play icon) -> loading (spinner) ->
    // playing (pause icon, click to stop).
    _PV_ICONS: {
        idle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
        playing: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="15" y="5" width="4" height="14" rx="1"/></svg>',
        loading: '<span class="reg-voice-spin" aria-hidden="true"></span>',
    },
    _setPreviewState(state) {
        const btn = document.getElementById('orgcv-preview');
        if (!btn) return;
        btn.dataset.pvState = state;
        btn.classList.toggle('playing', state === 'playing');
        btn.classList.toggle('loading', state === 'loading');
        btn.innerHTML = this._PV_ICONS[state] || this._PV_ICONS.idle;
        btn.setAttribute('aria-label',
            state === 'playing' ? 'Stop voice sample'
            : state === 'loading' ? 'Loading voice sample'
            : 'Play voice sample');
    },

    _stopVoicePreview() {
        // Bump the token so any in-flight fetch resolves into a no-op.
        this._previewToken = (this._previewToken || 0) + 1;
        if (this._previewAudio) {
            try { this._previewAudio.pause(); } catch (_) {}
            this._previewAudio = null;
        }
        this._setPreviewState('idle');
    },

    async previewVoice() {
        const btn = document.getElementById('orgcv-preview');
        const state = btn ? btn.dataset.pvState : 'idle';
        // A click while loading or playing stops it (true toggle).
        if (state === 'playing' || state === 'loading') {
            this._stopVoicePreview();
            return;
        }
        const sel = document.getElementById('orgcv-voice');
        const voice = sel && sel.value;
        if (!voice) return;

        const token = (this._previewToken || 0) + 1;
        this._previewToken = token;
        this._setPreviewState('loading');
        try {
            const res = await fetch(`${this.API_BASE}/api/core-value-agents/voice-preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice }),
            });
            if (token !== this._previewToken) return;   // superseded/stopped
            if (!res.ok) throw new Error('preview failed');
            const blob = await res.blob();
            if (token !== this._previewToken) return;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            this._previewAudio = audio;
            audio.onended = () => { URL.revokeObjectURL(url); if (token === this._previewToken) this._stopVoicePreview(); };
            await audio.play();
            if (token !== this._previewToken) { try { audio.pause(); } catch (_) {} return; }
            this._setPreviewState('playing');
        } catch (_) {
            if (token === this._previewToken) {
                this._setPreviewState('idle');
                this.showFieldError('orgcv-error', 'Could not play a sample for this voice. Please try another.');
            }
        }
    },

    // Validate + draft a custom agent (AI dup-check + template), then add it to
    // the picker and return to the org-setup step with it selected.
    async handleCreateAgent(e) {
        e.preventDefault();
        const valueName = document.getElementById('orgcv-value').value.trim();
        const agentName = document.getElementById('orgcv-agent').value.trim();
        const gender = document.getElementById('orgcv-gender').value;
        const voice = document.getElementById('orgcv-voice').value;
        const description = document.getElementById('orgcv-desc').value.trim();

        this.clearFieldError('orgcv-error');
        if (!valueName) return this.showFieldError('orgcv-error', 'Please enter a core value name.');
        if (!agentName) return this.showFieldError('orgcv-error', 'Please enter an agent name.');
        if (!voice) return this.showFieldError('orgcv-error', 'Please choose a voice.');

        const ownerEmail = this.pendingSignup ? this.pendingSignup.email
            : (this.pendingOAuth ? this.pendingOAuth.email : null);

        this.setLoading('orgcv-save', true);
        try {
            const res = await fetch(`${this.API_BASE}/api/core-value-agents/draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    value_name: valueName,
                    agent_name: agentName,
                    gender, voice, description,
                    existing_customs: this.customAgents.map(a => a.value_name),
                    email: ownerEmail,
                }),
            });
            const data = await res.json().catch(() => ({}));
            this.setLoading('orgcv-save', false);

            if (res.status === 409) {
                // Hard block — a semantically similar value already exists.
                return this.showFieldError('orgcv-error', data.detail || 'A similar core value already exists. Please describe a distinct one.');
            }
            if (!res.ok || !data.agent) {
                return this.showFieldError('orgcv-error', data.detail || 'Could not create the agent. Please try again.');
            }

            const agent = data.agent;
            // Keep the full draft (sent to the backend on org-setup submit) ...
            this.customAgents.push(agent);
            // ... and add a card to the picker catalog.
            this.CORE_VALUES.push({ id: agent.agent_id, name: agent.value_name, agent: agent.agent_name, custom: true });
            this.renderCoreValueCards();

            // Auto-select it if there's room under the cap.
            if (this.selectedCoreValues.length < this.MAX_CORE_VALUES) {
                this.selectedCoreValues.push(agent.agent_id);
            }
            this._stopVoicePreview();
            this.showPanel('orgsetup-panel');
            this.updateCoreValuesUI();
            if (this.selectedCoreValues.indexOf(agent.agent_id) === -1) {
                this.showFieldError('orgsetup-error', `Created ${agent.value_name}. You already have ${this.MAX_CORE_VALUES} selected — deselect one to add it.`);
            }
        } catch (err) {
            this.setLoading('orgcv-save', false);
            this.showFieldError('orgcv-error', 'Connection error. Please try again.');
        }
    },

    setLoading(btnId, loading) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span>';
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText || 'Submit';
        }
    },

    setupOTPInputs() {
        document.querySelectorAll('.otp-input-single').forEach((input, index, inputs) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1 && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });
    },

    getOTPValue(containerId) {
        const inputs = document.querySelectorAll(`#${containerId} .otp-input-single`);
        return Array.from(inputs).map(i => i.value).join('');
    },

    clearOTPInputs(containerId) {
        document.querySelectorAll(`#${containerId} .otp-input-single`).forEach(i => i.value = '');
    },

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        this.currentEmail = email;
        this.clearLoginMsg();
        this.setLoading('login-btn', true);

        try {
            const res = await fetch(`${this.API_BASE}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (res.ok && data.must_reset) {
                // Invited team member's first login — make them set a password.
                this.pendingReset = { email, tempPassword: password };
                this.showPanel('setpw-panel');
                setTimeout(() => document.getElementById('setpw-new')?.focus(), 50);
            } else if (res.ok) {
                localStorage.setItem('fluenzoUser', JSON.stringify(data.user));
                this.showLoginMsg('Login successful! Redirecting...', 'success');
                setTimeout(() => window.location.href = '/b4kx', 1000);
            } else if (res.status === 403) {
                // Email not verified — switch to the verify panel, whose header
                // ("Check your email") already explains what to do.
                this.showPanel('verify-panel');
            } else {
                this.showLoginMsg(data.detail || 'Invalid email or password', 'error');
            }
        } catch (err) {
            this.showLoginMsg('Connection error. Please try again.', 'error');
        }

        this.setLoading('login-btn', false);
    },

    // First-login: invited member sets their own password, then is signed in.
    async handleSetPassword(e) {
        e.preventDefault();
        const newPw = document.getElementById('setpw-new').value;
        const confirm = document.getElementById('setpw-confirm').value;
        if (!this.pendingReset) { this.switchTab('login'); return; }

        if (!this.isValidPassword(newPw)) {
            this.showMessage('Password must be at least 8 characters and include letters and numbers.', 'error');
            return;
        }
        if (newPw !== confirm) {
            this.showMessage('Passwords do not match.', 'error');
            return;
        }

        this.setLoading('setpw-btn', true);
        try {
            const res = await fetch(`${this.API_BASE}/api/set-initial-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: this.pendingReset.email,
                    current_password: this.pendingReset.tempPassword,
                    new_password: newPw
                })
            });
            const data = await res.json();
            if (res.ok) {
                localStorage.setItem('fluenzoUser', JSON.stringify(data.user));
                this.pendingReset = null;
                this.showMessage('Password set! Redirecting...', 'success');
                setTimeout(() => window.location.href = '/b4kx', 800);
            } else {
                this.showMessage(data.detail || 'Could not set password.', 'error');
            }
        } catch (err) {
            this.showMessage('Connection error. Please try again.', 'error');
        }
        this.setLoading('setpw-btn', false);
    },

    // Step 1 of manual signup: validate the recruiter's details, then open the
    // organisation-setup step. The account is created once step 2 is submitted
    // (backend wiring for step 2 is added separately).
    handleRegister(e) {
        e.preventDefault();
        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;

        this.clearFieldError('register-error', ['register-name', 'register-email', 'register-password']);

        if (!name) {
            this.showFieldError('register-error', 'Please enter your name.', ['register-name']);
            return;
        }
        if (window.HXAValidate && !window.HXAValidate.check(document.getElementById('register-name'), false)) {
            this.showFieldError('register-error', 'Please enter a valid name (letters only).', ['register-name']);
            return;
        }
        if (!this.isCompanyEmail(email)) {
            this.showFieldError(
                'register-error',
                'Please enter your work email using your company domain.',
                ['register-email']
            );
            return;
        }
        if (!this.isValidPassword(password)) {
            this.showFieldError(
                'register-error',
                'Password must be at least 8 characters and include both letters and numbers.',
                ['register-password']
            );
            return;
        }

        // Hold the validated details for the combined submission in step 2.
        this.pendingSignup = { name, email, password };
        this.currentEmail = email;
        this.showOrgSetup();
    },

    showOrgSetup() {
        this.clearFieldError('orgsetup-error', ['org-name']);
        this.showPanel('orgsetup-panel');
    },

    // Step 2 of manual signup: organisation details. Creates the recruiter
    // account (which sends the verification OTP) and opens the in-modal OTP step.
    // TODO(backend): persist orgName / coreValues / logo via the onboarding
    // endpoint once it is defined (held in this.pendingOrg + localStorage).
    async handleOrgSetup(e) {
        e.preventDefault();
        const orgName = document.getElementById('org-name').value.trim();
        const logoInput = document.getElementById('org-logo');
        const logoFile = logoInput && logoInput.files && logoInput.files[0] ? logoInput.files[0] : null;

        this.clearFieldError('orgsetup-error', ['org-name']);

        if (!orgName) {
            this.showFieldError('orgsetup-error', 'Please enter your organisation name.', ['org-name']);
            return;
        }
        if (!this.selectedCoreValues.length) {
            this.showFieldError('orgsetup-error', 'Please select at least one core value.');
            this.openCoreValuesPanel();
            return;
        }
        if (!this.pendingSignup && !this.pendingOAuth) {
            this.showFieldError('orgsetup-error', 'Your details expired. Please start again.');
            return;
        }

        const ownerEmail = this.pendingSignup ? this.pendingSignup.email : this.pendingOAuth.email;
        this.pendingOrg = {
            orgName,
            coreValues: [...this.selectedCoreValues],
            logoName: logoFile ? logoFile.name : null,
        };
        try {
            localStorage.setItem('pendingOrgSetup', JSON.stringify({
                email: ownerEmail,
                orgName,
                coreValues: this.pendingOrg.coreValues,
            }));
        } catch (_) { /* ignore quota/availability errors */ }

        // OAuth signup: the account is already created + verified, so there is
        // no OTP. Persist the organisation, then celebrate. On failure we keep
        // the user on this step so they can retry (the endpoint is idempotent).
        if (this.pendingOAuth) {
            this.setLoading('orgsetup-btn', true);
            const result = await this.submitOrganisation(this.pendingOAuth.email, logoFile);
            this.setLoading('orgsetup-btn', false);
            if (!result.ok) {
                this.showFieldError('orgsetup-error', result.error || 'Could not save your organisation. Please try again.');
                return;
            }
            // Setup saved — now actually log the user in, then celebrate.
            if (this.pendingOAuth.user) {
                try { localStorage.setItem('fluenzoUser', JSON.stringify(this.pendingOAuth.user)); } catch (_) {}
            }
            this.showWorkspaceReady();
            return;
        }

        // Manual signup: create the account (sends OTP), persist the org, then
        // open the OTP step.
        this.setLoading('orgsetup-btn', true);
        try {
            const { name, email, password } = this.pendingSignup;
            const res = await fetch(`${this.API_BASE}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();

            if (res.ok) {
                this.currentEmail = email;
                // Persist the organisation now that the user row exists.
                // Non-fatal: if it fails, onboarding_complete stays false and the
                // user simply sees org setup again after verifying — self-healing.
                await this.submitOrganisation(email, logoFile);

                const sub = document.getElementById('orgotp-sub');
                if (sub) sub.textContent = `Enter the 6-digit code we sent to ${email}.`;
                this.clearOTPInputs('orgotp-inputs');
                this.showPanel('orgotp-panel');
                document.querySelector('#orgotp-inputs .otp-input-single')?.focus();
            } else {
                this.showFieldError('orgsetup-error', data.detail || 'Could not create your account. Please try again.');
            }
        } catch (err) {
            this.showFieldError('orgsetup-error', 'Connection error. Please try again.');
        }
        this.setLoading('orgsetup-btn', false);
    },

    // POST the organisation (name + core values + optional logo) as multipart.
    // Returns { ok, error?, data? }. Used by both signup paths.
    async submitOrganisation(email, logoFile) {
        try {
            const fd = new FormData();
            fd.append('email', email);
            fd.append('org_name', document.getElementById('org-name').value.trim());
            fd.append('core_values', JSON.stringify(this.selectedCoreValues));
            // Only send custom agents that are actually selected.
            const usedCustoms = this.customAgents.filter(a => this.selectedCoreValues.includes(a.agent_id));
            fd.append('custom_agents', JSON.stringify(usedCustoms));
            if (logoFile) fd.append('logo', logoFile);

            const res = await fetch(`${this.API_BASE}/api/organisation/setup`, {
                method: 'POST',
                body: fd, // no Content-Type — the browser sets the multipart boundary
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) return { ok: true, data };
            return { ok: false, error: data.detail || 'Could not save your organisation.' };
        } catch (err) {
            return { ok: false, error: 'Connection error. Please try again.' };
        }
    },

    // Step 3 of manual signup: verify the email OTP, then sign the recruiter in.
    async handleOrgOTP(e) {
        e.preventDefault();
        const otp = this.getOTPValue('orgotp-inputs');
        this.clearFieldError('orgotp-error');

        if (!otp || otp.length < 6) {
            this.showFieldError('orgotp-error', 'Please enter the 6-digit code.');
            return;
        }

        this.setLoading('orgotp-btn', true);
        try {
            const res = await fetch(`${this.API_BASE}/api/verify-registration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentEmail, otp })
            });
            const data = await res.json();

            if (res.ok) {
                // Email verified — sign in with the credentials captured in step 1.
                let loggedIn = false;
                if (this.pendingSignup) {
                    try {
                        const loginRes = await fetch(`${this.API_BASE}/api/login`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: this.pendingSignup.email, password: this.pendingSignup.password })
                        });
                        const loginData = await loginRes.json();
                        if (loginRes.ok) {
                            localStorage.setItem('fluenzoUser', JSON.stringify(loginData.user));
                            loggedIn = true;
                        }
                    } catch (_) { /* fall back to manual login below */ }
                }

                if (loggedIn) {
                    // The organisation was already persisted at the org-setup step
                    // (which also set onboarding_complete). First sign-in:
                    // celebrate on the login page, then go home.
                    this.showWorkspaceReady();
                } else {
                    this.showMessage('Email verified! You can now log in.', 'success');
                    setTimeout(() => this.switchTab('login'), 1200);
                }
            } else {
                this.showFieldError('orgotp-error', data.detail || 'Invalid or expired code.');
            }
        } catch (err) {
            this.showFieldError('orgotp-error', 'Connection error. Please try again.');
        }
        this.setLoading('orgotp-btn', false);
    },

    async handleVerifyOTP(e) {
        e.preventDefault();
        const otp = this.getOTPValue('verify-otp-inputs') || document.getElementById('verify-otp')?.value;

        this.setLoading('verify-btn', true);

        try {
            const res = await fetch(`${this.API_BASE}/api/verify-registration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentEmail, otp })
            });

            const data = await res.json();

            if (res.ok) {
                this.showMessage('Email verified! You can now login.', 'success');
                setTimeout(() => this.switchTab('login'), 1500);
            } else {
                this.showMessage(data.detail || 'Verification failed', 'error');
            }
        } catch (err) {
            this.showMessage('Connection error. Please try again.', 'error');
        }

        this.setLoading('verify-btn', false);
    },

    // Forgot password step 1: email -> sends a 6-digit reset OTP, opens the
    // reset panel where the user enters the code + a new password.
    async handleForgotPassword(e) {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        this.clearFieldError('forgot-msg', ['forgot-email']);

        if (!email || email.indexOf('@') === -1) {
            this.showFieldError('forgot-msg', 'Please enter a valid email address.', ['forgot-email']);
            return;
        }

        this.currentEmail = email;
        this.setLoading('forgot-btn', true);
        try {
            const res = await fetch(`${this.API_BASE}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (res.ok) {
                this.clearOTPInputs('reset-otp-inputs');
                this.clearFieldError('reset-msg', ['reset-password', 'reset-password-confirm']);
                this.showPanel('reset-panel');
                document.querySelector('#reset-otp-inputs .otp-input-single')?.focus();
            } else {
                this.showFieldError('forgot-msg', data.detail || 'Could not send the reset code.', ['forgot-email']);
            }
        } catch (err) {
            this.showFieldError('forgot-msg', 'Connection error. Please try again.');
        }
        this.setLoading('forgot-btn', false);
    },

    // Forgot password step 2: verify the OTP and set the new password.
    async handleResetPassword(e) {
        e.preventDefault();
        const otp = this.getOTPValue('reset-otp-inputs');
        const newPassword = document.getElementById('reset-password').value;
        const confirmPassword = document.getElementById('reset-password-confirm').value;
        this.clearFieldError('reset-msg', ['reset-password', 'reset-password-confirm']);

        if (!otp || otp.length < 6) {
            this.showFieldError('reset-msg', 'Please enter the 6-digit code from your email.');
            return;
        }
        if (!this.isValidPassword(newPassword)) {
            this.showFieldError('reset-msg', 'Password must be at least 8 characters and include both letters and numbers.', ['reset-password']);
            return;
        }
        if (newPassword !== confirmPassword) {
            this.showFieldError('reset-msg', 'Passwords do not match.', ['reset-password-confirm']);
            return;
        }

        this.setLoading('reset-btn', true);
        try {
            const res = await fetch(`${this.API_BASE}/api/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentEmail, otp, new_password: newPassword })
            });
            const data = await res.json();

            if (res.ok) {
                this.showFieldError('reset-msg', '');
                const msg = document.getElementById('reset-msg');
                if (msg) { msg.textContent = 'Password reset successful! Redirecting to sign in...'; msg.classList.add('show'); msg.style.color = '#1F9D55'; }
                setTimeout(() => {
                    if (msg) msg.style.color = '';
                    this.switchTab('login');
                    const le = document.getElementById('login-email');
                    if (le) le.value = this.currentEmail;
                }, 1400);
            } else {
                this.showFieldError('reset-msg', data.detail || 'Invalid or expired code.');
            }
        } catch (err) {
            this.showFieldError('reset-msg', 'Connection error. Please try again.');
        }
        this.setLoading('reset-btn', false);
    },

    async resendOTP(purpose = 'verification') {
        const endpoint = purpose === 'reset' ? '/api/forgot-password' : '/api/resend-otp';

        try {
            const res = await fetch(`${this.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentEmail })
            });

            if (res.ok) {
                this.showMessage('New code sent!', 'success');
            } else {
                this.showMessage('Failed to resend code', 'error');
            }
        } catch (err) {
            this.showMessage('Failed to resend code', 'error');
        }
    },

    // ==================== OAuth Methods ====================

    async initGoogleAuth() {
        try {
            const res = await fetch(`${this.API_BASE}/api/auth/google/client-id`);
            if (!res.ok) return;
            const data = await res.json();
            this.googleClientId = data.client_id;
        } catch (err) {
            console.log('[Auth] Google OAuth not configured');
        }
    },

    handleGoogleSignIn(mode) {
        // mode 'login' = sign in only (no account creation); default 'signup'.
        this.oauthMode = mode === 'login' ? 'login' : 'signup';
        if (!this.googleClientId) {
            this.showMessage('Google sign-in is not configured yet.', 'error');
            return;
        }

        // Use Google Identity Services to show the One Tap / popup
        if (typeof google === 'undefined' || !google.accounts) {
            this.showMessage('Google sign-in is loading. Please try again.', 'error');
            return;
        }

        google.accounts.id.initialize({
            client_id: this.googleClientId,
            callback: (response) => this.handleGoogleCallback(response),
            auto_select: false,
        });

        google.accounts.id.prompt((notification) => {
            // If One Tap is suppressed (e.g., user dismissed it before), fallback to popup
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                // Use the button-based flow as fallback
                google.accounts.oauth2.initCodeClient({
                    client_id: this.googleClientId,
                    scope: 'email profile',
                    ux_mode: 'popup',
                    callback: (response) => {
                        // This gives an auth code, but we need ID token
                        // So we use the id.initialize approach with prompt
                    },
                });
                // Render a hidden div and trigger click
                const tempDiv = document.createElement('div');
                tempDiv.id = 'g_id_signin_temp';
                tempDiv.style.display = 'none';
                document.body.appendChild(tempDiv);
                google.accounts.id.renderButton(tempDiv, {
                    type: 'standard',
                    size: 'large',
                });
                // Click the rendered button
                const gBtn = tempDiv.querySelector('div[role="button"]') || tempDiv.querySelector('iframe');
                if (gBtn) gBtn.click();
                setTimeout(() => tempDiv.remove(), 1000);
            }
        });
    },

    async handleGoogleCallback(response) {
        if (!response.credential) {
            this.showMessage('Google sign-in failed. Please try again.', 'error');
            return;
        }

        try {
            this.showMessage('Signing in with Google...', 'success');

            const res = await fetch(`${this.API_BASE}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential, mode: this.oauthMode || 'signup' })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                this.completeOAuth(data.user, data.needs_onboarding);
            } else if (data.no_account) {
                // Sign-in-only attempt for an email with no account.
                this.switchTab('login');
                this.showLoginMsg('No account found for this email. Please sign up first.', 'error');
            } else {
                this.showMessage(data.detail || 'Google sign-in failed', 'error');
            }
        } catch (err) {
            this.showMessage('Connection error. Please try again.', 'error');
        }
    },

    // Shared landing point for any OAuth provider (Google popup or the Microsoft
    // redirect resume). Users who haven't finished workspace setup go through
    // org setup (no OTP — the provider already verified them); users who have
    // go straight to the dashboard.
    completeOAuth(user, needsOnboarding) {
        if (needsOnboarding) {
            // New signups (Google/Microsoft) must use a company domain — block
            // personal/free providers from creating a workspace, same rule as
            // the manual sign-up form. Existing users (no onboarding) are not
            // re-checked so they can still log in.
            if (!this.isCompanyEmail((user && user.email) || '')) {
                this.pendingOAuth = null;
                this.pendingSignup = null;
                if (typeof this.openModal === 'function') this.openModal('register');
                this.showFieldError(
                    'register-error',
                    'Please sign up with your company email. Personal accounts (Gmail, Outlook, etc.) are not allowed.',
                    ['register-email']
                );
                return;
            }
            // Do NOT log in yet — the user must finish org setup first, so a
            // refresh mid-setup can't slip them straight into the dashboard.
            this.beginOAuthOrgSetup(user);
        } else {
            if (user) {
                try { localStorage.setItem('fluenzoUser', JSON.stringify(user)); } catch (_) {}
            }
            this.showMessage('Login successful! Redirecting...', 'success');
            setTimeout(() => window.location.href = '/b4kx', 600);
        }
    },

    // OAuth signup step 2: the account already exists + is verified, so we just
    // collect organisation details, then log the user in and show the popup.
    beginOAuthOrgSetup(user) {
        this.pendingOAuth = {
            email: (user && user.email) || '',
            name: (user && user.name) || '',
            user: user || null,   // held so we only log in once setup is done
        };
        this.pendingSignup = null;
        this.currentEmail = this.pendingOAuth.email;
        this.selectedCoreValues = [];
        this.updateCoreValuesUI();
        if (typeof this.openModal === 'function') this.openModal();
        this.showOrgSetup();
    },

    handleLinkedInSignIn() {
        // Redirect to backend which redirects to LinkedIn OAuth consent
        window.location.href = `${this.API_BASE}/api/auth/linkedin`;
    },

    handleMicrosoftSignIn(mode) {
        // Server-side auth-code flow: backend redirects to Microsoft, then back
        // to /login with the result in the URL fragment (see initOAuthResume).
        // mode 'login' = sign in only (no account creation); default 'signup'.
        const q = mode === 'login' ? '?mode=login' : '';
        window.location.href = `${this.API_BASE}/api/auth/microsoft${q}`;
    },

    // ==================== Workspace Ready popup ====================

    // The first-login celebration (Figma "Your Workplace is Ready!"). Shown on
    // the login page itself; the button takes the user to the dashboard.
    showWorkspaceReady() {
        const overlay = document.getElementById('ws-ready-overlay');
        if (!overlay) { window.location.href = '/b4kx'; return; }

        this.closeCoreValuesPanel();
        // Close the org-setup modal behind it so only the celebration shows.
        if (typeof this.closeModal === 'function') this.closeModal();
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('show'));

        const go = () => {
            // Tell the dashboard to run the first-login company-setup flow
            // (Disclaimer -> Welcome) once on arrival.
            try { localStorage.setItem('companySetupPrompt', '1'); } catch (_) {}
            window.location.href = '/b4kx';
        };
        const btn = document.getElementById('ws-ready-btn');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', go);
        }
    },

    // ==================== Microsoft redirect resume ====================

    // After the Microsoft server-side flow, the backend bounces back to /login
    // with the result in the URL fragment. Decode it and continue the flow.
    // Returns true if a fragment was consumed (so init() skips the auth check).
    initOAuthResume() {
        const hash = window.location.hash || '';

        if (hash.indexOf('msnoaccount=') !== -1) {
            // Microsoft sign-in (login mode) for an email with no account.
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
            if (typeof this.openModal === 'function') this.openModal('login');
            this.showLoginMsg('No account found for this email. Please sign up first.', 'error');
            return true;
        }

        if (hash.indexOf('mserror=') !== -1) {
            const msg = decodeURIComponent(hash.split('mserror=')[1] || 'Microsoft sign-in failed');
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
            if (typeof this.openModal === 'function') this.openModal('register');
            this.showMessage(msg, 'error');
            return true;
        }

        if (hash.indexOf('msauth=') !== -1) {
            const raw = hash.split('msauth=')[1] || '';
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
            try {
                const data = JSON.parse(atob(decodeURIComponent(raw)));
                this.completeOAuth(data.user, data.needs_onboarding);
                return true;
            } catch (err) {
                this.showMessage('Could not complete Microsoft sign-in. Please try again.', 'error');
            }
        }
        return false;
    },

    // ==================== Navigation ====================

    showForgotPassword() {
        this.showPanel('forgot-panel');
    },

    backToLogin() {
        this.switchTab('login');
    },

    backToForgot() {
        this.showPanel('forgot-panel');
    },

    backToRegister() {
        this.switchTab('register');
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => Auth.init());

// Export for global access
window.Auth = Auth;
