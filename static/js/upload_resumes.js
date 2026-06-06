/**
 * HIRE XA — Upload Resumes page
 * Bulk upload + AI metadata extraction view for the resume pool.
 */
const UR = {
    user: null,
    resumes: [],
    pollTimer: null,
    uploading: false,

    init() {
        this.user = this.loadUser();
        if (!this.user) {
            window.location.href = '/';
            return;
        }
        this.bindEvents();
        this.refreshList();
    },

    loadUser() {
        try {
            const raw = localStorage.getItem('fluenzoUser');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    bindEvents() {
        const dropzone = document.getElementById('ur-dropzone');
        const fileInput = document.getElementById('ur-file-input');
        const chooseBtn = document.getElementById('ur-choose-btn');
        const startBtn = document.getElementById('ur-start-btn');

        chooseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        dropzone?.addEventListener('click', () => fileInput.click());

        fileInput?.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) this.uploadFiles(files);
            fileInput.value = '';
        });

        ['dragenter', 'dragover'].forEach((evt) => {
            dropzone?.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach((evt) => {
            dropzone?.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.remove('is-dragover');
            });
        });
        dropzone?.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) this.uploadFiles(files);
        });

        startBtn?.addEventListener('click', () => this.startScreening());
    },

    async refreshList() {
        try {
            const res = await fetch(`/api/resume-pool/list?recruiter_email=${encodeURIComponent(this.user.email)}`);
            const data = await res.json();
            if (data.success) {
                this.resumes = data.resumes || [];
                this.render();
                this.maybeSchedulePoll();
            }
        } catch (e) {
            console.error('[UR] list error', e);
        }
    },

    maybeSchedulePoll() {
        const pending = this.resumes.some(r => r.status === 'pending' || r.status === 'extracting');
        if (pending && !this.pollTimer) {
            this.pollTimer = setInterval(() => this.refreshList(), 4000);
        } else if (!pending && this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    render() {
        const list = document.getElementById('ur-list');
        const startBtn = document.getElementById('ur-start-btn');
        const titleBold = document.getElementById('ur-title-bold');
        const titleItalic = document.getElementById('ur-title-italic');

        if (!this.resumes.length) {
            list.innerHTML = `
                <div class="ur-empty">
                    <p>No resumes uploaded yet.</p>
                    <span>Drop a few files on the right to get started.</span>
                </div>`;
            startBtn.disabled = true;
            titleBold.textContent = 'Upload your resumes.';
            titleItalic.textContent = 'Let AI take over.';
            return;
        }

        // Switch title to "Upload complete. Start AI screening." once we have files.
        const allReady = this.resumes.every(r => r.status === 'ready');
        titleBold.textContent = allReady ? 'Upload complete.' : 'Uploading…';
        titleItalic.textContent = 'Start AI screening.';

        const rowsHtml = this.resumes.map(r => this.rowHtml(r)).join('');
        list.innerHTML = rowsHtml;

        list.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.delete);
                this.deleteResume(id);
            });
        });

        startBtn.disabled = !this.resumes.length || this.uploading;
    },

    rowHtml(r) {
        const sizeKb = (r.file_size / 1024).toFixed(0);
        const type = (r.file_type || '').toLowerCase();
        const tileLabel = type.toUpperCase().slice(0, 4) || 'FILE';
        // If AI has parsed a candidate name, show "Name • file.pdf" else show file_name
        const displayName = r.candidate_name
            ? `${this.escape(r.candidate_name)} <span style="color:#9B9C9E">— ${this.escape(r.file_name)}</span>`
            : this.escape(r.file_name);

        const statusBadge = r.status === 'ready'
            ? ''
            : `<span class="ur-row-status ${r.status}">${this.statusLabel(r.status)}</span>`;

        return `
            <div class="ur-row" data-id="${r.id}">
                <div class="ur-file-tile" data-type="${type}">${tileLabel}</div>
                <div class="ur-row-info">
                    <div class="ur-row-name">${displayName}</div>
                    <div class="ur-row-meta">
                        <span>${sizeKb} KB</span>
                        ${statusBadge}
                    </div>
                </div>
                <button type="button" class="ur-delete-btn" data-delete="${r.id}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"/>
                    </svg>
                </button>
            </div>`;
    },

    statusLabel(status) {
        switch (status) {
            case 'pending':    return 'Queued';
            case 'extracting': return 'Analyzing…';
            case 'error':      return 'Failed';
            default:           return status;
        }
    },

    escape(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async uploadFiles(files) {
        const allowed = ['.pdf', '.doc', '.docx'];
        const valid = files.filter(f => {
            const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
            return allowed.includes(ext);
        });
        if (valid.length === 0) {
            this.toast('Only PDF, DOC, and DOCX files are allowed', 'error');
            return;
        }
        if (valid.length < files.length) {
            this.toast(`${files.length - valid.length} unsupported file(s) skipped`, 'error');
        }

        this.uploading = true;
        this.toast(`Uploading ${valid.length} resume${valid.length > 1 ? 's' : ''}…`);

        const fd = new FormData();
        fd.append('recruiter_email', this.user.email);
        valid.forEach(f => fd.append('files', f));

        try {
            const res = await fetch('/api/resume-pool/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.detail || 'Upload failed');
            }

            const okCount = (data.uploaded || []).length;
            const errCount = (data.errors || []).length;
            if (okCount) {
                this.toast(`${okCount} resume${okCount > 1 ? 's' : ''} uploaded — AI is extracting metadata…`, 'success');
            }
            if (errCount) {
                const firstErr = data.errors[0];
                this.toast(`${errCount} file(s) failed: ${firstErr?.error || ''}`, 'error');
            }
            this.refreshList();
        } catch (e) {
            this.toast(`Upload error: ${e.message}`, 'error');
        } finally {
            this.uploading = false;
        }
    },

    async deleteResume(id) {
        if (!confirm('Remove this resume from the pool?')) return;
        try {
            const res = await fetch(
                `/api/resume-pool/${id}?recruiter_email=${encodeURIComponent(this.user.email)}`,
                { method: 'DELETE' }
            );
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.detail || 'Delete failed');
            this.toast('Resume removed', 'success');
            this.refreshList();
        } catch (e) {
            this.toast(`Delete error: ${e.message}`, 'error');
        }
    },

    async startScreening() {
        if (!this.resumes.length) return;
        const startBtn = document.getElementById('ur-start-btn');
        startBtn.classList.add('is-loading');

        // Re-queue any pending/error resumes for AI extraction, then take the
        // recruiter to the Pipeline wizard. Matching against new postings is
        // wired on the pipeline side once metadata is ready.
        try {
            await fetch('/api/resume-pool/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recruiter_email: this.user.email }),
            });
            this.toast('AI screening kicked off. Redirecting to Pipeline…', 'success');
            setTimeout(() => { window.location.href = '/c8qr'; }, 1200);
        } catch (e) {
            this.toast(`Could not start screening: ${e.message}`, 'error');
            startBtn.classList.remove('is-loading');
        }
    },

    toast(message, kind) {
        const el = document.getElementById('ur-toast');
        if (!el) return;
        el.textContent = message;
        el.className = 'ur-toast';
        if (kind) el.classList.add(kind);
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
    },
};

document.addEventListener('DOMContentLoaded', () => UR.init());
