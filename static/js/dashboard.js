/**
 * Scoreniq - Dashboard
 */
const Dashboard = {
    user: null,

    init() {
        this.checkAuth();
        this.setupUser();
        this.bindEvents();
        this.applyHeroState();
    },

    // Hero heading/sub-copy adapt to the recruiter's activity (mirrors the
    // Figma "User cases for landing page" states). Until the pipeline list
    // resolves the HTML default (first-time copy) stays in place, so a slow or
    // failed fetch never blanks the hero.
    async applyHeroState() {
        if (!this.user || !this.user.email) return;
        let pipelines = null;
        try {
            const r = await fetch('/api/pipeline/list?recruiter_email=' + encodeURIComponent(this.user.email));
            const d = await r.json();
            if (d && d.success) pipelines = d.pipelines || [];
        } catch (_) { /* keep HTML default */ }

        const state = this.resolveHeroState(pipelines);
        const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        set('welcome-prefix', state.prefix);
        set('dash-title-bold', state.bold);
        set('dash-title-italic', state.italic);
        set('dash-desc', state.desc);
    },

    // Priority: hired > roles-created > first-time. A failed fetch (pipelines
    // === null) falls back to the generic "welcome back" copy.
    resolveHeroState(pipelines) {
        const FIRST = {
            prefix: 'WELCOME',
            bold: "Let's hire", italic: 'your first role.',
            desc: 'Hire XA turns a job idea into a shortlist of interviewed candidates usually in 3–5 days. Pick where you want to start.',
        };
        if (pipelines === null) {
            return {
                prefix: 'WELCOME BACK',
                bold: "Let's build", italic: 'your team.',
                desc: "Welcome back to Hire XA. Let's continue building your team.",
            };
        }
        if (pipelines.length === 0) return FIRST;

        const hasHire = pipelines.some(p =>
            p.outcome === 'hired' || p.status === 'completed' || ((p.counts || {}).selections || 0) > 0
        );
        if (hasHire) {
            return {
                prefix: 'WELCOME BACK',
                bold: "Let's build", italic: 'your team.',
                desc: "You've already hired with Hire XA. Start your next search and discover qualified candidates faster.",
            };
        }
        // Roles created, no hires yet.
        return {
            prefix: 'WELCOME',
            bold: 'Ready', italic: 'for your next hire?',
            desc: 'Your hiring workflows are set up. Create a new role and let Hire XA handle sourcing, screening, and interviews.',
        };
    },

    checkAuth() {
        const userData = localStorage.getItem('fluenzoUser');
        if (!userData) { window.location.href = '/'; return; }
        this.user = JSON.parse(userData);
    },

    setupUser() {
        if (!this.user) return;
        const firstName = this.titleCase(this.user.name.split(' ')[0]);
        const el = (id) => document.getElementById(id);

        if (el('user-name')) el('user-name').textContent = firstName;
        if (el('welcome-name')) el('welcome-name').textContent = firstName;
        if (el('dropdown-user-name')) el('dropdown-user-name').textContent = this.titleCase(this.user.name);
        if (el('dropdown-user-email')) el('dropdown-user-email').textContent = this.user.email || '';

        const initial = firstName.charAt(0).toUpperCase();
        if (el('dropdown-avatar')) el('dropdown-avatar').textContent = initial;
    },

    // Normalize a name to Title Case so the header reads the same regardless of
    // how it was stored (Google/LinkedIn/email signup). "ARVIND"/"gaurav" -> "Arvind"/"Gaurav".
    titleCase(str) {
        return String(str || '')
            .toLowerCase()
            .replace(/(^|[\s\-'])([a-zÀ-ɏ])/g, (m, sep, ch) => sep + ch.toUpperCase());
    },

    bindEvents() {
        const trigger = document.getElementById('user-dropdown-trigger');
        const dropdown = document.getElementById('user-dropdown');

        trigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        // Tapping the company-logo avatar goes to the homepage (name + chevron
        // still toggle the menu). stopPropagation so it doesn't also open it.
        const avatar = document.getElementById('user-avatar');
        if (avatar) {
            avatar.style.cursor = 'pointer';
            avatar.title = 'Go to homepage';
            avatar.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = '/b4kx';
            });
        }
        document.addEventListener('click', (e) => {
            if (!dropdown?.contains(e.target)) dropdown?.classList.remove('open');
        });

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            window.location.href = '/h7nh';
        });

        document.getElementById('profile-btn')?.addEventListener('click', () => {
            window.location.href = '/m3xk';
        });

        document.getElementById('logout-btn')?.addEventListener('click', () => {
            localStorage.removeItem('fluenzoUser');
            localStorage.removeItem('currentSession');
            window.location.href = '/';
        });
    },
};

document.addEventListener('DOMContentLoaded', () => Dashboard.init());
