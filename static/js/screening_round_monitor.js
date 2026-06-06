/**
 * Scoreniq - Screening Round Interview Monitor Dashboard
 */
const MonitorDashboard = {
    user: null,
    API_BASE: window.location.origin,
    currentPage: 1,
    currentFilter: 'all',
    searchQuery: '',
    refreshTimer: null,
    totalPages: 1,

    init() {
        this.checkAuth();
        this.loadStats();
        this.loadInterviews();
        this.bindEvents();
        this.startAutoRefresh();
    },

    checkAuth() {
        const userData = localStorage.getItem('fluenzoUser');
        if (!userData) { window.location.href = '/'; return; }
        this.user = JSON.parse(userData);
    },

    bindEvents() {
        // Filter buttons
        document.querySelectorAll('.smi-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.smi-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                this.currentPage = 1;
                this.loadInterviews();
            });
        });

        // Search with debounce
        let searchTimeout;
        document.getElementById('smi-search')?.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.searchQuery = e.target.value.trim();
                this.currentPage = 1;
                this.loadInterviews();
            }, 400);
        });
    },

    async loadStats() {
        try {
            const params = new URLSearchParams();
            if (this.user?.email) params.set('recruiter_email', this.user.email);
            if (this.user?.id) params.set('user_id', this.user.id);

            const res = await fetch(`${this.API_BASE}/api/screening_round/interviews/stats?${params}`);
            const data = await res.json();
            if (data.success) {
                const s = data.stats;
                document.getElementById('stat-scheduled').textContent = s.scheduled || 0;
                document.getElementById('stat-active').textContent = s.active_now || 0;
                document.getElementById('stat-ended-today').textContent = s.ended_today || 0;
                document.getElementById('stat-total').textContent = s.total || 0;
            }
        } catch (err) {
            console.error('Stats load error:', err);
        }
    },

    async loadInterviews() {
        try {
            const params = new URLSearchParams();
            if (this.user?.email) params.set('recruiter_email', this.user.email);
            if (this.user?.id) params.set('user_id', this.user.id);
            if (this.currentFilter !== 'all') params.set('status', this.currentFilter);
            if (this.searchQuery) params.set('search', this.searchQuery);
            params.set('page', this.currentPage);
            params.set('limit', 25);

            const res = await fetch(`${this.API_BASE}/api/screening_round/interviews?${params}`);
            const data = await res.json();

            if (data.success) {
                this.totalPages = data.total_pages || 1;
                this.renderTable(data.data || []);
                this.renderPagination(data.total, data.page, data.total_pages);
            }
        } catch (err) {
            console.error('Interviews load error:', err);
            document.getElementById('smi-table-body').innerHTML =
                '<tr><td colspan="7" class="smi-empty"><p>Failed to load interviews</p></td></tr>';
        }
    },

    renderTable(interviews) {
        const tbody = document.getElementById('smi-table-body');

        if (!interviews.length) {
            tbody.innerHTML = `
                <tr><td colspan="7">
                    <div class="smi-empty">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                        </svg>
                        <p>No interviews found</p>
                        <p><a href="/p8eu">Create your first interview</a></p>
                    </div>
                </td></tr>`;
            return;
        }

        tbody.innerHTML = interviews.map(i => {
            const statusHtml = this._statusBadge(i.status);
            const scheduledStr = i.scheduled_at ? this._formatDate(i.scheduled_at) : '-';
            const createdStr = this._formatDate(i.created_at);
            const scoreHtml = this._scoreBadge(i.feedback_score, i.status);
            const actionsHtml = this._actionButtons(i);

            return `
                <tr>
                    <td>
                        <div class="smi-candidate-name">${this._esc(i.candidate_name || 'Candidate')}</div>
                        ${i.candidate_email ? `<div class="smi-candidate-email">${this._esc(i.candidate_email)}</div>` : ''}
                    </td>
                    <td>${this._esc(i.hiring_role || '-')}</td>
                    <td>${statusHtml}</td>
                    <td>${scheduledStr}</td>
                    <td>${createdStr}</td>
                    <td>${scoreHtml}</td>
                    <td>${actionsHtml}</td>
                </tr>`;
        }).join('');
    },

    _statusBadge(status) {
        const map = {
            scheduled: '<span class="smi-status scheduled"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Scheduled</span>',
            waiting: '<span class="smi-status waiting"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6"/></svg>Waiting</span>',
            active: '<span class="smi-status active"><span class="smi-live-dot"></span>Live</span>',
            ended: '<span class="smi-status ended"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Ended</span>',
            cancelled: '<span class="smi-status cancelled"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Cancelled</span>',
        };
        return map[status] || `<span class="smi-status">${status}</span>`;
    },

    _scoreBadge(score, status) {
        if (status !== 'ended' || score == null) return '-';
        const cls = score >= 7 ? 'smi-score-high' : score >= 5 ? 'smi-score-mid' : 'smi-score-low';
        return `<span class="smi-score ${cls}">${score.toFixed(1)}</span>`;
    },

    _actionButtons(interview) {
        const s = interview.status;
        const rid = interview.room_id;
        let btns = '';

        if (s === 'scheduled' || s === 'waiting' || s === 'active') {
            btns += `<button class="smi-btn smi-btn-join" onclick="MonitorDashboard.joinInterview('${rid}')">Join</button>`;
        }
        if (s !== 'cancelled') {
            btns += `<button class="smi-btn smi-btn-copy" onclick="MonitorDashboard.copyLink('${rid}')">Copy Link</button>`;
        }
        if (s === 'scheduled' || s === 'waiting') {
            btns += `<button class="smi-btn smi-btn-cancel" onclick="MonitorDashboard.cancelInterview('${rid}')">Cancel</button>`;
        }
        if (s === 'ended') {
            btns += `<button class="smi-btn smi-btn-feedback" onclick="MonitorDashboard.viewFeedback('${rid}')">Feedback</button>`;
        }

        return `<div class="smi-actions">${btns}</div>`;
    },

    renderPagination(total, page, totalPages) {
        const el = document.getElementById('smi-pagination');
        if (totalPages <= 1) { el.innerHTML = ''; return; }

        el.innerHTML = `
            <button class="smi-page-btn" onclick="MonitorDashboard.goToPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="smi-page-info">Page ${page} of ${totalPages}</span>
            <button class="smi-page-btn" onclick="MonitorDashboard.goToPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button>
        `;
    },

    goToPage(page) {
        if (page < 1 || page > this.totalPages) return;
        this.currentPage = page;
        this.loadInterviews();
    },

    joinInterview(roomId) {
        // Set recruiter config so room page recognizes us as recruiter
        localStorage.setItem('screeningRoundConfig', JSON.stringify({
            roomId: roomId,
            userId: this.user?.id,
            role: 'recruiter',
            timestamp: new Date().toISOString()
        }));
        window.open(`/t3wr?id=${roomId}`, '_blank');
    },

    copyLink(roomId) {
        const url = `${window.location.origin}/t3wr?id=${roomId}`;
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('Interview link copied');
        }).catch(() => {
            // Fallback
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            this.showToast('Link copied');
        });
    },

    async cancelInterview(roomId) {
        if (!confirm('Cancel this interview? This cannot be undone.')) return;
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/interviews/${roomId}/cancel`, {
                method: 'PATCH',
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('Interview cancelled');
                this.loadStats();
                this.loadInterviews();
            } else {
                this.showToast(data.detail || 'Failed to cancel');
            }
        } catch (err) {
            this.showToast('Cancel failed');
        }
    },

    viewFeedback(roomId) {
        window.location.href = `/s6oz?room=${roomId}`;
    },

    startAutoRefresh() {
        this.refreshTimer = setInterval(() => {
            this.loadStats();
            this.loadInterviews();
        }, 10000);
    },

    _formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            if (isToday) {
                return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        } catch {
            return dateStr.substring(0, 16);
        }
    },

    _esc(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },

    showToast(message) {
        const existing = document.querySelector('.smi-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'smi-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    },
};
