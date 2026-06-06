/**
 * Scoreniq - Candidate Search Dashboard
 * Searches LinkedIn, Naukri & Indeed for matching candidate profiles using AI
 */

const CandidateSearch = {
    API_BASE: window.location.origin,
    user: null,
    lastResult: null,

    init() {
        this.checkAuth();
        this.loadFromURL();
    },

    checkAuth() {
        const userData = localStorage.getItem('fluenzoUser');
        if (!userData) { window.location.href = '/'; return; }
        this.user = JSON.parse(userData);
    },

    // Load JD from URL params (when coming from conversation page)
    loadFromURL() {
        const params = new URLSearchParams(window.location.search);
        const jd = params.get('jd');
        const role = params.get('role');

        if (jd) {
            document.getElementById('sc-jd-input').value = decodeURIComponent(jd);
        }
        if (role) {
            const select = document.getElementById('sc-role-input');
            for (let opt of select.options) {
                if (opt.value === role) { opt.selected = true; break; }
            }
        }

        // Auto-search if JD was passed
        if (jd && jd.trim().length > 30) {
            this.search();
        }
    },

    // ==================== Main Search ====================

    async search() {
        const jd = document.getElementById('sc-jd-input').value.trim();
        const role = document.getElementById('sc-role-input').value;

        if (!jd) {
            this.showToast('Please paste a job description first');
            return;
        }

        if (jd.length < 30) {
            this.showToast('Job description is too short. Add more details for better results.');
            return;
        }

        this.showLoading();

        // Animate loading steps
        setTimeout(() => this.activateStep('sc-step-extract', 'sc-step-search'), 2000);
        setTimeout(() => this.activateStep('sc-step-search', 'sc-step-rank'), 6000);

        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/search-candidates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_description: jd,
                    hiring_role: role
                })
            });

            const data = await res.json();
            this.lastResult = data;

            if (data.success && data.profiles && data.profiles.length > 0) {
                this.renderKeywords(data.keywords);
                this.renderProfiles(data.profiles);
                this.showResults();
            } else {
                this.showEmpty();
            }
        } catch (err) {
            console.error('[Candidate Search] Error:', err);
            this.showToast('Search failed. Please try again.');
            this.hideLoading();
        }
    },

    clearSearch() {
        document.getElementById('sc-jd-input').value = '';
        document.getElementById('sc-role-input').selectedIndex = 0;
        document.getElementById('sc-keywords-bar').classList.add('sc-hidden');
        document.getElementById('sc-results-section').classList.add('sc-hidden');
        document.getElementById('sc-empty').classList.add('sc-hidden');
        this.lastResult = null;
    },

    // ==================== Loading State ====================

    showLoading() {
        document.getElementById('sc-loading').classList.remove('sc-hidden');
        document.getElementById('sc-results-section').classList.add('sc-hidden');
        document.getElementById('sc-keywords-bar').classList.add('sc-hidden');
        document.getElementById('sc-empty').classList.add('sc-hidden');
        document.getElementById('sc-btn-search').disabled = true;

        // Reset loading steps
        ['sc-step-extract', 'sc-step-search', 'sc-step-rank'].forEach(id => {
            const el = document.getElementById(id);
            el.className = 'sc-loading-step';
        });
        document.getElementById('sc-step-extract').classList.add('active');
    },

    hideLoading() {
        document.getElementById('sc-loading').classList.add('sc-hidden');
        document.getElementById('sc-btn-search').disabled = false;
    },

    activateStep(doneId, nextId) {
        const done = document.getElementById(doneId);
        const next = document.getElementById(nextId);
        if (done) { done.classList.remove('active'); done.classList.add('done'); }
        if (next) { next.classList.add('active'); }
    },

    showResults() {
        this.hideLoading();
        document.getElementById('sc-results-section').classList.remove('sc-hidden');
    },

    showEmpty() {
        this.hideLoading();
        document.getElementById('sc-empty').classList.remove('sc-hidden');
    },

    // ==================== Render Keywords ====================

    renderKeywords(keywords) {
        if (!keywords) return;

        const container = document.getElementById('sc-keywords-row');
        const bar = document.getElementById('sc-keywords-bar');
        let chips = [];

        // Job title
        if (keywords.job_title) {
            chips.push(`<span class="sc-keyword-chip">${this.esc(keywords.job_title)}</span>`);
        }

        // Alternate titles
        (keywords.alternate_titles || []).forEach(t => {
            chips.push(`<span class="sc-keyword-chip">${this.esc(t)}</span>`);
        });

        // Must-have skills
        (keywords.must_have_skills || []).forEach(s => {
            chips.push(`<span class="sc-keyword-chip skill">${this.esc(s)}</span>`);
        });

        // Experience
        if (keywords.experience_range) {
            chips.push(`<span class="sc-keyword-chip experience">${this.esc(keywords.experience_range)}</span>`);
        }

        // Certifications
        (keywords.certifications || []).forEach(c => {
            chips.push(`<span class="sc-keyword-chip cert">${this.esc(c)}</span>`);
        });

        // Locations
        (keywords.location_hints || []).forEach(l => {
            chips.push(`<span class="sc-keyword-chip location">${this.esc(l)}</span>`);
        });

        container.innerHTML = chips.join('');
        document.getElementById('sc-keywords-count').textContent = `${chips.length} keywords extracted`;
        bar.classList.remove('sc-hidden');
    },

    // ==================== Render Profiles ====================

    renderProfiles(profiles) {
        const grid = document.getElementById('sc-profiles-grid');
        const title = document.getElementById('sc-results-title');
        const meta = document.getElementById('sc-results-meta');

        title.textContent = `Matching Candidates (${profiles.length})`;
        meta.textContent = `Searched across LinkedIn, Naukri & Indeed`;

        grid.innerHTML = profiles.map((p, i) => this.renderProfileCard(p, i + 1)).join('');

        // Animate score circles after render
        requestAnimationFrame(() => {
            document.querySelectorAll('.sc-match-score-fill').forEach(circle => {
                const score = parseInt(circle.dataset.score || 0);
                const circumference = 2 * Math.PI * 20;
                const offset = circumference - (score / 100) * circumference;
                circle.style.strokeDashoffset = offset;
            });
        });
    },

    renderProfileCard(profile, rank) {
        const name = profile.name || 'Unknown';
        const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const portal = (profile.portal || 'Other').toLowerCase();
        const score = profile.match_score || 0;
        const scoreClass = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
        const scoreColor = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
        const circumference = 2 * Math.PI * 20;
        const rankClass = rank <= 3 ? 'top-3' : '';

        const reasons = (profile.match_reasons || []).map(r =>
            `<div class="sc-match-reason">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ${this.esc(r)}
            </div>`
        ).join('');

        const locationHtml = profile.location
            ? `<span class="sc-profile-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${this.esc(profile.location)}
               </span>`
            : '';

        const expHtml = profile.experience_hint
            ? `<span class="sc-profile-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>
                ${this.esc(profile.experience_hint)}
               </span>`
            : '';

        const portalTag = `<span class="sc-portal-tag ${portal}">${this.esc(profile.portal || 'Web')}</span>`;

        const viewBtnClass = portal === 'linkedin' ? 'linkedin' : portal === 'naukri' ? 'naukri' : portal === 'indeed' ? 'indeed' : '';
        const profileUrl = profile.url || '#';

        return `
        <div class="sc-profile-card">
            <div class="sc-rank-badge ${rankClass}">#${rank}</div>
            <div class="sc-profile-top">
                <div class="sc-profile-avatar ${portal}">${initials}</div>
                <div class="sc-profile-info">
                    <div class="sc-profile-name">${this.esc(name)}</div>
                    <div class="sc-profile-headline">${this.esc(profile.headline || 'Professional')}</div>
                </div>
            </div>
            <div class="sc-profile-meta">
                ${portalTag}
                ${locationHtml}
                ${expHtml}
            </div>
            <div class="sc-match-section">
                <div class="sc-match-score">
                    <svg viewBox="0 0 44 44">
                        <circle class="sc-match-score-bg" cx="22" cy="22" r="20"/>
                        <circle class="sc-match-score-fill" cx="22" cy="22" r="20"
                            stroke="${scoreColor}"
                            stroke-dasharray="${circumference}"
                            stroke-dashoffset="${circumference}"
                            data-score="${score}"/>
                    </svg>
                    <span class="sc-match-score-text ${scoreClass}">${score}</span>
                </div>
                <div class="sc-match-reasons">${reasons}</div>
            </div>
            <div class="sc-profile-actions">
                <a href="${this.esc(profileUrl)}" target="_blank" rel="noopener noreferrer" class="sc-btn-profile sc-btn-view ${viewBtnClass}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    View Profile
                </a>
            </div>
        </div>`;
    },

    // ==================== Utilities ====================

    esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    showToast(msg, duration = 3000) {
        const toast = document.getElementById('sc-toast');
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), duration);
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => CandidateSearch.init());
