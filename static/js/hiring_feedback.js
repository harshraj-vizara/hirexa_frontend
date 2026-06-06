/* Hire XA — Candidate Feedback (detail-only)
   URL: /g3tg?pipeline=<id>&room=<room_id>
   If missing room: redirect to hiring dashboard (or pipeline-monitor).
*/
(function () {
    const API = '';
    const params = new URLSearchParams(window.location.search);
    const pipelineId = params.get('pipeline');
    const roomId = params.get('room');

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Display normalization for role + candidate names: ALL CAPS.
    // "ai/ml engineer" → "AI/ML ENGINEER", "harsh raj" → "HARSH RAJ".
    const upper = s => (s == null ? '' : String(s).toUpperCase());

    const GRAD_CLASSES = ['hf-grad-coral', 'hf-grad-purple', 'hf-grad-blue', 'hf-grad-green', 'hf-grad-yellow'];

    // Verdict classification — driven purely by the candidate's overall
    // numeric score (0-10 panel average). Thresholds and labels are the
    // single source of truth for the hero pill, the hero gradient (rec-*
    // class on .hf-hero), and the per-agent pills.
    //
    //   8.1 – 10  → Strong Yes  (rec-strong → saturated green gradient)
    //   6.1 – 8.0 → Yes         (rec-hire   → mint green gradient)
    //   5.1 – 6.0 → Maybe       (rec-maybe  → warm sand gradient)
    //   1.0 – 5.0 → Reject      (rec-no     → pale pink gradient)
    //   missing  → —            (rec-na     → neutral gray)
    function verdictFromScore(score) {
        if (score == null || !isFinite(score)) return { k: 'na', label: '—' };
        if (score >= 8.1) return { k: 'strong', label: 'Strong Yes' };
        if (score >= 6.1) return { k: 'hire',   label: 'Yes' };
        if (score >= 5.1) return { k: 'maybe',  label: 'Maybe' };
        return { k: 'no', label: 'Reject' };
    }

    function scoreBand(pct) {
        if (pct == null) return 'na';
        if (pct >= 75) return '';      // green default
        if (pct >= 50) return 'warn';  // amber
        return 'bad';                  // red
    }

    function parseList(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try { const j = JSON.parse(v); return Array.isArray(j) ? j : [v]; }
            catch { return [v]; }
        }
        return [];
    }

    function fmtDate(dt) {
        if (!dt) return '—';
        try {
            const d = new Date(dt);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return '—'; }
    }

    function fmtDuration(iv) {
        if (iv.actual_duration_seconds) return Math.round(iv.actual_duration_seconds / 60) + ' min';
        if (iv.duration_minutes) return iv.duration_minutes + ' min';
        return '—';
    }

    // -------- Radar chart (6-axis polygon) --------
    // values: object keyed by metric name with values 0..100
    function renderRadar(container, metrics) {
        // Order: clockwise starting at 12 o'clock
        const order = [
            { key: 'integrity',   label: 'Integrity Score' },
            { key: 'eye_contact', label: 'Eye Contact' },
            { key: 'gaze',        label: 'Gaze Off-screen' },
            { key: 'looking_away',label: 'Looking Away/min' },
            { key: 'head',        label: 'Head Stability' },
            { key: 'tab_switches',label: 'Tab Switches' },
        ];

        // viewBox tuned so the polygon fills the card width while leaving
        // just enough margin for axis labels. Wider-than-tall aspect helps
        // the polygon scale up when the SVG is fitted into the card.
        const W = 400, H = 230;
        const cx = W / 2, cy = H / 2 + 4;
        const R = 88;

        const angle = i => (-Math.PI / 2) + (i * 2 * Math.PI / order.length);
        const pt = (i, r) => ({ x: cx + Math.cos(angle(i)) * r, y: cy + Math.sin(angle(i)) * r });

        // Concentric pentagons
        const rings = [0.2, 0.4, 0.6, 0.8, 1.0].map(t => {
            const pts = order.map((_, i) => {
                const p = pt(i, R * t);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ');
            return `<polygon class="grid" points="${pts}" />`;
        }).join('');

        // Axes
        const axes = order.map((_, i) => {
            const p = pt(i, R);
            return `<line class="axis" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" />`;
        }).join('');

        // Data polygon — polygon position uses normalized "good" score,
        // tooltip shows the actual raw value with its unit.
        const dataPts = order.map((m, i) => {
            const entry = metrics[m.key] || {};
            const norm = entry.norm;
            const t = norm == null ? 0 : Math.max(0, Math.min(1, Number(norm) / 100));
            const p = pt(i, R * t);
            return { ...p, display: entry.display != null ? entry.display : '—', label: m.label };
        });
        const dataPoly = dataPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const dataDots = dataPts.map((p, i) => {
            return `
                <g class="data-pt-group" data-i="${i}">
                    <circle class="data-pt-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="18" />
                    <circle class="data-pt-ring" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" />
                    <circle class="data-pt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" />
                    <g class="data-pt-tip" transform="translate(${p.x.toFixed(1)}, ${(p.y - 18).toFixed(1)})">
                        <rect x="-95" y="-22" width="190" height="28" rx="5" />
                        <text x="0" y="-4" text-anchor="middle">${esc(p.label)}: ${esc(p.display)}</text>
                    </g>
                </g>
            `;
        }).join('');

        // Labels (outside polygon)
        const labels = order.map((m, i) => {
            const p = pt(i, R + 18);
            let anchor = 'middle';
            const a = angle(i);
            if (Math.cos(a) > 0.3) anchor = 'start';
            else if (Math.cos(a) < -0.3) anchor = 'end';
            return `<text class="axis-label" data-i="${i}" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(m.label)}</text>`;
        }).join('');

        // Tick labels along top axis (vertical)
        const tickVals = [20, 40, 60, 80, 100];
        const ticks = tickVals.map(v => {
            const p = pt(0, R * v / 100);
            return `<text class="tick" x="${(p.x + 6).toFixed(1)}" y="${p.y.toFixed(1)}" dominant-baseline="middle">${v}</text>`;
        }).join('');

        container.innerHTML = `
            <svg class="hf-radar" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id="hf-radar-grad" x1="0" y1="0" x2="0" y2="1">
                        <!-- Figma radar fill — warm gold fading into deep olive,
                             tied to the yellow stroke below for a cohesive
                             proctoring chart treatment. -->
                        <stop offset="0%" stop-color="rgba(218,165,32,0.55)" />
                        <stop offset="100%" stop-color="rgba(74,68,28,0.55)" />
                    </linearGradient>
                </defs>
                <g class="radar-grid-group">
                    ${rings}
                    ${axes}
                </g>
                ${ticks}
                <polygon class="data" points="${dataPoly}" />
                <g class="data-pts">${dataDots}</g>
                ${labels}
            </svg>
        `;

        // Pop animation re-trigger: kicking a class on re-render ensures
        // the keyframes run again for each new candidate.
        const svgEl = container.querySelector('svg.hf-radar');
        if (svgEl) {
            svgEl.classList.remove('animate-in');
            // Force reflow so the next add restarts CSS animations
            void svgEl.getBoundingClientRect();
            svgEl.classList.add('animate-in');
        }

        // Hover cross-link: when an axis label is hovered, highlight the
        // matching data-point group, and vice-versa.
        container.querySelectorAll('.data-pt-group, .axis-label').forEach(el => {
            const idx = el.getAttribute('data-i');
            const enter = () => {
                container.querySelectorAll(`[data-i="${idx}"]`).forEach(n => n.classList.add('is-active'));
            };
            const leave = () => {
                container.querySelectorAll(`[data-i="${idx}"]`).forEach(n => n.classList.remove('is-active'));
            };
            el.addEventListener('mouseenter', enter);
            el.addEventListener('mouseleave', leave);
        });
    }

    function buildProctorMetrics(p) {
        if (!p) return null;
        // Returns { norm, display } per metric. We plot RAW values directly so
        // the dot position matches the displayed number (0 -> near center, max -> outer ring).
        // For rate-/count-type metrics, multiply by 20 so the axis maxes out at 5.
        const clamp = v => Math.max(0, Math.min(100, Number(v)));
        const integ    = p.integrity_score      != null ? Number(p.integrity_score)      : null;
        const eye      = p.eye_contact_pct      != null ? Number(p.eye_contact_pct)      : null;
        const gazeOff  = p.gaze_offscreen_pct   != null ? Number(p.gaze_offscreen_pct)   : null;
        const lookAway = p.looking_away_per_min != null ? Number(p.looking_away_per_min) : null;
        const headStab = p.head_stability_score != null ? Number(p.head_stability_score) : null;
        const tabCount = p.tab_switch_count     != null ? Number(p.tab_switch_count)     : null;

        return {
            integrity:    { norm: integ    != null ? clamp(integ)         : null, display: integ    != null ? Math.round(integ) + '/100'    : '—' },
            eye_contact:  { norm: eye      != null ? clamp(eye)           : null, display: eye      != null ? Math.round(eye) + '%'         : '—' },
            gaze:         { norm: gazeOff  != null ? clamp(gazeOff)       : null, display: gazeOff  != null ? gazeOff.toFixed(1) + '%'      : '—' },
            looking_away: { norm: lookAway != null ? clamp(lookAway * 20) : null, display: lookAway != null ? lookAway.toFixed(1) + ' /min' : '—' },
            head:         { norm: headStab != null ? clamp(headStab)      : null, display: headStab != null ? Math.round(headStab) + '/100' : '—' },
            tab_switches: { norm: tabCount != null ? clamp(tabCount * 20) : null, display: tabCount != null ? String(tabCount)              : '—' }
        };
    }

    const HF = {
        recording: null,

        logout(e) {
            if (e) e.preventDefault();
            localStorage.removeItem('fluenzoUser');
            localStorage.removeItem('fluenzo_user');
            localStorage.removeItem('currentSession');
            window.location.href = '/';
        },

        _toast(msg) {
            const t = $('hf-toast');
            t.textContent = msg;
            t.classList.remove('hidden');
            clearTimeout(this._tt);
            this._tt = setTimeout(() => t.classList.add('hidden'), 2500);
        },

        _initUser() {
            try {
                const u = JSON.parse(localStorage.getItem('fluenzoUser') || localStorage.getItem('fluenzo_user') || 'null');
                if (u) {
                    if ($('hf-username')) $('hf-username').textContent = u.name || u.first_name || (u.email ? u.email.split('@')[0] : 'User');
                    if ($('hf-useremail')) $('hf-useremail').textContent = u.email || '';
                }
            } catch (e) { /* noop */ }
            document.addEventListener('click', e => {
                const dd = $('hf-user-dropdown');
                if (dd && !dd.contains(e.target)) dd.classList.remove('open');
            });
        },

        _showEmpty(msg) {
            $('hf-loading').classList.add('hidden');
            $('hf-detail').classList.add('hidden');
            const e = $('hf-empty');
            if (msg && e.querySelector('p')) e.querySelector('p').textContent = msg;
            e.classList.remove('hidden');
        },

        watchInterview() {
            if (this.recording && this.recording.view_link) {
                window.open(this.recording.view_link, '_blank');
            } else {
                this._toast('No recording available for this interview.');
            }
        },

        async loadDetail(pid, rid) {
            try {
                const [detailRes, pRes] = await Promise.all([
                    fetch(`${API}/api/screening_feedback/detail/${rid}`).then(r => r.json()),
                    pid ? fetch(`${API}/api/pipeline/status/${pid}`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
                ]);

                if (!detailRes || detailRes.success === false || !detailRes.interview) {
                    this._showEmpty('Interview feedback could not be loaded.');
                    return;
                }

                const iv = detailRes.interview || {};
                const sum = detailRes.summary || {};
                const agents = detailRes.agent_feedbacks || [];
                const proc = detailRes.proctoring || null;
                const rec = detailRes.recording || null;
                const pipe = pRes && pRes.pipeline ? pRes.pipeline : {};

                this.recording = rec;

                // Back link → hiring-dashboard for this pipeline
                if (pid) {
                    const backLink = $('hf-back-link');
                    if (backLink) backLink.href = `/f9pj?id=${encodeURIComponent(pid)}`;
                }

                // ---- Hero ----
                $('d-candidate-name').textContent = upper(iv.candidate_name || 'Candidate');
                $('d-role').textContent = upper(iv.hiring_role || pipe.hiring_role || '—');
                $('d-date').textContent = fmtDate(iv.ended_at || iv.created_at);
                $('d-duration').textContent = fmtDuration(iv);

                const overall = sum.overall_score != null ? Number(sum.overall_score) : null;
                $('d-overall').textContent = overall != null ? overall.toFixed(1) : '—';

                const v = verdictFromScore(overall);
                const pill = $('d-rec-pill');
                pill.textContent = v.label;
                pill.className = 'hf-rec-pill rec-' + v.k;
                $('hf-hero').className = 'hf-hero rec-' + v.k;

                // ---- Dimensions ----
                let dims = sum.dimension_averages || {};
                if (typeof dims === 'string') {
                    try { dims = JSON.parse(dims); } catch { dims = {}; }
                }
                const dimOrder = [
                    { k: 'communication',   label: 'Communication' },
                    { k: 'experience',      label: 'Experience' },
                    { k: 'technical',       label: 'Technical' },
                    { k: 'learning',        label: 'Learning' },
                    { k: 'problem_solving', label: 'Problem-Solving' },
                    { k: 'authenticity',    label: 'Authenticity (Hogan)' },
                    { k: 'behavioral',      label: 'Behavioural (BEI)' },
                    { k: 'time_efficiency', label: 'Time Efficiency' },
                    { k: 'cultural_fit',    label: 'Cultural Fit' },
                ];
                $('d-dims').innerHTML = dimOrder.map(d => {
                    const raw = dims && dims[d.k];
                    const score = raw == null ? null : (typeof raw === 'object' ? raw.score : raw);
                    const num = score == null ? null : Number(score);
                    const pct = num == null ? 0 : Math.min(100, Math.max(0, num * 10));
                    const band = scoreBand(pct);
                    return `
                        <div class="hf-dim">
                            <div class="hf-dim-label">${esc(d.label)}</div>
                            <div class="hf-dim-row">
                                <div class="hf-dim-bar"><div class="hf-dim-fill ${band}" style="width:${pct}%"></div></div>
                                <div class="hf-dim-score ${band || (num == null ? 'na' : '')}">${num == null ? '—' : num.toFixed(1) + '/10'}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                // ---- Strengths / improvements ----
                const strengths = parseList(sum.top_strengths);
                const improves = parseList(sum.top_improvements);
                $('d-strengths').innerHTML = strengths.length
                    ? strengths.map(s => `<li>${esc(s)}</li>`).join('')
                    : '<li class="hf-empty-row">No strengths recorded.</li>';
                $('d-improvements').innerHTML = improves.length
                    ? improves.map(s => `<li>${esc(s)}</li>`).join('')
                    : '<li class="hf-empty-row">No improvement notes recorded.</li>';

                // ---- Proctoring radar ----
                const metrics = buildProctorMetrics(proc);
                if (metrics) {
                    renderRadar($('d-radar'), metrics);
                } else {
                    $('d-radar').innerHTML = '<p style="font-size:12px;color:#9B9C9E;text-align:center">No proctoring data.</p>';
                }

                // ---- Agent reviews ----
                if (agents.length) {
                    $('d-agents').innerHTML = agents.map((a, i) => {
                        const grad = GRAD_CLASSES[i % GRAD_CLASSES.length];
                        const ao = a.overall_score != null ? Number(a.overall_score) : null;
                        const agentVerdict = verdictFromScore(ao);
                        // Score-number color: green for Yes/Strong Yes (default,
                        // no class), gold for Maybe, red for Reject, gray for NA.
                        const aoBand = (agentVerdict.k === 'strong' || agentVerdict.k === 'hire') ? '' : agentVerdict.k;

                        // Pick a 1-line summary from strengths or recommendation_text or improvements
                        let summary = '';
                        const aStrengths = parseList(a.strengths);
                        const aImproves = parseList(a.improvements);
                        if (aStrengths.length) summary = aStrengths.slice(0, 4).join(', ');
                        else if (a.recommendation_text) summary = String(a.recommendation_text);
                        else if (aImproves.length) summary = aImproves.slice(0, 4).join(', ');

                        const name = a.agent_name || 'Agent';
                        const initial = name.charAt(0).toUpperCase();
                        const role = a.agent_role || '';

                        return `
                            <div class="hf-agent-row">
                                <div class="hf-agent-avatar ${grad}">${esc(initial)}</div>
                                <div class="hf-agent-name-col">
                                    <span class="hf-agent-name">${esc(name)}</span>
                                    <span class="hf-agent-role">${esc(role)}</span>
                                </div>
                                <div class="hf-agent-summary">${esc(summary || 'No notes recorded.')}</div>
                                <div class="hf-agent-score-col">
                                    <span class="hf-agent-mini-pill rec-${agentVerdict.k}">${esc(agentVerdict.label)}</span>
                                    <span class="hf-agent-mini-score rec-${agentVerdict.k}">${ao == null ? '—' : ao.toFixed(1)}<sup>/ 10</sup></span>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    $('d-agents').innerHTML = '<div class="hf-agents-empty">No per-agent reviews available.</div>';
                }

                // ---- Watch interview button state ----
                const watchBtn = $('d-watch-btn');
                if (!rec || !rec.view_link) {
                    watchBtn.disabled = true;
                    watchBtn.title = 'No recording available';
                }

                // Reveal
                $('hf-loading').classList.add('hidden');
                $('hf-detail').classList.remove('hidden');
            } catch (e) {
                console.error('[HF] loadDetail error:', e);
                this._showEmpty('Failed to load feedback. Please try again.');
            }
        },
    };

    window.HF = HF;
    HF._initUser();

    if (!roomId) {
        // No room — fall back to pipeline list or monitor
        if (pipelineId) window.location.replace(`/f9pj?id=${encodeURIComponent(pipelineId)}`);
        else window.location.replace('/d2mw');
        return;
    }

    HF.loadDetail(pipelineId, roomId);
})();
