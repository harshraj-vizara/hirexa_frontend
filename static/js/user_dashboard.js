/**
 * Hire XA — Admin User Dashboard
 * Full team table: every added user with their hiring activity
 * (jobs posted / positions closed / in progress) + status + join date.
 * Admin-only; invited members are bounced back to the dashboard.
 */
(function () {
    const API = window.location.origin;

    let userEmail = '';
    try {
        const u = JSON.parse(localStorage.getItem('fluenzoUser') || 'null');
        if (!u || !u.email) { window.location.href = '/login'; return; }
        userEmail = u.email;
    } catch (_) { window.location.href = '/login'; return; }

    const el = (id) => document.getElementById(id);
    const val = (id) => (el(id)?.value || '').trim();

    let members = [];
    let remaining = 3;
    let activeFilter = 'all';
    let editingMember = null;

    function hideLoader() {
        const l = el('page-loader');
        if (l) l.classList.add('page-loader--done');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return '—';
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
    }

    // -------- Render --------
    function renderRows() {
        const body = el('ud-rows');
        if (!body) return;
        const q = val('ud-search').toLowerCase();
        const list = members.filter(m => {
            if (activeFilter === 'active' && m.status !== 'Active') return false;
            if (activeFilter === 'pending' && m.status !== 'Pending') return false;
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) ||
                   (m.email || '').toLowerCase().includes(q) ||
                   (m.role || '').toLowerCase().includes(q);
        });
        if (!list.length) {
            body.innerHTML = '<div class="ud-empty">' + (members.length ? 'No matching users.' : 'No team members yet.') + '</div>';
            return;
        }
        body.innerHTML = list.map(m => {
            const badge = (m.status === 'Active') ? 'active' : 'pending';
            const isSelf = (m.email || '').toLowerCase() === userEmail.toLowerCase();
            const adminPill = m.is_admin ? '<span class="ud-admin-pill">Admin</span>' : '';
            const actions = isSelf
                ? '<span class="ud-row-self">You</span>'
                : ('<button type="button" class="ud-row-action" data-edit="' + m.id + '" aria-label="Edit member">' +
                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                   '</button>' +
                   '<button type="button" class="ud-row-action ud-del" data-del="' + m.id + '" aria-label="Remove">' +
                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>' +
                   '</button>');
            return '<div class="ud-row">' +
                '<div class="ud-row-user"><div class="ud-row-name">' + escapeHtml(m.name) + adminPill + '</div>' +
                '<div class="ud-row-email">' + escapeHtml(m.email) + '</div></div>' +
                '<div class="ud-row-role">' + escapeHtml(m.role) + '</div>' +
                '<div class="ud-cell-status"><span class="ud-pill ' + badge + '">' + escapeHtml(m.status) + '</span></div>' +
                '<div class="ud-stat">' + (m.jobs_posted || 0) + '</div>' +
                '<div class="ud-stat">' + (m.positions_closed || 0) + '</div>' +
                '<div class="ud-stat">' + (m.in_progress || 0) + '</div>' +
                '<div class="ud-created">' + escapeHtml(fmtDate(m.created_at)) + '</div>' +
                '<div class="ud-row-actions">' + actions + '</div></div>';
        }).join('');
    }

    function renderCounts(active, pending) {
        const total = members.length;
        if (el('ud-c-all')) el('ud-c-all').textContent = total;
        if (el('ud-c-active')) el('ud-c-active').textContent = active;
        if (el('ud-c-pending')) el('ud-c-pending').textContent = pending;
        const parts = [active + ' active team user' + (active === 1 ? '' : 's')];
        if (pending) parts.push(pending + ' pending');
        if (el('ud-sub')) el('ud-sub').textContent = parts.join(' · ');
    }

    async function load() {
        // Resolve role first: only an admin may view this page.
        let me;
        try {
            const meRes = await fetch(API + '/api/team/me?email=' + encodeURIComponent(userEmail));
            if (!meRes.ok) { window.location.href = '/b4kx'; return; }
            me = await meRes.json();
            try {
                const u = JSON.parse(localStorage.getItem('fluenzoUser') || 'null') || {};
                u.is_admin = !!me.is_admin;
                localStorage.setItem('fluenzoUser', JSON.stringify(u));
            } catch (_) {}
        } catch (_) { return; }
        if (!me.is_admin) { window.location.href = '/m3xk'; return; }

        try {
            const res = await fetch(API + '/api/team/dashboard?email=' + encodeURIComponent(userEmail));
            if (!res.ok) return;
            const d = await res.json();
            members = Array.isArray(d.members) ? d.members : [];
            remaining = (typeof d.remaining === 'number') ? d.remaining : Math.max(0, 3 - members.length);
            renderCounts(d.active || 0, d.pending || 0);
            renderRows();
            const addBtn = el('ud-add-btn');
            if (addBtn) {
                addBtn.disabled = remaining <= 0;
                addBtn.textContent = remaining <= 0 ? 'Team limit reached (3)' : '+ Add User';
            }
        } catch (_) {}
    }

    // -------- Modals --------
    function openModal(id) { const m = el(id); if (m) m.hidden = false; }
    function closeModal(m) { if (m) m.hidden = true; }

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
                if (!r.ok) { const dd = await r.json().catch(() => ({})); throw new Error(dd.detail || 'Could not transfer admin.'); }
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
                if (!r.ok) { const dd = await r.json().catch(() => ({})); throw new Error(dd.detail || 'Could not update access.'); }
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

        // Filter chips
        el('ud-chips')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.ud-chip');
            if (!chip) return;
            activeFilter = chip.dataset.filter || 'all';
            document.querySelectorAll('.ud-chip').forEach(c => c.classList.toggle('is-active', c === chip));
            renderRows();
        });

        // Search (readonly until focus so the password manager can't autofill)
        const searchEl = el('ud-search');
        if (searchEl) {
            searchEl.value = '';
            searchEl.addEventListener('focus', function () { this.removeAttribute('readonly'); });
            searchEl.addEventListener('input', renderRows);
        }

        // Row actions
        el('ud-rows')?.addEventListener('click', async (e) => {
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
        el('ud-add-btn')?.addEventListener('click', () => {
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
    });
})();
