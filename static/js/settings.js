/**
 * Hire XA — Settings page
 * Loads + saves the org's company profile (core values, company details, logo)
 * and links the Company Email field to the existing Connect flow.
 */
(function () {
    const API = window.location.origin;

    let userEmail = '';
    try {
        const u = JSON.parse(localStorage.getItem('fluenzoUser') || 'null');
        if (!u || !u.email) { window.location.href = '/login'; return; }
        userEmail = u.email;
    } catch (_) { window.location.href = '/login'; return; }

    // The 25 core values: [id, label, evaluator agent] — mirrors CORE_VALUES in auth.js.
    const CV_DATA = [
        ['cv_integrity', 'Integrity', 'Kavita Verma'],
        ['cv_innovation', 'Innovation', 'Rohit Bansal'],
        ['cv_accountability', 'Accountability', 'Nisha Patel'],
        ['cv_honesty', 'Honesty', 'Aditya Rao'],
        ['cv_respect', 'Respect', 'Sunita Joshi'],
        ['cv_passion', 'Passion', 'Karan Malhotra'],
        ['cv_customer_focus', 'Customer Focus', 'Ritu Agarwal'],
        ['cv_excellence', 'Excellence', 'Manish Tiwari'],
        ['cv_teamwork', 'Teamwork', 'Pooja Saxena'],
        ['cv_transparency', 'Transparency', 'Naveen Kumar'],
        ['cv_diversity', 'Diversity', 'Shreya Menon'],
        ['cv_learning', 'Continuous Learning', 'Amit Chandra'],
        ['cv_adaptability', 'Adaptability', 'Swati Deshmukh'],
        ['cv_ownership', 'Ownership', 'Harsh Jain'],
        ['cv_empathy', 'Empathy', 'Anjali Bhatt'],
        ['cv_courage', 'Courage', 'Vivek Sinha'],
        ['cv_results', 'Results Orientation', 'Tanvi Kulkarni'],
        ['cv_simplicity', 'Simplicity', 'Suresh Pillai'],
        ['cv_social_resp', 'Social Responsibility', 'Divya Nambiar'],
        ['cv_sustainability', 'Sustainability', 'Pranav Hegde'],
        ['cv_communication', 'Communication', 'Lata Mishra'],
        ['cv_leadership', 'Leadership', 'Gaurav Thakur'],
        ['cv_fairness', 'Fairness', 'Rekha Dasgupta'],
        ['cv_creativity', 'Creativity', 'Siddharth Mohan'],
        ['cv_community', 'Community', 'Isha Rawat'],
    ];
    const CV_GRADIENTS = [
        'linear-gradient(141.93deg, #DE9CA7 58.77%, #FFD7DD 98.19%)',
        'linear-gradient(141.93deg, #8A7CF0 58.77%, #C3BCFA 98.19%)',
        'linear-gradient(141.93deg, #5BB4E3 58.77%, #B8E2F7 98.19%)',
        'linear-gradient(141.93deg, #79C28C 58.77%, #C2E8CD 98.19%)',
        'linear-gradient(141.93deg, #F2B33D 58.77%, #FBE0A6 98.19%)',
        'linear-gradient(141.93deg, #E1786F 58.77%, #F6C2BC 98.19%)',
        'linear-gradient(141.93deg, #4CABF6 58.77%, #B6DEFB 98.19%)',
        'linear-gradient(141.93deg, #B07CD0 58.77%, #E2C6F0 98.19%)',
    ];
    const CV_LABELS = {}, CV_AGENTS = {}, CV_GRAD = {};
    CV_DATA.forEach((r, i) => { CV_LABELS[r[0]] = r[1]; CV_AGENTS[r[0]] = r[2]; CV_GRAD[r[0]] = CV_GRADIENTS[i % CV_GRADIENTS.length]; });
    const MAX_CV = 5;

    // Org-authored custom core-value agents (cv_c*). Ids appended to the picker
    // at runtime so the built-in CV_DATA list never has to be edited.
    let customIds = [];
    let _voiceCatalog = null;
    let _previewAudio = null;

    // Register one custom agent into the lookup maps + picker list.
    function addCustomToMaps(a, i) {
        if (!a || !a.id) return;
        CV_LABELS[a.id] = a.name || a.id;
        CV_AGENTS[a.id] = a.agent || 'Custom interviewer';
        CV_GRAD[a.id] = CV_GRADIENTS[(CV_DATA.length + (i || 0)) % CV_GRADIENTS.length];
        if (!customIds.includes(a.id)) customIds.push(a.id);
    }

    // All selectable core-value ids (built-ins + org customs).
    function allCvIds() { return CV_DATA.map(r => r[0]).concat(customIds); }

    const el = (id) => document.getElementById(id);

    function hideLoader() {
        const l = el('page-loader');
        if (l) l.classList.add('page-loader--done');
    }

    let selectedCV = [];
    let logoFile = null;
    let isAdmin = false;     // only the org owner may edit
    let editable = false;    // admin has tapped the edit pencil

    // Lock / unlock the whole settings form. Members can never edit; the admin
    // starts locked (read-only) and unlocks by tapping the Company Details pencil.
    const EDITABLE_INPUTS = ['set-name', 'set-website', 'set-whatsapp', 'set-address', 'set-hq', 'set-size'];
    function setEditable(on) {
        editable = !!on && isAdmin;
        EDITABLE_INPUTS.forEach(id => { const e = el(id); if (e) e.readOnly = !editable; });

        const logo = el('set-logo'); if (logo) logo.disabled = !editable;
        const logoLabel = el('set-logo-label');
        if (logoLabel) logoLabel.classList.toggle('set-locked-control', !editable);

        const emailTrig = el('set-email-trigger'); if (emailTrig) emailTrig.disabled = !editable;

        const searchWrap = document.querySelector('.set-cv-search-wrap');
        if (searchWrap) searchWrap.style.display = editable ? '' : 'none';

        const saveBtn = el('set-save-btn'); if (saveBtn) saveBtn.style.display = editable ? '' : 'none';

        const editBtn = el('set-edit-btn'); if (editBtn) editBtn.classList.toggle('active', editable);

        renderChips();
    }

    // Instant lock from the cached role so an invited member never flashes the
    // admin (editable) layout before the profile request resolves. The server
    // response in load() is authoritative and reconciles this.
    try {
        const _cached = JSON.parse(localStorage.getItem('fluenzoUser') || 'null');
        isAdmin = !!(_cached && _cached.is_admin === true);
    } catch (_) {}
    // Show the pencil to admins; show the read-only notice to members.
    function applyRoleUI() {
        const eb = el('set-edit-btn');
        if (eb) eb.style.display = isAdmin ? '' : 'none';
        const note = el('set-readonly-note');
        if (note) note.hidden = isAdmin;
    }
    applyRoleUI();
    setEditable(false);

    // City + country lists for the address / headquarters autocompletes.
    const CITIES = [
        'Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Ahmedabad', 'Chennai',
        'Kolkata', 'Pune', 'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam',
        'Patna', 'Vadodara', 'Ghaziabad', 'Ludhiana', 'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot',
        'Surat', 'Gurugram', 'Gurgaon', 'Noida', 'Chandigarh', 'Coimbatore', 'Kochi', 'Mysuru', 'Mangaluru',
        'Guwahati', 'Bhubaneswar', 'Dehradun', 'Jodhpur', 'Amritsar', 'Raipur', 'Ranchi', 'Vijayawada',
        'Madurai', 'Thiruvananthapuram', 'Goa', 'Panaji', 'Jamshedpur', 'Tiruchirappalli', 'Salem',
        'Aurangabad', 'Jabalpur', 'Gwalior', 'Kota', 'New York', 'San Francisco', 'Los Angeles', 'Chicago',
        'Seattle', 'Austin', 'Boston', 'London', 'Manchester', 'Dublin', 'Paris', 'Berlin', 'Munich',
        'Amsterdam', 'Madrid', 'Barcelona', 'Lisbon', 'Stockholm', 'Zurich', 'Geneva', 'Singapore', 'Dubai',
        'Abu Dhabi', 'Hong Kong', 'Tokyo', 'Osaka', 'Seoul', 'Shanghai', 'Beijing', 'Bangkok', 'Kuala Lumpur',
        'Jakarta', 'Manila', 'Sydney', 'Melbourne', 'Toronto', 'Vancouver', 'Tel Aviv', 'Riyadh', 'Doha',
        'Istanbul', 'Cairo', 'Johannesburg', 'Nairobi', 'Sao Paulo', 'Mexico City',
    ];
    const COUNTRIES = [
        'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia',
        'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
        'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
        'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Chad', 'Chile', 'China',
        'Colombia', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti',
        'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji',
        'Finland', 'France', 'Gabon', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Guyana',
        'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
        'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia',
        'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
        'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritius', 'Mexico', 'Moldova', 'Monaco',
        'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands',
        'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
        'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
        'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
        'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia', 'South Africa', 'South Korea',
        'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania',
        'Thailand', 'Togo', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda', 'Ukraine',
        'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Venezuela',
        'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
    ];

    function attachAutocomplete(inputId, listId, data) {
        const input = el(inputId), box = el(listId);
        if (!input || !box) return;
        function render() {
            // Don't offer suggestions while the form is locked (read-only).
            if (input.readOnly || input.disabled) { box.hidden = true; return; }
            const q = (input.value || '').trim().toLowerCase();
            let items = q ? data.filter(x => x.toLowerCase().includes(q)) : data.slice();
            if (q) items.sort((a, b) =>
                (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1));
            items = items.slice(0, 30);
            if (!items.length) { box.hidden = true; return; }
            box.innerHTML = items.map(x =>
                '<button type="button" class="set-ac-item" data-val="' + escapeHtml(x) + '">' + escapeHtml(x) + '</button>'
            ).join('');
            box.querySelectorAll('.set-ac-item').forEach(b => {
                b.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    input.value = b.dataset.val;
                    box.hidden = true;
                });
            });
            box.hidden = false;
        }
        input.addEventListener('focus', render);
        input.addEventListener('input', render);
        input.addEventListener('blur', () => { setTimeout(() => { box.hidden = true; }, 120); });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const val = (id) => (el(id)?.value || '').trim();
    function setVal(id, v) { const e = el(id); if (e) e.value = v || ''; }
    function setStatus(msg, kind) {
        const s = el('set-status'); if (!s) return;
        s.textContent = msg; s.className = 'set-status' + (kind ? ' ' + kind : '');
    }

    // -------- Core-value chips --------
    function renderChips() {
        const wrap = el('set-cv-chips');
        if (!wrap) return;
        wrap.innerHTML = selectedCV.map(id => {
            const label = CV_LABELS[id] || id.replace('cv_', '');
            // The remove control only exists while editing (admin unlocked).
            const removeBtn = editable
                ? '<button type="button" data-remove="' + id + '" aria-label="Remove">&times;</button>'
                : '';
            return '<span class="set-chip">' + escapeHtml(label) + removeBtn + '</span>';
        }).join('');
        if (!editable) return;
        wrap.querySelectorAll('button[data-remove]').forEach(b => {
            b.addEventListener('click', () => {
                selectedCV = selectedCV.filter(c => c !== b.dataset.remove);
                renderChips();
            });
        });
    }

    // Multi-select dropdown: shows ALL agent cards (selected ones highlighted),
    // toggles on click, stays open, capped at MAX_CV (10).
    function renderSuggest(q) {
        const box = el('set-cv-suggest');
        if (!box) return;
        q = (q || '').trim();
        const ql = q.toLowerCase();
        const atLimit = selectedCV.length >= MAX_CV;
        const ids = allCvIds().filter(id => !ql || (CV_LABELS[id] || '').toLowerCase().includes(ql));
        // "Create your own" row (admins only) — pre-fills the typed query.
        const createRow = editable
            ? '<button type="button" class="set-cv-card set-cv-create" data-create="1">' +
              '<span class="set-cv-avatar set-cv-create-avatar">+</span>' +
              '<span class="set-cv-cardmeta"><span class="set-cv-name">' +
              (q ? 'Create "' + escapeHtml(q) + '"' : 'Create your own') +
              '</span><span class="set-cv-role">Build a custom core-value agent</span></span></button>'
            : '';
        if (!ids.length) {
            box.innerHTML = createRow || '<div class="set-cv-suggest-empty">No matching core value.</div>';
            box.hidden = false;
            wireCreateRow(box);
            return;
        }
        box.innerHTML = createRow + ids.map(id => {
            const sel = selectedCV.includes(id);
            const cls = 'set-cv-card' + (sel ? ' selected' : (atLimit ? ' disabled' : ''));
            // Show ONLY the core value name in the list (no evaluator/agent name).
            return '<button type="button" class="' + cls + '" data-add="' + id + '">' +
                '<span class="set-cv-avatar" style="background:' + CV_GRAD[id] + '">' + escapeHtml(CV_LABELS[id].charAt(0)) + '</span>' +
                '<span class="set-cv-cardmeta">' +
                '<span class="set-cv-name">' + escapeHtml(CV_LABELS[id]) + '</span>' +
                '</span>' +
                (sel ? '<span class="set-cv-check"><svg viewBox="0 0 12 12" fill="none" stroke="#4CABF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.2 L4.6 8.6 L10 3.5"/></svg></span>' : '') +
                '</button>';
        }).join('');
        box.querySelectorAll('button[data-add]').forEach(b => {
            // mousedown (not click) keeps the input focused so the dropdown stays
            // open for selecting several at once.
            b.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const id = b.dataset.add;
                if (selectedCV.includes(id)) {
                    selectedCV = selectedCV.filter(c => c !== id);
                } else if (selectedCV.length < MAX_CV) {
                    selectedCV.push(id);
                }
                renderChips();
                renderSuggest(el('set-cv-search') ? el('set-cv-search').value : '');
            });
        });
        wireCreateRow(box);
        box.hidden = false;
    }

    // Wire the "Create your own" row in the suggest dropdown.
    function wireCreateRow(box) {
        const row = box.querySelector('[data-create]');
        if (!row) return;
        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const q = (el('set-cv-search') && el('set-cv-search').value || '').trim();
            box.hidden = true;
            openCreateModal(q);
        });
    }

    // -------- Load --------
    async function load() {
        try {
            const res = await fetch(API + '/api/company/profile?email=' + encodeURIComponent(userEmail));
            if (!res.ok) return;
            const d = await res.json();

            isAdmin = !!d.is_admin;
            // Members get no edit affordance at all (+ a read-only notice);
            // admins see the pencil but stay locked until they tap it.
            applyRoleUI();
            setEditable(false);

            if (!d.has_org) {
                if (isAdmin) setStatus('Finish your workspace setup first.', 'error');
                return;
            }

            // Register the org's custom agents before rendering chips/suggest so
            // their names resolve everywhere.
            customIds = [];
            if (Array.isArray(d.custom_agents)) d.custom_agents.forEach((a, i) => addCustomToMaps(a, i));

            selectedCV = Array.isArray(d.core_values) ? d.core_values.slice() : [];
            renderChips();

            setVal('set-name', d.name);
            setVal('set-website', d.website);
            setVal('set-whatsapp', d.whatsapp_business);
            setVal('set-address', d.company_address);
            setVal('set-hq', d.headquarters);
            setVal('set-size', d.company_size);

            const t = el('set-email-text');
            if (t) {
                if (d.email_connected && d.company_email) {
                    t.textContent = d.company_email;
                    t.classList.add('has-value');
                } else {
                    t.textContent = 'Connect company email';
                    t.classList.remove('has-value');
                }
            }
            if (d.logo_path) {
                const lt = el('set-logo-text');
                if (lt) { lt.textContent = 'Logo uploaded'; lt.classList.add('has-value'); }
            }
        } catch (_) { /* keep defaults */ }
    }

    // -------- Save --------
    async function save() {
        // Reject malformed company name / website / whatsapp before saving.
        if (window.HXAValidate) {
            const v = window.HXAValidate.validateAll(document.querySelector('.set-card') || document);
            if (!v.valid) { if (v.firstInvalid && v.firstInvalid.focus) v.firstInvalid.focus(); setStatus('Please fix the highlighted fields.', 'error'); return; }
        }
        const btn = el('set-save-btn');
        btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Saving…';
        setStatus('', '');
        try {
            const fd = new FormData();
            fd.append('email', userEmail);
            fd.append('name', val('set-name'));
            fd.append('core_values', JSON.stringify(selectedCV));
            fd.append('website', val('set-website'));
            fd.append('whatsapp_business', val('set-whatsapp'));
            fd.append('company_address', val('set-address'));
            fd.append('headquarters', val('set-hq'));
            fd.append('company_size', val('set-size'));
            if (logoFile) fd.append('logo', logoFile);

            const res = await fetch(API + '/api/company/profile', { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setStatus('Changes saved.', 'success');
                logoFile = null;
                // Refresh the company-logo avatar everywhere.
                try {
                    if (data.logo_path) localStorage.setItem('hirexaCompanyLogo', data.logo_path);
                    else localStorage.removeItem('hirexaCompanyLogo');
                } catch (_) {}
                if (window.HXAUserDropdown && window.HXAUserDropdown.applyCompanyLogo) {
                    window.HXAUserDropdown.applyCompanyLogo();
                }
            } else { setStatus(data.detail || 'Could not save. Please try again.', 'error'); }
        } catch (_) { setStatus('Connection error. Please try again.', 'error'); }
        btn.disabled = false; btn.textContent = orig;
    }

    // -------- Create-your-own core-value agent --------
    function cvmStatus(msg, kind) {
        const s = el('set-cvm-status'); if (!s) return;
        s.textContent = msg || ''; s.className = 'set-cvm-status' + (kind ? ' ' + kind : '');
    }

    async function loadVoiceCatalog() {
        if (_voiceCatalog) return _voiceCatalog;
        try {
            const res = await fetch(API + '/api/core-value-agents/voices');
            const data = await res.json();
            _voiceCatalog = Array.isArray(data.voices) ? data.voices : [];
        } catch (_) { _voiceCatalog = []; }
        return _voiceCatalog;
    }

    async function cvmPopulateVoices() {
        const sel = el('set-cvm-voice');
        if (!sel) return;
        const gender = (el('set-cvm-gender') || {}).value || 'female';
        const catalog = await loadVoiceCatalog();
        const voices = catalog.filter(v => v.gender === gender);
        sel.innerHTML = voices.map(v => '<option value="' + v.voice + '">' + escapeHtml(v.label) + '</option>').join('')
            || '<option value="">No voices available</option>';
    }

    // Three clear states for the preview button: idle (play) -> loading
    // (spinner) -> playing (pause, click to stop).
    const PV_ICONS = {
        idle: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
        playing: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="15" y="5" width="4" height="14" rx="1"/></svg>',
        loading: '<span class="set-cvm-spin" aria-hidden="true"></span>',
    };
    let _previewToken = 0;
    function cvmSetPreviewState(state) {
        const b = el('set-cvm-preview');
        if (!b) return;
        b.dataset.pvState = state;
        b.classList.toggle('playing', state === 'playing');
        b.classList.toggle('loading', state === 'loading');
        b.innerHTML = PV_ICONS[state] || PV_ICONS.idle;
        b.setAttribute('aria-label',
            state === 'playing' ? 'Stop voice sample'
            : state === 'loading' ? 'Loading voice sample'
            : 'Play voice sample');
    }

    function cvmStopPreview() {
        _previewToken += 1;   // invalidate any in-flight fetch
        if (_previewAudio) { try { _previewAudio.pause(); } catch (_) {} _previewAudio = null; }
        cvmSetPreviewState('idle');
    }

    async function cvmPreview() {
        const b = el('set-cvm-preview');
        const state = b ? b.dataset.pvState : 'idle';
        if (state === 'playing' || state === 'loading') { cvmStopPreview(); return; }
        const sel = el('set-cvm-voice');
        const voice = sel && sel.value;
        if (!voice) return;

        const token = ++_previewToken;
        cvmSetPreviewState('loading');
        try {
            const res = await fetch(API + '/api/core-value-agents/voice-preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice }),
            });
            if (token !== _previewToken) return;
            if (!res.ok) throw new Error('preview failed');
            const blob = await res.blob();
            if (token !== _previewToken) return;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            _previewAudio = audio;
            audio.onended = () => { URL.revokeObjectURL(url); if (token === _previewToken) cvmStopPreview(); };
            await audio.play();
            if (token !== _previewToken) { try { audio.pause(); } catch (_) {} return; }
            cvmSetPreviewState('playing');
        } catch (_) {
            if (token === _previewToken) {
                cvmSetPreviewState('idle');
                cvmStatus('Could not play a sample for this voice. Please try another.', 'error');
            }
        }
    }

    async function openCreateModal(prefillName) {
        if (!editable) return;   // admins, unlocked only
        cvmStopPreview();
        setVal('set-cvm-value', prefillName || '');
        setVal('set-cvm-agent', '');
        setVal('set-cvm-desc', '');
        const g = el('set-cvm-gender'); if (g) g.value = 'female';
        cvmStatus('', '');
        const ov = el('set-cv-modal'); if (ov) ov.hidden = false;
        await cvmPopulateVoices();
    }

    function closeCreateModal() {
        cvmStopPreview();
        const ov = el('set-cv-modal'); if (ov) ov.hidden = true;
    }

    async function submitCreate() {
        const valueName = val('set-cvm-value');
        const agentName = val('set-cvm-agent');
        const gender = (el('set-cvm-gender') || {}).value || 'female';
        const voice = (el('set-cvm-voice') || {}).value || '';
        const description = val('set-cvm-desc');

        cvmStatus('', '');
        if (!valueName) return cvmStatus('Please enter a core value name.', 'error');
        if (!agentName) return cvmStatus('Please enter an agent name.', 'error');
        if (!voice) return cvmStatus('Please choose a voice.', 'error');

        const saveBtn = el('set-cvm-save');
        saveBtn.disabled = true; const orig = saveBtn.textContent; saveBtn.textContent = 'Saving…';
        try {
            // 1) Draft: AI dup-check (hard block) + template generation.
            const dr = await fetch(API + '/api/core-value-agents/draft', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    value_name: valueName, agent_name: agentName, gender, voice, description,
                    existing_customs: customIds.map(id => CV_LABELS[id]).filter(Boolean),
                    email: userEmail,
                }),
            });
            const draft = await dr.json().catch(() => ({}));
            if (dr.status === 409) { cvmStatus(draft.detail || 'A similar core value already exists. Please describe a distinct one.', 'error'); return; }
            if (!dr.ok || !draft.agent) { cvmStatus(draft.detail || 'Could not create the agent. Please try again.', 'error'); return; }

            // 2) Persist to the org (it exists here) + auto-select.
            const cr = await fetch(API + '/api/core-value-agents', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail, agent: draft.agent }),
            });
            const created = await cr.json().catch(() => ({}));
            if (!cr.ok || !created.agent) { cvmStatus(created.detail || 'Could not save the agent. Please try again.', 'error'); return; }

            const a = created.agent;
            addCustomToMaps({ id: a.agent_id, name: a.value, agent: a.name }, customIds.length);
            // Mirror the server's selection (it respects the 5-cap on new adds).
            if (Array.isArray(created.core_values)) selectedCV = created.core_values.slice();

            renderChips();
            closeCreateModal();
            if (created.selected === false) {
                setStatus('Created ' + (a.value || 'core value') + '. You already have ' + MAX_CV + ' selected — deselect one to add it.', 'error');
            } else {
                setStatus('Created ' + (a.value || 'core value') + '.', 'success');
            }
            const search = el('set-cv-search');
            if (search) { search.value = ''; renderSuggest(''); }
        } catch (_) {
            cvmStatus('Connection error. Please try again.', 'error');
        } finally {
            saveBtn.disabled = false; saveBtn.textContent = orig;
        }
    }

    // -------- Wire up --------
    document.addEventListener('DOMContentLoaded', () => {
        load().finally(hideLoader);

        attachAutocomplete('set-address', 'set-address-list', CITIES);
        attachAutocomplete('set-hq', 'set-hq-list', COUNTRIES);

        const search = el('set-cv-search');
        search?.addEventListener('input', () => renderSuggest(search.value));
        search?.addEventListener('focus', () => renderSuggest(search.value));
        document.addEventListener('click', (e) => {
            const box = el('set-cv-suggest');
            if (box && !box.hidden && !e.target.closest('.set-cv-search-wrap')) box.hidden = true;
        });

        // Create-your-own core-value agent modal
        el('set-cvm-save')?.addEventListener('click', submitCreate);
        el('set-cvm-cancel')?.addEventListener('click', closeCreateModal);
        el('set-cvm-close')?.addEventListener('click', closeCreateModal);
        el('set-cvm-preview')?.addEventListener('click', cvmPreview);
        el('set-cvm-gender')?.addEventListener('change', () => { cvmStopPreview(); cvmPopulateVoices(); });
        el('set-cvm-voice')?.addEventListener('change', cvmStopPreview);
        el('set-cv-modal')?.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'set-cv-modal') closeCreateModal();
        });

        // Company Email -> reuse the dashboard Connect Company Email flow.
        el('set-email-trigger')?.addEventListener('click', () => {
            try { localStorage.setItem('openEmailConnect', '1'); } catch (_) {}
            window.location.href = '/b4kx';
        });

        const logo = el('set-logo');
        logo?.addEventListener('change', () => {
            logoFile = (logo.files && logo.files[0]) || null;
            const lt = el('set-logo-text');
            if (lt) {
                lt.textContent = logoFile ? logoFile.name : '(Optional)';
                lt.classList.toggle('has-value', !!logoFile);
            }
        });

        // Appearance is always OFF and non-interactive (dark mode not available).
        const appt = el('set-appearance-toggle');
        if (appt) {
            appt.checked = false;
            appt.disabled = true;
        }

        // Company Details edit pencil — admin only; unlocks the form for editing.
        el('set-edit-btn')?.addEventListener('click', () => {
            if (!isAdmin) return;
            setEditable(!editable);
        });

        el('set-save-btn')?.addEventListener('click', () => {
            if (!editable || !isAdmin) return;
            save();
        });
    });
})();
