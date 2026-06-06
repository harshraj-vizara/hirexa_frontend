/**
 * HIRE XA — Shared profile dropdown widget
 * Auto-mounts on any element with [data-user-dropdown].
 * Reads user from localStorage('fluenzoUser'), wires toggle / settings / logout.
 */
(function () {
    'use strict';

    var TEMPLATE = [
        '<button class="hxa-userdd-trigger" type="button" data-userdd-trigger aria-haspopup="menu" aria-expanded="false">',
        '  <span class="hxa-userdd-avatar">',
        '    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '      <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z" fill="#FFD33C"/>',
        '    </svg>',
        '  </span>',
        '  <span class="hxa-userdd-name" data-userdd-name>User</span>',
        '  <svg class="hxa-userdd-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#24282B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        '</button>',
        '<div class="hxa-userdd-menu" role="menu">',
        '  <div class="hxa-userdd-email" data-userdd-email>user@example.com</div>',
        '  <button class="hxa-userdd-item" type="button" data-userdd-profile role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
        '    <span>Profile</span>',
        '  </button>',
        '  <button class="hxa-userdd-item complete" type="button" data-userdd-complete role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke="#4CABF6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
        '    <span>Complete setup !</span>',
        '  </button>',
        '  <button class="hxa-userdd-item" type="button" data-userdd-settings role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        '    <span>Settings</span>',
        '  </button>',
        '  <button class="hxa-userdd-item disabled" type="button" disabled aria-disabled="true" data-userdd-help role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        '    <span>Get help</span>',
        '  </button>',
        '  <div class="hxa-userdd-divider"></div>',
        '  <button class="hxa-userdd-item disabled" type="button" disabled aria-disabled="true" data-userdd-upgrade role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
        '    <span>Upgrade plan</span>',
        '  </button>',
        '  <button class="hxa-userdd-item disabled" type="button" disabled aria-disabled="true" data-userdd-learn role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none"/></svg>',
        '    <span>Learn more</span>',
        '  </button>',
        '  <div class="hxa-userdd-divider"></div>',
        '  <button class="hxa-userdd-item logout" type="button" data-userdd-logout role="menuitem">',
        '    <svg class="hxa-userdd-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
        '    <span>Logout</span>',
        '  </button>',
        '</div>'
    ].join('\n');

    function loadUser() {
        try {
            var raw = localStorage.getItem('fluenzoUser');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    // Normalize a name to Title Case so the header reads the same regardless of
    // how it was stored (Google/LinkedIn/email signup). "ARVIND"/"gaurav" -> "Arvind"/"Gaurav".
    function titleCase(str) {
        return String(str || '')
            .toLowerCase()
            .replace(/(^|[\s\-'])([a-zÀ-ɏ])/g, function (m, sep, ch) { return sep + ch.toUpperCase(); });
    }

    function mount(anchor) {
        if (!anchor || anchor.dataset.userddMounted) return;
        anchor.dataset.userddMounted = '1';
        anchor.classList.add('hxa-userdd');
        anchor.innerHTML = TEMPLATE;

        var user = loadUser();
        if (user) {
            var firstName = titleCase((user.name || '').split(' ')[0]) || 'User';
            var nameEl = anchor.querySelector('[data-userdd-name]');
            var emailEl = anchor.querySelector('[data-userdd-email]');
            if (nameEl) nameEl.textContent = firstName;
            if (emailEl) emailEl.textContent = user.email || '';
        }

        // "Complete setup !" is an admin-only, workspace-setup action. Invited
        // team members (is_admin === false) never see it. Absent flag (older
        // sessions / OAuth admins) defaults to showing it, as before.
        if (user && user.is_admin === false) {
            var completeEl = anchor.querySelector('[data-userdd-complete]');
            if (completeEl) completeEl.style.display = 'none';
        }

        var trigger = anchor.querySelector('[data-userdd-trigger]');
        if (trigger) {
            trigger.addEventListener('click', function (e) {
                e.stopPropagation();
                var open = anchor.classList.toggle('open');
                trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }

        // Tapping the company-logo avatar goes to the homepage (the name +
        // chevron still toggle the menu). stopPropagation so it doesn't also
        // fire the trigger's open/close handler.
        var avatar = anchor.querySelector('.hxa-userdd-avatar');
        if (avatar) {
            avatar.style.cursor = 'pointer';
            avatar.setAttribute('title', 'Go to homepage');
            avatar.addEventListener('click', function (e) {
                e.stopPropagation();
                window.location.href = '/b4kx';
            });
        }

        document.addEventListener('click', function (e) {
            if (!anchor.contains(e.target)) {
                anchor.classList.remove('open');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                anchor.classList.remove('open');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            }
        });

        var settingsBtn = anchor.querySelector('[data-userdd-settings]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function () {
                window.location.href = '/h7nh';
            });
        }

        var profileBtn = anchor.querySelector('[data-userdd-profile]');
        if (profileBtn) {
            profileBtn.addEventListener('click', function () {
                window.location.href = '/m3xk';
            });
        }

        var completeBtn = anchor.querySelector('[data-userdd-complete]');
        if (completeBtn) {
            completeBtn.addEventListener('click', function () {
                // Open the company-setup flow back on the dashboard.
                try { localStorage.setItem('openCompleteSetup', '1'); } catch (e) {}
                window.location.href = '/b4kx';
            });
        }

        var logoutBtn = anchor.querySelector('[data-userdd-logout]');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                try {
                    localStorage.removeItem('fluenzoUser');
                    localStorage.removeItem('currentSession');
                } catch (e) {}
                window.location.href = '/';
            });
        }
    }

    // ---- Company logo as the avatar (across all pages) ----
    // Preload the image and only swap the avatar to it AFTER it has loaded, so
    // a transient fetch/load failure can never blank an already-shown logo or
    // wipe the default icon — the logo simply stays put once it has rendered.
    function applyLogoToEl(elx, url) {
        if (!elx || !url) return;
        var pre = new Image();
        pre.onload = function () {
            var img = elx.querySelector('img.hxa-avatar-img');
            if (!img) {
                var svg = elx.querySelector('svg');
                if (svg) svg.style.display = 'none';
                img = document.createElement('img');
                img.className = 'hxa-avatar-img';
                img.alt = '';
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
                elx.style.overflow = 'hidden';
                elx.appendChild(img);
            }
            img.src = url;
            img.style.display = 'block';
        };
        // On error: do nothing — keep whatever is currently shown (the existing
        // logo or the default icon). Never blank the avatar on a blip.
        pre.src = url;
    }
    function clearLogoFromEl(elx) {
        if (!elx) return;
        var img = elx.querySelector('img.hxa-avatar-img');
        if (img) img.remove();
        var svg = elx.querySelector('svg');
        if (svg) svg.style.display = '';
    }
    function avatarEls() {
        return document.querySelectorAll('.hxa-userdd-avatar, #user-avatar, .user-avatar');
    }
    function applyCompanyLogo() {
        var els = avatarEls();
        if (!els.length) return;
        var cached = null;
        try { cached = localStorage.getItem('hirexaCompanyLogo'); } catch (e) {}
        if (cached) for (var i = 0; i < els.length; i++) applyLogoToEl(els[i], cached);

        var user = loadUser();
        if (!user || !user.email) return;
        fetch('/api/company/logo?email=' + encodeURIComponent(user.email))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d) return;
                var path = d.logo_path || '';
                var cur = avatarEls();
                if (path) {
                    try { localStorage.setItem('hirexaCompanyLogo', path); } catch (e) {}
                    for (var i = 0; i < cur.length; i++) applyLogoToEl(cur[i], path);
                } else {
                    try { localStorage.removeItem('hirexaCompanyLogo'); } catch (e) {}
                    for (var j = 0; j < cur.length; j++) clearLogoFromEl(cur[j]);
                }
            })
            .catch(function () {});
    }

    // Hide/show the admin-only "Complete setup !" item across all mounted menus.
    function setCompleteVisible(visible) {
        var btns = document.querySelectorAll('[data-userdd-complete]');
        for (var i = 0; i < btns.length; i++) btns[i].style.display = visible ? '' : 'none';
    }

    // Clear the session and bounce to the login window with a message. Used when
    // the server says this account no longer exists (deleted by an admin).
    function forceLogout(reason) {
        try {
            localStorage.removeItem('fluenzoUser');
            localStorage.removeItem('currentSession');
            localStorage.removeItem('hirexaCompanyLogo');
        } catch (e) {}
        var q = reason ? ('?msg=' + encodeURIComponent(reason)) : '?login=1';
        window.location.replace('/login' + q);
    }

    // Ask the server who this is. Invited team members (is_admin === false) must
    // never see "Complete setup !". We don't trust the cached flag alone (it may
    // be missing on sessions created before this shipped), so we reconcile here
    // and update fluenzoUser so every other page is correct immediately.
    // A 404 here means the account was deleted while logged in -> auto-logout.
    function reconcileAdminFlag() {
        var user = loadUser();
        if (!user || !user.email) return;
        fetch('/api/team/me?email=' + encodeURIComponent(user.email))
            .then(function (r) {
                if (r.status === 404) {
                    forceLogout('No user found. Please contact your administrator.');
                    return null;
                }
                return r.ok ? r.json() : null;
            })
            .then(function (d) {
                if (!d) return;
                var isAdmin = !!d.is_admin;
                setCompleteVisible(isAdmin);
                try {
                    var u = loadUser() || {};
                    u.is_admin = isAdmin;
                    localStorage.setItem('fluenzoUser', JSON.stringify(u));
                } catch (e) {}
            })
            .catch(function () {});
    }

    // Make the HIRE XA wordmark in the header a link to the homepage (/b4kx),
    // across every in-app page. The login page uses .auth-brand (and doesn't
    // load this script), so the pre-login logo is intentionally left alone.
    function wireBrandLogo() {
        var brands = document.querySelectorAll('.dash-brand');
        for (var i = 0; i < brands.length; i++) {
            var b = brands[i];
            if (b.dataset.brandLinked) continue;
            b.dataset.brandLinked = '1';
            b.style.cursor = 'pointer';
            b.setAttribute('title', 'Go to homepage');
            b.setAttribute('role', 'link');
            b.setAttribute('tabindex', '0');
            b.addEventListener('click', function () { window.location.href = '/b4kx'; });
            b.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/b4kx'; }
            });
        }
    }

    function init() {
        var anchors = document.querySelectorAll('[data-user-dropdown]');
        for (var i = 0; i < anchors.length; i++) mount(anchors[i]);
        applyCompanyLogo();
        reconcileAdminFlag();
        wireBrandLogo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.HXAUserDropdown = { mount: mount, init: init, applyCompanyLogo: applyCompanyLogo };
})();
