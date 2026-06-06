/**
 * Hire XA — Admin Profile page
 * Shows the admin profile + team members; add users, edit profile, change password.
 */
(function () {
    const API = window.location.origin;

    let userEmail = '';
    let cachedIsAdmin = null;   // last known role from the stored session (instant render)
    try {
        const u = JSON.parse(localStorage.getItem('fluenzoUser') || 'null');
        if (!u || !u.email) { window.location.href = '/login'; return; }
        userEmail = u.email;
        if (typeof u.is_admin === 'boolean') cachedIsAdmin = u.is_admin;
    } catch (_) { window.location.href = '/login'; return; }

    const el = (id) => document.getElementById(id);

    function hideLoader() {
        const l = el('page-loader');
        if (l) l.classList.add('page-loader--done');
    }

    // Toggle the role-specific blocks: admins get the team-management section,
    // members get the recruiting-stats rows. Everything is hidden in markup by
    // default, so until this runs neither layout shows (no admin-replica flash).
    function applyRoleLayout(isAdmin) {
        const main = document.querySelector('.profile-main');
        if (main) {
            main.classList.toggle('pf-admin', !!isAdmin);
            main.classList.toggle('pf-member', !isAdmin);
        }
        const sec = el('pf-users-section');
        const jobsRow = el('pf-row-jobs'), rolesRow = el('pf-row-roles');
        if (sec) sec.hidden = !isAdmin;
        if (jobsRow) jobsRow.hidden = !!isAdmin;
        if (rolesRow) rolesRow.hidden = !!isAdmin;
    }

    // Paint the correct layout immediately from the cached role so a refresh
    // doesn't flash the wrong view. The server call below is authoritative.
    if (cachedIsAdmin !== null) applyRoleLayout(cachedIsAdmin);
    const val = (id) => (el(id)?.value || '').trim();
    let members = [];
    let remaining = 3;
    let editingMember = null;   // member row currently open in the edit modal

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    let toastTimer = null;
    function toast(msg, kind) {
        const t = el('pf-toast'); if (!t) return;
        t.textContent = msg;
        t.className = 'pf-toast ' + (kind || 'success');
        t.hidden = false;
        requestAnimationFrame(() => t.classList.add('show'));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, 4000);
    }

    // -------- Render --------
    function renderRows(filter) {
        const body = el('pf-rows');
        if (!body) return;
        const q = (filter || '').trim().toLowerCase();
        const list = members.filter(m => !q ||
            (m.name || '').toLowerCase().includes(q) ||
            (m.email || '').toLowerCase().includes(q) ||
            (m.role || '').toLowerCase().includes(q));
        if (!list.length) {
            body.innerHTML = '<div class="pf-empty">' + (members.length ? 'No matching users.' : 'No team members yet.') + '</div>';
            return;
        }
        body.innerHTML = list.map(m => {
            const badge = (m.status === 'Active') ? 'active' : 'pending';
            const isSelf = (m.email || '').toLowerCase() === userEmail.toLowerCase();
            const adminPill = m.is_admin ? '<span class="pf-admin-pill">Admin</span>' : '';
            const actions = isSelf
                ? '<span class="pf-row-self">You</span>'
                : ('<button type="button" class="pf-row-action" data-edit="' + m.id + '" aria-label="Edit member">' +
                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                   '</button>' +
                   '<button type="button" class="pf-row-action pf-del" data-del="' + m.id + '" aria-label="Remove">' +
                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
                   '</button>');
            return '<div class="pf-row">' +
                '<div class="pf-row-user"><div class="pf-row-name">' + escapeHtml(m.name) + adminPill + '</div>' +
                '<div class="pf-row-email">' + escapeHtml(m.email) + '</div></div>' +
                '<div class="pf-row-role">' + escapeHtml(m.role) + '</div>' +
                '<div><span class="pf-badge ' + badge + '">' + escapeHtml(m.status) + '</span></div>' +
                '<div class="pf-row-actions">' + actions + '</div></div>';
        }).join('');
    }

    function applyLogo(logoPath) {
        // Show the company's uploaded logo in the profile avatar. Preload first
        // and only swap in the <img> once it has actually loaded — so a
        // transient load failure keeps the default person icon instead of
        // leaving an empty circle (and the logo never flickers away once shown).
        const avatar = el('pf-avatar-big');
        if (!avatar || !logoPath) return;
        const pre = new Image();
        pre.onload = () => {
            const img = document.createElement('img');
            img.className = 'pf-avatar-img';
            img.alt = 'Company logo';
            img.src = logoPath;
            avatar.classList.add('has-logo');
            avatar.innerHTML = '';
            avatar.appendChild(img);
        };
        // On error: leave the default avatar (SVG person icon) untouched.
        pre.src = logoPath;
    }

    async function load() {
        // First resolve who is logged in: admin (org owner) or invited member.
        let me;
        try {
            const meRes = await fetch(API + '/api/team/me?email=' + encodeURIComponent(userEmail));
            if (!meRes.ok) return;
            me = await meRes.json();
            // Keep the stored session's admin flag authoritative so the header
            // dropdown ("Complete setup !") is correct on every page.
            try {
                const u = JSON.parse(localStorage.getItem('fluenzoUser') || 'null') || {};
                u.is_admin = !!me.is_admin;
                localStorage.setItem('fluenzoUser', JSON.stringify(u));
            } catch (_) {}
        } catch (_) { return; }

        // Common header / main-card fields (both roles).
        // Header card shows the workspace/company name (falls back to "Profile").
        if (el('pf-company-name')) el('pf-company-name').textContent = me.org_name || 'Profile';
        if (el('pf-admin-email')) el('pf-admin-email').textContent = me.email || '';
        if (el('pf-name')) el('pf-name').textContent = me.name || '';
        if (el('pf-main-email')) el('pf-main-email').textContent = me.email || '';
        if (el('pf-role')) el('pf-role').textContent = me.role || '';
        if (el('edit-name')) el('edit-name').value = me.name || '';
        applyLogo(me.logo_path);

        // Authoritative layout from the server (corrects a stale cached role).
        applyRoleLayout(me.is_admin);

        if (me.is_admin) {
            // Admin view: load + render the team management section.
            try {
                const res = await fetch(API + '/api/team?email=' + encodeURIComponent(userEmail));
                if (res.ok) {
                    const d = await res.json();
                    members = Array.isArray(d.members) ? d.members : [];
                    remaining = (typeof d.remaining === 'number') ? d.remaining : Math.max(0, 3 - members.length);
                    renderRows(val('pf-search'));
                    const addBtn = el('pf-add-btn');
                    if (addBtn) {
                        addBtn.disabled = remaining <= 0;
                        addBtn.textContent = remaining <= 0 ? 'Team limit reached (3)' : '+ Add Users';
                    }
                }
            } catch (_) {}
        } else {
            // Member view (Figma): recruiting stats, no team management.
            if (el('pf-jobs')) el('pf-jobs').textContent = (me.jobs_posted != null ? me.jobs_posted : 0);
            if (el('pf-roles')) el('pf-roles').textContent = (me.roles_active != null ? me.roles_active : 0);
        }
    }

    // -------- Modals --------
    function openModal(id) { const m = el(id); if (m) m.hidden = false; }
    function closeModal(m) { if (m) m.hidden = true; }

    // -------- Team member edit / remove --------
    function openMemberModal(m) {
        editingMember = m;
        if (el('member-sub')) el('member-sub').textContent = (m.name || '') + ' · ' + (m.email || '');
        if (el('member-admin')) el('member-admin').checked = !!m.is_admin;
        if (el('member-err')) el('member-err').textContent = '';
        openModal('pf-member-modal');
    }

    async function removeMember(id) {
        const m = members.find(x => String(x.id) === String(id));
        if (!window.confirm('Remove ' + (m ? m.name : 'this user') + ' from your team?')) return;
        try {
            const res = await fetch(API + '/api/team/remove?admin_email=' + encodeURIComponent(userEmail) + '&member_id=' + encodeURIComponent(id), { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) { toast('User removed.'); load(); }
            else { toast(data.detail || 'Could not remove user.', 'error'); }
        } catch (_) { toast('Connection error. Please try again.', 'error'); }
    }

    // Persist the only editable axis: admin access. Role is fixed (Recruiter),
    // so a member is either a Recruiter or the Admin — nothing else to save.
    async function saveMember() {
        if (!editingMember) return;
        const err = el('member-err'); err.textContent = '';
        const id = editingMember.id;
        const newAdmin = !!(el('member-admin') && el('member-admin').checked);

        // Turning the toggle ON = TRANSFER admin ownership to this member. The
        // current admin (you) becomes a regular member and loses admin access,
        // so confirm first, then redirect to the dashboard on success.
        if (newAdmin && !editingMember.is_admin) {
            const ok = window.confirm('Make ' + (editingMember.name || 'this user') + ' the admin?\n\n' +
                'This transfers admin ownership to them. You will become a regular member and lose admin access. This cannot be undone by you afterwards.');
            if (!ok) { if (el('member-admin')) el('member-admin').checked = false; return; }
            const btn0 = el('member-save'); btn0.disabled = true; const o0 = btn0.textContent; btn0.textContent = 'Transferring…';
            try {
                const fd = new FormData();
                fd.append('admin_email', userEmail); fd.append('member_id', id); fd.append('make_admin', 'true');
                const r = await fetch(API + '/api/team/set-admin', { method: 'POST', body: fd });
                if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Could not transfer admin.'); }
                closeModal(el('pf-member-modal'));
                toast(editingMember.name + ' is now the admin. Redirecting…');
                setTimeout(() => { window.location.href = '/b4kx'; }, 1300);
            } catch (ex) {
                err.textContent = ex.message || 'Could not transfer admin.';
                btn0.disabled = false; btn0.textContent = o0;
            }
            return;
        }

        const btn = el('member-save'); btn.disabled = true; const o = btn.textContent; btn.textContent = 'Saving…';
        try {
            // Turning the toggle OFF clears a legacy admin flag (no ownership change).
            if (!newAdmin && editingMember.is_admin) {
                const fd = new FormData();
                fd.append('admin_email', userEmail); fd.append('member_id', id); fd.append('make_admin', 'false');
                const r = await fetch(API + '/api/team/set-admin', { method: 'POST', body: fd });
                if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Could not update access.'); }
            }
            closeModal(el('pf-member-modal'));
            toast('Member updated.');
            editingMember = null;
            load();
        } catch (ex) {
            err.textContent = ex.message || 'Could not save changes.';
        }
        btn.disabled = false; btn.textContent = o;
    }

    // -------- Wire up --------
    document.addEventListener('DOMContentLoaded', () => {
        load().finally(hideLoader);

        // Search box: start empty + readonly so the browser's password manager
        // can't autofill the admin's email into it on load; editable on focus.
        const searchEl = el('pf-search');
        if (searchEl) {
            searchEl.value = '';
            searchEl.addEventListener('focus', function () { this.removeAttribute('readonly'); });
            searchEl.addEventListener('input', () => renderRows(val('pf-search')));
        }

        // Row actions: edit (open member modal) or remove.
        el('pf-rows')?.addEventListener('click', async (e) => {
            const edit = e.target.closest('[data-edit]');
            if (edit) {
                const m = members.find(x => String(x.id) === String(edit.dataset.edit));
                if (m) openMemberModal(m);
                return;
            }
            const del = e.target.closest('[data-del]');
            if (!del) return;
            await removeMember(del.dataset.del);
        });

        // Modal close (X / click outside)
        document.querySelectorAll('[data-pf-close]').forEach(b =>
            b.addEventListener('click', () => closeModal(b.closest('.pf-modal'))));
        document.querySelectorAll('.pf-modal').forEach(m =>
            m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));

        // Add User
        el('pf-add-btn')?.addEventListener('click', () => {
            if (remaining <= 0) return;
            el('add-name').value = ''; el('add-email').value = '';
            el('add-err').textContent = '';
            openModal('pf-add-modal');
        });
        el('add-submit')?.addEventListener('click', async () => {
            const err = el('add-err'); err.textContent = '';
            const name = val('add-name'), email = val('add-email'), role = 'recruiter';
            if (!name) { err.textContent = 'Please enter the user\'s name.'; return; }
            if (!email || email.indexOf('@') === -1) { err.textContent = 'Please enter a valid email.'; return; }
            const wsDomain = (userEmail.split('@')[1] || '').toLowerCase();
            const inDomain = (email.split('@')[1] || '').toLowerCase();
            if (wsDomain && inDomain !== wsDomain) {
                err.textContent = 'Team members must use a @' + wsDomain + ' email address.';
                return;
            }
            if (window.HXAValidate) {
                const v = window.HXAValidate.validateAll(el('pf-add-modal'));
                if (!v.valid) { if (v.firstInvalid) v.firstInvalid.focus(); err.textContent = 'Please fix the highlighted fields.'; return; }
            }
            const btn = el('add-submit'); btn.disabled = true; const o = btn.textContent; btn.textContent = 'Adding…';
            try {
                const fd = new FormData();
                fd.append('admin_email', userEmail);
                fd.append('name', name); fd.append('email', email); fd.append('role', role);
                const res = await fetch(API + '/api/team/add', { method: 'POST', body: fd });
                const data = await res.json().catch(() => ({}));
                if (res.ok) { closeModal(el('pf-add-modal')); toast('Invite sent to ' + email + '.'); load(); }
                else { err.textContent = data.detail || 'Could not add the user.'; }
            } catch (_) { err.textContent = 'Connection error. Please try again.'; }
            btn.disabled = false; btn.textContent = o;
        });

        // Edit team member (role + admin access)
        el('member-save')?.addEventListener('click', saveMember);
        el('member-remove')?.addEventListener('click', () => {
            if (!editingMember) return;
            const id = editingMember.id;
            closeModal(el('pf-member-modal'));
            removeMember(id);
        });

        // Edit profile
        el('pf-edit-btn')?.addEventListener('click', () => { el('edit-err').textContent = ''; openModal('pf-edit-modal'); });
        el('edit-submit')?.addEventListener('click', async () => {
            const err = el('edit-err'); err.textContent = '';
            if (window.HXAValidate && !window.HXAValidate.check(el('edit-name'), true)) { el('edit-name').focus(); err.textContent = 'Please enter a valid name.'; return; }
            const btn = el('edit-submit'); btn.disabled = true; const o = btn.textContent; btn.textContent = 'Saving…';
            try {
                const fd = new FormData();
                fd.append('email', userEmail);
                fd.append('name', val('edit-name'));
                const res = await fetch(API + '/api/team/profile', { method: 'POST', body: fd });
                const data = await res.json().catch(() => ({}));
                if (res.ok) { closeModal(el('pf-edit-modal')); toast('Profile updated.'); load(); }
                else { err.textContent = data.detail || 'Could not save.'; }
            } catch (_) { err.textContent = 'Connection error. Please try again.'; }
            btn.disabled = false; btn.textContent = o;
        });

        // Change password
        el('pf-change-pw')?.addEventListener('click', () => {
            el('pw-current').value = ''; el('pw-new').value = ''; el('pw-confirm').value = '';
            el('pw-err').textContent = '';
            openModal('pf-pw-modal');
        });
        el('pw-submit')?.addEventListener('click', async () => {
            const err = el('pw-err'); err.textContent = '';
            const cur = val('pw-current'), nw = val('pw-new'), cf = val('pw-confirm');
            if (!cur) { err.textContent = 'Enter your current password.'; return; }
            if (nw.length < 8 || !/[A-Za-z]/.test(nw) || !/[0-9]/.test(nw)) { err.textContent = 'New password must be 8+ chars with letters and numbers.'; return; }
            if (nw !== cf) { err.textContent = 'New passwords do not match.'; return; }
            const btn = el('pw-submit'); btn.disabled = true; const o = btn.textContent; btn.textContent = 'Updating…';
            try {
                const res = await fetch(API + '/api/change-password', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: userEmail, current_password: cur, new_password: nw })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) { closeModal(el('pf-pw-modal')); toast('Password updated.'); }
                else { err.textContent = data.detail || 'Could not change password.'; }
            } catch (_) { err.textContent = 'Connection error. Please try again.'; }
            btn.disabled = false; btn.textContent = o;
        });
    });
})();
