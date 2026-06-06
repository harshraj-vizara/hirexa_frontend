/**
 * Screening Round Feedback Dashboard
 * Lists interview feedback with filters and detailed view per interview.
 * New layout: Dimension scores shown once, per-agent short reviews, combined summary.
 */

const FeedbackDashboard = {
    user: null,
    API_BASE: window.location.origin,
    currentPage: 1,
    totalPages: 1,

    // ==================== INIT ====================

    _pollTimer: null,
    _pollStartTime: 0,

    init() {
        this.checkAuth();
        this.loadStats();
        this.loadList();

        const pendingRoomId = localStorage.getItem('lastScreeningRoomId');
        if (pendingRoomId) {
            localStorage.removeItem('lastScreeningRoomId');
            this._showLoadingAndPoll(pendingRoomId);
        }
    },

    checkAuth() {
        const userData = localStorage.getItem('fluenzoUser');
        if (!userData) { window.location.href = '/'; return; }
        this.user = JSON.parse(userData);
        const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-zÀ-ɏ])/g, (m, a, b) => a + b.toUpperCase());
        const info = document.getElementById('sfb-user-info');
        if (info) info.textContent = this.user.name ? titleCase(this.user.name) : (this.user.email || '');
    },

    // ==================== STATS ====================

    async loadStats() {
        try {
            const params = new URLSearchParams();
            if (this.user?.email) params.set('recruiter_email', this.user.email);
            if (this.user?.id) params.set('user_id', this.user.id);

            const res = await fetch(`${this.API_BASE}/api/screening_feedback/stats?${params}`);
            const data = await res.json();

            if (data.success) {
                const s = data.stats;
                document.getElementById('stat-total').textContent = s.total_interviews || 0;
                document.getElementById('stat-avg').textContent = s.avg_score ? s.avg_score.toFixed(1) : '-';
                document.getElementById('stat-recommended').textContent = s.recommended || 0;
                document.getElementById('stat-rejected').textContent = s.not_recommended || 0;
            }
        } catch (e) {
            console.error('[Feedback] Stats error:', e);
        }
    },

    // ==================== LIST ====================

    async loadList(page = 1) {
        this.currentPage = page;

        const params = new URLSearchParams();
        if (this.user?.email) params.set('recruiter_email', this.user.email);
        if (this.user?.id) params.set('user_id', this.user.id);
        params.set('page', page);
        params.set('limit', 15);

        const candidate = document.getElementById('filter-candidate')?.value?.trim();
        const role = document.getElementById('filter-role')?.value?.trim();
        const dateFrom = document.getElementById('filter-date-from')?.value;
        const dateTo = document.getElementById('filter-date-to')?.value;
        const rec = document.getElementById('filter-recommendation')?.value;

        if (candidate) params.set('candidate_name', candidate);
        if (role) params.set('hiring_role', role);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (rec) params.set('recommendation', rec);

        try {
            const res = await fetch(`${this.API_BASE}/api/screening_feedback/list?${params}`);
            const data = await res.json();

            // Hide initial loader
            const loader = document.getElementById('sfb-initial-loader');
            if (loader) loader.style.display = 'none';

            if (data.success) {
                this.totalPages = data.total_pages;
                this.renderList(data.data);
                this.renderPagination(data.page, data.total_pages);
            }
        } catch (e) {
            console.error('[Feedback] List error:', e);
            const loader = document.getElementById('sfb-initial-loader');
            if (loader) loader.style.display = 'none';
        }
    },

    renderList(items) {
        const container = document.getElementById('sfb-list');
        const empty = document.getElementById('sfb-empty');

        if (!items || items.length === 0) {
            container.innerHTML = '';
            const emptyEl = empty || this._createEmpty();
            emptyEl.classList.remove('sfb-hidden');
            container.appendChild(emptyEl);
            return;
        }

        if (empty) empty.style.display = 'none';

        container.innerHTML = items.map(item => {
            const score = item.overall_score ? parseFloat(item.overall_score) : null;
            const scoreColor = this._scoreColorClass(score);
            const recClass = this._recBadgeClass(item.recommendation);
            const recLabel = this._recLabel(item.recommendation);
            const dateStr = this._formatDate(item.ended_at);
            const duration = this._formatDuration(item.actual_duration_seconds);

            return `
            <div class="sfb-item" onclick="FeedbackDashboard.showDetail('${item.room_id}')">
                <div class="sfb-item-main">
                    <div class="sfb-item-name">${this._esc(item.candidate_name || 'Candidate')}</div>
                    <div class="sfb-item-meta">
                        <span>${this._esc(item.hiring_role || 'N/A')}</span>
                        <span>${dateStr}</span>
                        <span>${duration}</span>
                        <span>${(item.difficulty || 'moderate').charAt(0).toUpperCase() + (item.difficulty || 'moderate').slice(1)}</span>
                    </div>
                </div>
                <div class="sfb-item-score">
                    ${score !== null ? `<div class="sfb-item-score-value ${scoreColor}">${score.toFixed(1)}</div>` : '<div class="sfb-item-score-value" style="color:var(--text-faint)">-</div>'}
                    <div class="sfb-item-score-label">/10</div>
                </div>
                <div>
                    <span class="sfb-badge ${recClass}">${recLabel}</span>
                </div>
                <button class="sfb-item-delete" title="Delete feedback" onclick="event.stopPropagation(); FeedbackDashboard.confirmDelete('${item.room_id}', '${this._esc(item.candidate_name || 'Candidate')}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </div>`;
        }).join('');
    },

    renderPagination(current, total) {
        const container = document.getElementById('sfb-pagination');
        if (total <= 1) { container.innerHTML = ''; return; }

        let html = '';
        for (let i = 1; i <= total; i++) {
            html += `<button class="sfb-page-btn ${i === current ? 'active' : ''}" onclick="FeedbackDashboard.loadList(${i})">${i}</button>`;
        }
        container.innerHTML = html;
    },

    // ==================== DETAIL ====================

    async showDetail(roomId) {
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_feedback/detail/${roomId}`);
            const data = await res.json();

            if (!data.success) return;

            document.getElementById('sfb-list-view').classList.add('sfb-hidden');
            document.getElementById('sfb-detail-view').classList.remove('sfb-hidden');
            document.getElementById('sfb-filters').classList.add('sfb-hidden');
            document.getElementById('sfb-stats-bar').classList.add('sfb-hidden');
            document.querySelector('.sfb-back-dashboard')?.classList.add('sfb-hidden');

            this.renderDetail(data);
        } catch (e) {
            console.error('[Feedback] Detail error:', e);
        }
    },

    showList() {
        document.getElementById('sfb-list-view').classList.remove('sfb-hidden');
        document.getElementById('sfb-detail-view').classList.add('sfb-hidden');
        document.getElementById('sfb-filters').classList.remove('sfb-hidden');
        document.getElementById('sfb-stats-bar').classList.remove('sfb-hidden');
        document.querySelector('.sfb-back-dashboard')?.classList.remove('sfb-hidden');
    },

    renderDetail(data) {
        const { interview, summary, agent_feedbacks, proctoring, recording } = data;
        const container = document.getElementById('sfb-detail-content');

        if (!summary) {
            container.innerHTML = '<div class="sfb-empty"><h3>Feedback not yet generated</h3><p>The AI is still analyzing this interview.</p></div>';
            return;
        }

        const score = parseFloat(summary.overall_score || 0);
        const scoreColor = this._scoreColorClass(score);
        const recClass = this._recBadgeClass(summary.recommendation);
        const recLabel = this._recLabel(summary.recommendation);
        const dateStr = this._formatDate(interview.ended_at);
        const duration = this._formatDuration(interview.actual_duration_seconds);

        // ===== SECTION 1: Header with overall score & recommendation =====
        const headerHtml = `
        <div class="sfb-detail-header">
            <div class="sfb-detail-top">
                <div>
                    <div class="sfb-detail-candidate">${this._esc(interview.candidate_name || 'Candidate')}</div>
                    <div class="sfb-detail-role">${this._esc(interview.hiring_role || 'N/A')}</div>
                    <div class="sfb-detail-meta">
                        <span>${dateStr}</span>
                        <span>Duration: ${duration}</span>
                        <span>${(interview.difficulty || 'moderate').charAt(0).toUpperCase() + (interview.difficulty || '').slice(1)}</span>
                        <span>Ended by: ${interview.ended_by || 'auto'}</span>
                    </div>
                </div>
                <div class="sfb-detail-actions">
                    <div class="sfb-detail-score-big">
                        <div class="sfb-detail-score-num ${scoreColor}">${score.toFixed(1)}</div>
                        <div class="sfb-detail-score-sub">/10 Overall</div>
                    </div>
                    <button class="sfb-btn sfb-btn-danger" onclick="FeedbackDashboard.confirmDelete('${interview.room_id}', '${this._esc(interview.candidate_name || 'Candidate')}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete
                    </button>
                </div>
            </div>
            <div class="sfb-detail-rec">
                <span class="sfb-badge ${recClass}">${recLabel}</span>
                <span class="sfb-detail-rec-text">${this._esc(summary.recommendation_text || '')}</span>
            </div>
        </div>`;

        // ===== SECTION 2: 9 Dimension Scores (shown ONCE) =====
        const dimAvgRaw = summary.dimension_averages || {};
        const coreValuesData = dimAvgRaw._core_values || {};
        const dimAvg = {};
        for (const [k, v] of Object.entries(dimAvgRaw)) {
            if (k !== '_core_values') dimAvg[k] = v;
        }

        const dimNames = {
            communication: 'Communication', technical: 'Technical', problem_solving: 'Problem-Solving',
            behavioral: 'Behavioral (BEI)', cultural_fit: 'Cultural Fit', experience: 'Experience',
            learning: 'Learning', authenticity: 'Authenticity (Hogan)', time_efficiency: 'Time Efficiency'
        };

        const dimsHtml = Object.entries(dimAvg).map(([key, val]) => {
            const v = typeof val === 'object' ? parseFloat(val.score || 0) : parseFloat(val);
            const feedback = typeof val === 'object' ? (val.feedback || '') : '';
            const c = this._scoreColorClass(v);
            return `
            <div class="sfb-dim-card">
                <div class="sfb-dim-header-row">
                    <div class="sfb-dim-name">${dimNames[key] || key}</div>
                    <div class="sfb-dim-score-val ${c}">${v.toFixed(1)}</div>
                </div>
                <div class="sfb-dim-bar">
                    <div class="sfb-dim-bar-fill" style="width:${v*10}%; background:${this._scoreHex(v)}"></div>
                </div>
                ${feedback ? `<div class="sfb-dim-feedback">${this._esc(feedback)}</div>` : ''}
            </div>`;
        }).join('');

        // Core Values dimension scores (if any)
        let cvDimsHtml = '';
        if (Object.keys(coreValuesData).length > 0) {
            const cvCards = Object.entries(coreValuesData).map(([key, val]) => {
                const v = typeof val === 'object' ? parseFloat(val.score || 0) : parseFloat(val);
                const feedback = typeof val === 'object' ? (val.feedback || '') : '';
                const c = this._scoreColorClass(v);
                const name = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                return `
                <div class="sfb-dim-card">
                    <div class="sfb-dim-header-row">
                        <div class="sfb-dim-name">${name}</div>
                        <div class="sfb-dim-score-val ${c}">${v.toFixed(1)}</div>
                    </div>
                    <div class="sfb-dim-bar">
                        <div class="sfb-dim-bar-fill" style="width:${v*10}%; background:${this._scoreHex(v)}"></div>
                    </div>
                    ${feedback ? `<div class="sfb-dim-feedback">${this._esc(feedback)}</div>` : ''}
                </div>`;
            }).join('');

            cvDimsHtml = `
            <div class="sfb-section">
                <div class="sfb-section-title">Core Values Assessment</div>
                <div class="sfb-dims-grid">${cvCards}</div>
            </div>`;
        }

        // ===== SECTION 3: Strengths & Improvements =====
        const strengths = summary.top_strengths || [];
        const improvements = summary.top_improvements || [];

        const siHtml = `
        <div class="sfb-si-grid">
            <div class="sfb-si-card">
                <div class="sfb-si-title green">Key Strengths</div>
                <ul class="sfb-si-list">
                    ${strengths.map(s => `<li><span class="sfb-si-icon green">&#10003;</span> ${this._esc(s)}</li>`).join('')}
                </ul>
            </div>
            <div class="sfb-si-card">
                <div class="sfb-si-title amber">Areas for Improvement</div>
                <ul class="sfb-si-list">
                    ${improvements.map(i => `<li><span class="sfb-si-icon amber">&#9650;</span> ${this._esc(i)}</li>`).join('')}
                </ul>
            </div>
        </div>`;

        // ===== SECTION 4: Per-Agent Reviews (short, personalized) =====
        const agentHtml = agent_feedbacks.map(af => this._renderAgentReview(af)).join('');

        // ===== SECTION 5: Transcript =====
        const convMessages = data.conversation_messages && data.conversation_messages.length > 0
            ? data.conversation_messages.map(m => ({
                speaker: m.speaker || 'Unknown',
                type: m.speaker_type || 'system',
                text: m.message_text || '',
            }))
            : (interview.conversation || []);

        const transcriptHtml = convMessages.filter(m => m.type !== 'system').map(m => {
            const speakerClass = m.type === 'agent' ? 'agent' : m.type === 'candidate' ? 'candidate' : 'system';
            return `
            <div class="sfb-msg">
                <div class="sfb-msg-speaker ${speakerClass}">${this._esc(m.speaker || 'Unknown')}</div>
                <div class="sfb-msg-text">${this._esc(m.text || '')}</div>
            </div>`;
        }).join('');

        // ===== SECTION: Proctoring & Behavioral Report =====
        const proctoringHtml = proctoring ? this._renderProctoring(proctoring) : '';

        // ===== SECTION: Interview Recording =====
        const recordingHtml = recording ? this._renderRecording(recording) : '';

        // ===== RENDER ALL =====
        container.innerHTML = `
        ${headerHtml}

        ${recordingHtml}

        <div class="sfb-section-title">Evaluation Scorecard</div>
        <div class="sfb-dims-grid">${dimsHtml}</div>

        ${cvDimsHtml}

        ${proctoringHtml}

        ${siHtml}

        <div class="sfb-section-title">Interview Panel</div>
        <div class="sfb-agents-grid">${agentHtml}</div>

        <div class="sfb-transcript">
            <div class="sfb-transcript-toggle" onclick="this.parentElement.querySelector('.sfb-transcript-body').classList.toggle('sfb-hidden'); this.querySelector('.sfb-toggle-arrow').classList.toggle('sfb-expanded')">
                <span class="sfb-section-title" style="margin:0;flex:unset">Interview Transcript</span>
                <span class="sfb-toggle-arrow" style="color:var(--text-faint);font-size:18px;transition:transform 0.2s">&#9662;</span>
            </div>
            <div class="sfb-transcript-body sfb-hidden">
                ${transcriptHtml || '<p style="color:rgba(255,255,255,0.3);font-size:13px;">No transcript available.</p>'}
            </div>
        </div>`;
    },

    _renderRecording(rec) {
        const sizeMB = rec.file_size_bytes ? (rec.file_size_bytes / 1024 / 1024).toFixed(1) : '0';
        const duration = rec.duration_seconds ? this._formatDuration(rec.duration_seconds) : 'N/A';
        const uploadDate = rec.uploaded_at ? new Date(rec.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

        return `
        <div class="sfb-recording-card">
            <div class="sfb-recording-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
            </div>
            <div class="sfb-recording-info">
                <div class="sfb-recording-title">Interview Recording</div>
                <div class="sfb-recording-meta">${duration} &bull; ${sizeMB} MB &bull; ${uploadDate}</div>
            </div>
            <div class="sfb-recording-actions">
                <a href="${rec.view_link}" target="_blank" rel="noopener" class="sfb-recording-btn sfb-recording-btn-play">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Watch
                </a>
                ${rec.download_link ? `<a href="${rec.download_link}" target="_blank" rel="noopener" class="sfb-recording-btn sfb-recording-btn-download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                </a>` : ''}
            </div>
        </div>`;
    },

    _renderProctoring(p) {
        const integrity = parseFloat(p.integrity_score || 100);
        const integrityColor = integrity >= 80 ? '#10b981' : integrity >= 60 ? '#f59e0b' : '#ef4444';
        const integrityLabel = integrity >= 80 ? 'Good' : integrity >= 60 ? 'Moderate' : 'Low';

        // Flags
        const flags = [
            { label: 'Gaze Off-screen', value: `${(p.gaze_offscreen_pct || 0).toFixed(1)}%`, icon: '&#128064;', bad: v => parseFloat(v) > 20 },
            { label: 'Tab Switches', value: p.tab_switch_count || 0, icon: '&#128241;', bad: v => v > 2 },
        ];

        const flagsHtml = flags.map(f => {
            const isBad = f.bad(f.value);
            return `<div class="sfb-proctor-flag ${isBad ? 'sfb-proctor-flag-bad' : ''}">
                <div class="sfb-proctor-flag-icon">${f.icon}</div>
                <div class="sfb-proctor-flag-value">${f.value}</div>
                <div class="sfb-proctor-flag-label">${f.label}</div>
            </div>`;
        }).join('');

        // Behavioral metrics
        const behavioral = [
            { label: 'Eye Contact', value: `${(p.eye_contact_pct || 0).toFixed(1)}%`, color: this._scoreHex(p.eye_contact_pct / 10) },
            { label: 'Head Stability', value: `${(p.head_stability_score || 0).toFixed(1)}%`, color: this._scoreHex(p.head_stability_score / 10) },
            { label: 'Looking Away/min', value: (p.looking_away_per_min || 0).toFixed(1), color: p.looking_away_per_min > 5 ? '#ef4444' : p.looking_away_per_min > 2 ? '#f59e0b' : '#10b981' },
        ];

        const behavioralHtml = behavioral.map(b =>
            `<div class="sfb-proctor-metric">
                <div class="sfb-proctor-metric-value" style="color:${b.color}">${b.value}</div>
                <div class="sfb-proctor-metric-label">${b.label}</div>
            </div>`
        ).join('');

        // Tab away duration
        const tabAwayStr = p.tab_away_seconds ? `${p.tab_away_seconds}s away from tab` : '';

        // Event timeline
        const events = p.events || [];
        let timelineHtml = '';
        if (events.length > 0) {
            const eventsListHtml = events.slice(0, 50).map(e => {
                const mins = Math.floor(e.time / 60);
                const secs = e.time % 60;
                const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                const typeClass = e.type === 'multiple_faces' || e.type === 'face_identity_change' ? 'sfb-proctor-evt-bad' : 'sfb-proctor-evt-warn';
                return `<div class="sfb-proctor-evt ${typeClass}">
                    <span class="sfb-proctor-evt-time">${timeStr}</span>
                    <span class="sfb-proctor-evt-desc">${this._esc(e.description)}</span>
                </div>`;
            }).join('');

            timelineHtml = `
            <div class="sfb-proctor-timeline">
                <div class="sfb-proctor-timeline-toggle" onclick="this.nextElementSibling.classList.toggle('sfb-hidden'); this.querySelector('.sfb-toggle-arrow').classList.toggle('sfb-expanded')">
                    <span>Event Timeline (${events.length} events)</span>
                    <span class="sfb-toggle-arrow" style="font-size:16px;transition:transform 0.2s">&#9662;</span>
                </div>
                <div class="sfb-proctor-timeline-body sfb-hidden">
                    ${eventsListHtml}
                </div>
            </div>`;
        }

        return `
        <div class="sfb-section-title">Proctoring &amp; Behavioral Report</div>
        <div class="sfb-proctor-section">
            <div class="sfb-proctor-top">
                <div class="sfb-proctor-gauge">
                    <div class="sfb-proctor-gauge-ring" style="--gauge-color:${integrityColor};--gauge-pct:${integrity}">
                        <div class="sfb-proctor-gauge-inner">
                            <div class="sfb-proctor-gauge-value" style="color:${integrityColor}">${integrity.toFixed(0)}</div>
                            <div class="sfb-proctor-gauge-label">Integrity</div>
                        </div>
                    </div>
                    <div class="sfb-proctor-gauge-status" style="color:${integrityColor}">${integrityLabel}</div>
                </div>
                <div class="sfb-proctor-behavioral">
                    ${behavioralHtml}
                </div>
            </div>

            <div class="sfb-proctor-flags-grid">
                ${flagsHtml}
            </div>

            ${tabAwayStr ? `<div class="sfb-proctor-tab-note">${tabAwayStr}</div>` : ''}

            <div class="sfb-proctor-meta">
                ${p.total_frames || 0} frames analyzed over ${this._formatDuration(p.duration_seconds)}
            </div>

            ${timelineHtml}
        </div>`;
    },

    _renderAgentReview(af) {
        const score = parseFloat(af.overall_score || 0);
        const scoreColor = this._scoreColorClass(score);

        // recommendation_text contains the review (new format)
        const review = af.recommendation_text || '';

        // strengths[0] = key_strength, improvements[0] = area_for_improvement
        const strengths = af.strengths || [];
        const improvements = af.improvements || [];
        const keyStrength = Array.isArray(strengths) ? (strengths[0] || '') : '';
        const keyImprovement = Array.isArray(improvements) ? (improvements[0] || '') : '';

        // Check if this is old format (has dimensions with scores) or new format (has review text)
        const dims = af.dimensions || {};
        const hasOldFormat = Object.keys(dims).length > 0 && !review;

        if (hasOldFormat) {
            // Backwards compatible: show old format agent card
            return this._renderAgentCardLegacy(af);
        }

        return `
        <div class="sfb-agent-review">
            <div class="sfb-agent-review-header">
                <div class="sfb-agent-review-info">
                    <div class="sfb-agent-review-name">${this._esc(af.agent_name || 'Agent')}</div>
                    <div class="sfb-agent-review-role">${this._esc(af.agent_role || '')}</div>
                </div>
                <div class="sfb-agent-review-score ${scoreColor}">${score.toFixed(1)}<span class="sfb-agent-review-score-sub">/10</span></div>
            </div>
            <div class="sfb-agent-review-text">${this._esc(review)}</div>
            <div class="sfb-agent-review-tags">
                ${keyStrength ? `<span class="sfb-agent-tag green">&#10003; ${this._esc(keyStrength)}</span>` : ''}
                ${keyImprovement ? `<span class="sfb-agent-tag amber">&#9650; ${this._esc(keyImprovement)}</span>` : ''}
            </div>
        </div>`;
    },

    _renderAgentCardLegacy(af) {
        // Legacy format for old data that has per-agent dimensions
        const score = parseFloat(af.overall_score || 0);
        const scoreColor = this._scoreColorClass(score);
        const recText = af.recommendation_text || '';

        return `
        <div class="sfb-agent-review">
            <div class="sfb-agent-review-header">
                <div class="sfb-agent-review-info">
                    <div class="sfb-agent-review-name">${this._esc(af.agent_name || 'Agent')}</div>
                    <div class="sfb-agent-review-role">${this._esc(af.agent_role || '')}</div>
                </div>
                <div class="sfb-agent-review-score ${scoreColor}">${score.toFixed(1)}<span class="sfb-agent-review-score-sub">/10</span></div>
            </div>
            <div class="sfb-agent-review-text">${this._esc(recText)}</div>
        </div>`;
    },

    // ==================== FILTERS ====================

    applyFilters() {
        this.loadList(1);
    },

    clearFilters() {
        document.getElementById('filter-candidate').value = '';
        document.getElementById('filter-role').value = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-recommendation').value = '';
        this.loadList(1);
    },

    // ==================== LOADING & POLLING ====================

    _showLoadingAndPoll(roomId) {
        const overlay = document.getElementById('sfb-loading-overlay');
        overlay.classList.remove('sfb-hidden');
        this._pollStartTime = Date.now();

        const statusMsgs = [
            'Analyzing interview conversation...',
            'Collecting agent evaluations...',
            'Scoring across 9 dimensions...',
            'Preparing final recommendation...',
            'Generating feedback report...',
        ];

        let msgIdx = 0;
        const statusEl = document.getElementById('sfb-loading-status');
        const barEl = document.getElementById('sfb-loading-bar');

        const msgTimer = setInterval(() => {
            msgIdx = Math.min(msgIdx + 1, statusMsgs.length - 1);
            statusEl.textContent = statusMsgs[msgIdx];
        }, 8000);

        let generateTriggered = false;

        this._pollTimer = setInterval(async () => {
            const elapsed = (Date.now() - this._pollStartTime) / 1000;
            const progress = Math.min(90, (elapsed / 60) * 90);
            barEl.style.width = progress + '%';

            try {
                const res = await fetch(`${this.API_BASE}/api/screening_feedback/detail/${roomId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.summary) {
                        clearInterval(this._pollTimer);
                        clearInterval(msgTimer);
                        barEl.style.width = '100%';
                        statusEl.textContent = 'Feedback ready!';

                        setTimeout(() => {
                            overlay.classList.add('sfb-hidden');
                            this.loadStats();
                            this.loadList();
                            this.showDetail(roomId);
                        }, 600);
                        return;
                    }
                    if (!generateTriggered) {
                        generateTriggered = true;
                        statusEl.textContent = 'Generating AI feedback...';
                        fetch(`${this.API_BASE}/api/screening_feedback/generate/${roomId}`, { method: 'POST' })
                            .then(r => r.json())
                            .then(d => console.log('[Feedback] Generate response:', d))
                            .catch(e => console.error('[Feedback] Generate error:', e));
                    }
                }
            } catch (e) {
                console.error('[Feedback] Poll error:', e);
            }

            if (elapsed > 180) {
                clearInterval(this._pollTimer);
                clearInterval(msgTimer);
                overlay.classList.add('sfb-hidden');
                statusEl.textContent = 'Taking longer than expected...';
                this.loadStats();
                this.loadList();
            }
        }, 4000);
    },

    // ==================== DELETE ====================

    confirmDelete(roomId, candidateName) {
        // Remove any existing modal
        const existing = document.querySelector('.sfb-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sfb-modal-overlay';
        overlay.innerHTML = `
            <div class="sfb-modal">
                <div class="sfb-modal-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
                <h3>Delete Feedback</h3>
                <p>Are you sure you want to delete the interview feedback for <strong>${this._esc(candidateName)}</strong>? This action cannot be undone.</p>
                <div class="sfb-modal-actions">
                    <button class="sfb-btn sfb-btn-ghost" onclick="this.closest('.sfb-modal-overlay').remove()">Cancel</button>
                    <button class="sfb-btn sfb-btn-confirm-delete" onclick="FeedbackDashboard.deleteFeedback('${roomId}')">Delete</button>
                </div>
            </div>
        `;
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    },

    async deleteFeedback(roomId) {
        // Remove modal
        const modal = document.querySelector('.sfb-modal-overlay');
        if (modal) modal.remove();

        try {
            const res = await fetch(`${this.API_BASE}/api/screening_feedback/delete/${roomId}`, {
                method: 'DELETE',
            });
            const data = await res.json();

            if (data.success) {
                // If viewing detail, go back to list
                const detailView = document.getElementById('sfb-detail-view');
                if (detailView && !detailView.classList.contains('sfb-hidden')) {
                    this.showList();
                }
                // Refresh data
                this.loadStats();
                this.loadList(this.currentPage);
            } else {
                alert('Failed to delete: ' + (data.detail || 'Unknown error'));
            }
        } catch (e) {
            console.error('[Feedback] Delete error:', e);
            alert('Failed to delete feedback. Please try again.');
        }
    },

    // ==================== HELPERS ====================

    _scoreColorClass(score) {
        if (score === null || score === undefined) return '';
        if (score >= 8.0) return 'score-green';
        if (score >= 6.0) return 'score-blue';
        if (score >= 4.0) return 'score-amber';
        return 'score-red';
    },

    _scoreHex(score) {
        if (score >= 8.0) return '#10b981';
        if (score >= 6.0) return '#3b82f6';
        if (score >= 4.0) return '#f59e0b';
        return '#ef4444';
    },

    _recBadgeClass(rec) {
        const map = {
            strong_yes: 'sfb-badge-strong-yes', yes: 'sfb-badge-yes',
            maybe: 'sfb-badge-maybe', no: 'sfb-badge-no',
            strong_no: 'sfb-badge-strong-no', needs_review: 'sfb-badge-needs-review'
        };
        return map[rec] || 'sfb-badge-needs-review';
    },

    _recLabel(rec) {
        const map = {
            strong_yes: 'Strong Yes', yes: 'Yes', maybe: 'Maybe',
            no: 'No', strong_no: 'Strong No', needs_review: 'Review'
        };
        return map[rec] || 'Review';
    },

    _formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return dateStr; }
    },

    _formatDuration(seconds) {
        if (!seconds) return 'N/A';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    },

    _createEmpty() {
        const div = document.createElement('div');
        div.className = 'sfb-empty';
        div.innerHTML = '<div class="sfb-empty-icon">&#128202;</div><h3>No interviews yet</h3><p>Completed interview feedbacks will appear here</p>';
        return div;
    }
};

document.addEventListener('DOMContentLoaded', () => FeedbackDashboard.init());
