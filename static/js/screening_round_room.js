/**
 * Scoreniq - Screening Round Interview Room
 * Google Meet-style room with WebRTC peer-to-peer streaming
 */

const ScreeningRoom = {
    API_BASE: window.location.origin,
    roomId: null,
    roomConfig: null,
    participantId: null,
    userRole: null,
    userName: null,
    micOn: true,    // UNMUTED by default — candidate can speak right away
                    // (still auto-pauses while the AI is speaking, see _applyMicState)
    cameraOn: false,
    screenSharing: false,
    timerInterval: null,
    elapsedSeconds: 0,
    cameraStream: null,   // video-only stream
    audioStream: null,     // audio-only stream (separate to prevent mic killing camera)
    screenStream: null,
    canScreenShare: true, // false on iOS/iPadOS

    // Interview state
    interviewStarted: false,
    chatOpen: true,
    currentSpeakingAgent: null,
    isPlayingAudio: false,
    audioUnlocked: false,
    ttsAudioEl: null,
    // Web Audio playback (gapless, decode-before-play — avoids the pitch/speed
    // ramp that HTMLAudioElement produces when it starts an undecoded MP3 chunk).
    audioCtx: null,
    audioChunkQueue: [],      // base64 chunks waiting to be decoded
    _scheduledSources: [],    // AudioBufferSourceNodes currently scheduled/playing
    _nextStartTime: 0,        // AudioContext-clock time the next chunk should start
    _decoding: false,         // a decode/schedule drain loop is currently running
    // TTS loudness leveling — keep the voice at a steady level WITHOUT the abrupt
    // chunk-to-chunk jumps the old wide-clamp normalizer caused. Each chunk is
    // nudged toward _TTS_TARGET_RMS, but: (a) RMS is measured over SPEECH only
    // (silence excluded) so short/padded chunks aren't over-boosted, (b) the gain
    // is clamped to a TIGHT band, and (c) it is exponentially smoothed across the
    // chunks of a burst so consecutive chunks never jump. Then a gentle limiter
    // (_ttsOut) only catches peaks.
    _ttsOut: null,
    _TTS_TARGET_RMS: 0.09,
    _TTS_MIN_GAIN: 0.8,       // was 0.5 — never duck a chunk hard
    _TTS_MAX_GAIN: 1.5,       // was 3.0 — never boost a chunk hard
    _TTS_GAIN_SMOOTH: 0.6,    // EMA weight on the previous chunk's gain (0..1)
    _TTS_SPEECH_FLOOR: 0.012, // samples quieter than this are treated as silence for RMS
    _ttsGainEma: null,        // smoothed gain carried across a burst's chunks
    // Prebuffer: hold the first decoded chunk(s) briefly before starting playback
    // so a slow/late chunk can't cause a mid-speech stop, but start as SOON as
    // there is enough audio runway so the opening isn't delayed. Start when either
    // _PREBUFFER_CHUNKS are ready OR a single first chunk already holds
    // _PREBUFFER_MIN_SEC of audio, OR the fallback timer fires.
    _pendingBuffers: [],      // decoded AudioBuffers held until playback starts
    _playbackStarted: false,  // has this burst begun playing yet?
    _prebufferTimer: null,    // fallback timer to start even with < lead chunks
    _PREBUFFER_CHUNKS: 2,     // start once this many chunks are buffered...
    _PREBUFFER_MIN_SEC: 0.9,  // ...or once one chunk already has this much audio...
    _PREBUFFER_MS: 450,       // ...or this long after the first chunk, whichever first

    // Speech-to-Text
    recognition: null,
    sttSupported: false,
    isListening: false,
    sttBuffer: '',

    // Push-to-talk Web Speech is the only STT path. Whisper integration was
    // removed because chunk-level hallucinations against silent audio
    // polluted the textarea ("QA Automation QA Automation ..."). The
    // candidate now controls capture explicitly via the mic button.
    _userTypedThisTurn: false,
    _suppressInputEvent: false,

    // Auto-submit on silence. The manual Send button is hidden; the answer
    // ships automatically when the candidate stops speaking/typing for this
    // long. Reset on every onresult and every keystroke; cleared when the
    // agent starts speaking or the answer is shipped.
    _silenceTimer: null,
    // The submit watchdog is driven by ACTUAL MIC ENERGY (see _onMicAudio), not by
    // transcript events — so it can never fire while the candidate is audibly
    // speaking, even when Sarvam's transcript lags. This is the real fix for
    // "submitted half my answer mid-sentence". The window is the amount of TRUE
    // silence (no mic energy) after the last sound before the countdown begins.
    _AUTO_SUBMIT_SILENCE_MS: 7000,
    // Mic RMS (0..1) above which we treat the candidate as actively speaking.
    // Tuned for typical headset/laptop mic with noiseSuppression on.
    _SPEECH_RMS: 0.018,
    _lastSpeechTs: 0,
    // After the silence window, show a short visible countdown before actually
    // submitting, so a candidate who paused mid-thought can resume and cancel it
    // (any new speech/keystroke re-arms the silence timer and clears this).
    _graceTimer: null,
    _AUTO_SUBMIT_GRACE_SECS: 3,

    // -------- STT contextual biasing (Chrome 142+ SpeechRecognitionPhrase) --
    // The Web Speech recognizer leans toward these phrases when audio is
    // ambiguous, fixing the most common mis-recognitions in tech interviews
    // (e.g. "java script" → "JavaScript", "node JS" → "Node.js"). Feature-
    // detected in _createRecognition; silently no-ops on older browsers.
    _STT_BIAS_PHRASES: [
        // Languages / runtimes
        'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Golang',
        'Rust', 'Ruby', 'PHP', 'Scala', 'Swift', 'Dart',
        'Node.js', 'Deno', 'Bun',
        // Frontend
        'React', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Nuxt',
        'Redux', 'Tailwind', 'Bootstrap', 'Webpack', 'Vite',
        // Backend
        'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot',
        'Rails', 'Laravel', 'ASP.NET',
        // Databases
        'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch',
        'DynamoDB', 'Cassandra', 'Firestore', 'Snowflake',
        // Cloud + infra
        'AWS', 'Azure', 'GCP', 'Google Cloud',
        'EC2', 'S3', 'Lambda', 'CloudFront',
        'Docker', 'Kubernetes', 'Terraform', 'Jenkins',
        'GitHub Actions', 'CI/CD', 'DevOps',
        // APIs + data
        'REST API', 'GraphQL', 'gRPC', 'WebSocket',
        'JSON', 'XML', 'YAML', 'OAuth', 'JWT',
        // AI / ML
        'machine learning', 'artificial intelligence', 'deep learning',
        'neural network', 'LLM', 'GPT', 'transformer', 'fine-tuning',
        'PyTorch', 'TensorFlow', 'OpenAI', 'Anthropic',
        // Concepts
        'microservices', 'monolith', 'serverless', 'middleware',
        'algorithm', 'data structure', 'design pattern',
        'object oriented', 'functional programming',
        'unit testing', 'integration testing', 'TDD', 'BDD',
        'Agile', 'Scrum', 'Kanban', 'sprint', 'standup',
        // Roles + interview vocab
        'frontend', 'backend', 'full stack', 'DevOps engineer',
        'system design', 'scalability', 'high availability',
        'load balancer', 'caching', 'CDN', 'authentication', 'authorization',
    ],

    // -------- STT post-processing dictionary --------
    // Regex rewrites applied to recognized text (live in onresult after each
    // final, and again at send time in _autocorrect). Catches cases where
    // Web Speech splits or lowercases a known term ("java script", "javascript",
    // "node js", "html", "css", etc.). Phrase biasing above handles most of
    // this; these are the safety net for terms biasing missed or for browsers
    // that don't support contextual biasing yet.
    //
    // Order matters: longer / more specific patterns first so they win before
    // bare-acronym uppercase rules run.
    _STT_PHRASE_CORRECTIONS: [
        // Languages + runtimes
        [/\bjava[\s.\-]+script\b/gi, 'JavaScript'],
        [/\bjavascript\b/g, 'JavaScript'],
        [/\btype[\s.\-]+script\b/gi, 'TypeScript'],
        [/\btypescript\b/g, 'TypeScript'],
        [/\bnode[\s.\-]+(?:js|j\.?s\.?)\b/gi, 'Node.js'],
        [/\bnodejs\b/gi, 'Node.js'],
        [/\breact[\s.\-]+(?:js|j\.?s\.?)\b/gi, 'React'],
        [/\breactjs\b/gi, 'React'],
        [/\bnext[\s.\-]+(?:js|j\.?s\.?)\b/gi, 'Next.js'],
        [/\bnextjs\b/gi, 'Next.js'],
        [/\bvue[\s.\-]+(?:js|j\.?s\.?)\b/gi, 'Vue.js'],
        [/\bvuejs\b/gi, 'Vue.js'],
        [/\bnest[\s.\-]+(?:js|j\.?s\.?)\b/gi, 'NestJS'],
        [/\bdot[\s.\-]+net\b/gi, '.NET'],
        [/\bc[\s.\-]+sharp\b/gi, 'C#'],
        [/\bc[\s.\-]+plus[\s.\-]+plus\b/gi, 'C++'],
        // Tools / cloud / data
        [/\bmy[\s.\-]+sql\b/gi, 'MySQL'],
        [/\bpostgres[\s.\-]+sql\b/gi, 'PostgreSQL'],
        [/\bmongo[\s.\-]+d[\s.\-]*b\b/gi, 'MongoDB'],
        [/\bno[\s.\-]+sql\b/gi, 'NoSQL'],
        [/\bdev[\s.\-]+ops\b/gi, 'DevOps'],
        [/\bgit[\s.\-]+hub\b/gi, 'GitHub'],
        [/\bgit[\s.\-]+lab\b/gi, 'GitLab'],
        [/\bbit[\s.\-]+bucket\b/gi, 'Bitbucket'],
        [/\bgraph[\s.\-]+q[\s.\-]*l\b/gi, 'GraphQL'],
        [/\brest[\s.\-]+api\b/gi, 'REST API'],
        [/\bweb[\s.\-]+socket\b/gi, 'WebSocket'],
        // Acronyms — uppercase common interview ones. Conservative list:
        // each entry is virtually always meant as the acronym in this app.
        [/\bjson\b/g, 'JSON'],
        [/\bxml\b/g, 'XML'],
        [/\byaml\b/g, 'YAML'],
        [/\bhtml\b/g, 'HTML'],
        [/\bcss\b/g, 'CSS'],
        [/\bsql\b/g, 'SQL'],
        [/\baws\b/g, 'AWS'],
        [/\bgcp\b/g, 'GCP'],
        [/\bapi\b/g, 'API'],
        [/\bapis\b/g, 'APIs'],
        [/\burl\b/g, 'URL'],
        [/\burls\b/g, 'URLs'],
        [/\bsdk\b/g, 'SDK'],
        [/\bide\b/g, 'IDE'],
        [/\bui\b/g, 'UI'],
        [/\bux\b/g, 'UX'],
        [/\boop\b/g, 'OOP'],
        [/\borm\b/g, 'ORM'],
        [/\bmvc\b/g, 'MVC'],
        [/\bjwt\b/g, 'JWT'],
        [/\bcdn\b/g, 'CDN'],
        [/\btdd\b/g, 'TDD'],
        [/\bbdd\b/g, 'BDD'],
        [/\bllm\b/g, 'LLM'],
        [/\bnlp\b/g, 'NLP'],
        [/\bgpt\b/g, 'GPT'],
    ],

    // Leave / Rejoin
    _intentionalLeave: false,
    _interviewEnded: false,
    _recordingUpload: null,

    // WebRTC / WebSocket
    ws: null,
    peers: {},        // { peerId: RTCPeerConnection }
    remoteStreams: {}, // { peerId: { camera: MediaStream, screen: MediaStream } }
    _signalingQueue: [],      // sequential message queue to prevent race conditions
    _signalingBusy: false,    // true while processing a signaling message
    _pendingCandidates: {},   // { peerId: [RTCIceCandidate] } — buffered until remoteDescription is set
    _remoteDescSet: {},       // { peerId: true } — tracks whether remoteDescription has been set

    // Default STUN — will be replaced with STUN+TURN from backend
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceServersFetched: false,

    agents: [
        { id: 'priya',  name: 'Priya Sharma',  role: 'HR',                 color: '#059669', avatar: 'P' },
        { id: 'rajesh', name: 'Rajesh Mehta',   role: 'Technical Lead',     color: '#2563eb', avatar: 'R' },
        { id: 'ananya', name: 'Ananya Iyer',    role: 'Hiring Manager',     color: '#7c3aed', avatar: 'A' },
        { id: 'vikram', name: 'Vikram Singh',   role: 'Senior Recruiter',   color: '#d97706', avatar: 'V' },
        { id: 'deepa',  name: 'Deepa Nair',     role: 'Behavioral Analyst', color: '#db2777', avatar: 'D' },
        { id: 'arjun',  name: 'Arjun Kapoor',   role: 'Domain Expert',      color: '#0891b2', avatar: 'A' },
        { id: 'meera',  name: 'Meera Reddy',    role: 'Culture Assessor',   color: '#e11d48', avatar: 'M' },
        { id: 'sanjay', name: 'Sanjay Gupta',   role: 'Operations Head',    color: '#475569', avatar: 'S' }
    ],

    // ==================== INITIALIZATION ====================

    init() {
        const params = new URLSearchParams(window.location.search);
        this.roomId = params.get('id');

        if (!this.roomId) {
            this.showToast('Invalid room link. No room ID found.');
            return;
        }

        // Detect if screen sharing is supported
        this.canScreenShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        // iOS/iPadOS Safari doesn't support getDisplayMedia
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) this.canScreenShare = false;

        this.fetchRoomConfig();
        this.fetchIceServers();
        this.bindEvents();
        this.initSpeechRecognition();
    },

    async fetchRoomConfig() {
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/room/${this.roomId}`);
            if (!res.ok) {
                this.showToast('Room not found. The link may have expired.');
                return;
            }
            this.roomConfig = await res.json();
            // If room is ended, block entry
            if (this.roomConfig.status === 'ended') {
                this.showToast('This interview has ended. You cannot join again.');
                setTimeout(() => { window.location.href = '/b4kx'; }, 2500);
                return;
            }
            this.populatePreJoin();
        } catch (err) {
            console.error('Failed to fetch room:', err);
            this.showToast('Failed to load room. Please try again.');
        }
    },

    async fetchIceServers() {
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/ice-servers`);
            if (res.ok) {
                const data = await res.json();
                if (data.ice_servers && data.ice_servers.length > 0) {
                    this.ICE_SERVERS = data.ice_servers;
                    this.iceServersFetched = true;
                    const turnCount = data.ice_servers.filter(s =>
                        (s.urls || s.url || '').toString().startsWith('turn')
                    ).length;
                    console.log(`[ICE] Got ${data.ice_servers.length} servers (${turnCount} TURN)`);
                }
            }
        } catch (err) {
            console.warn('[ICE] Could not fetch ICE servers, using defaults:', err.message);
        }
    },

    populatePreJoin() {
        const config = this.roomConfig.config || {};

        // Role line (e.g. "AI/ML Engineer")
        const roleTextEl = document.getElementById('sr-prejoin-role-text');
        if (roleTextEl) roleTextEl.textContent = (config.hiringRole || '').trim();

        // Company · Location line (e.g. "TechCorp · Gurugram, Haryana"). Both
        // fields are optional — only render the dot separator when both exist.
        const company = (config.companyName || '').trim();
        const location = (config.jobLocation || '').trim();
        const companyLocEl = document.getElementById('sr-prejoin-company-loc');
        if (companyLocEl) {
            companyLocEl.textContent = [company, location].filter(Boolean).join(' · ');
        }

        // Difficulty pill — recruiter-only meta. Kept in the DOM so the
        // recruiter view can flip it on; hidden for candidates below.
        const diffEl = document.getElementById('sr-prejoin-difficulty');
        if (diffEl && config.difficulty) {
            diffEl.textContent = config.difficulty;
            diffEl.className = 'sr-pj-badge sr-badge-' + config.difficulty;
        }

        // Duration chip (recruiter-only on the new prejoin)
        const durTextEl = document.getElementById('sr-prejoin-duration-text');
        if (durTextEl && config.duration) durTextEl.textContent = config.duration + ' min';

        // Recruiter short-circuit: skip the camera/screen-share gating.
        const savedConfig = localStorage.getItem('screeningRoundConfig');
        if (savedConfig) {
            try {
                const parsed = JSON.parse(savedConfig);
                if (parsed.roomId === this.roomId && parsed.role === 'recruiter') {
                    this.userRole = 'recruiter';
                    const userData = localStorage.getItem('fluenzoUser');
                    if (userData) this.userName = JSON.parse(userData).name || '';
                    document.getElementById('sr-prejoin-candidate')?.classList.add('hidden');
                    document.getElementById('sr-prejoin-recruiter')?.classList.remove('hidden');
                    // Show the recruiter-only meta (difficulty + duration)
                    document.getElementById('sr-prejoin-difficulty')?.classList.remove('hidden');
                    document.getElementById('sr-prejoin-duration')?.classList.remove('hidden');
                    return;
                }
            } catch (e) { /* ignore */ }
        }

        // Candidate view — keep internal config out of sight.
        document.getElementById('sr-prejoin-difficulty')?.classList.add('hidden');
        document.getElementById('sr-prejoin-duration')?.classList.add('hidden');

        document.getElementById('sr-prejoin-candidate')?.classList.remove('hidden');
        document.getElementById('sr-prejoin-recruiter')?.classList.add('hidden');

        // iOS / iPadOS: no screen share API. Hide that path entirely + show the
        // gentle notice + drop the third checklist item from the readiness gate.
        if (!this.canScreenShare) {
            document.getElementById('sr-prejoin-screen-btn')?.classList.add('hidden');
            document.getElementById('sr-ready-screen')?.classList.add('hidden');
            const notice = document.getElementById('sr-mobile-notice');
            if (notice) notice.classList.remove('hidden');
        }
    },

    // ==================== MEDIA: CAMERA & SCREEN SHARE ====================

    async enableCamera() {
        const btn = document.getElementById('sr-prejoin-camera-btn');
        const video = document.getElementById('sr-camera-video');
        const placeholder = document.getElementById('sr-camera-placeholder');

        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(t => t.stop());
            this.cameraStream = null;
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(t => t.stop());
                this.audioStream = null;
            }
            this.cameraOn = false;
            if (video) { video.srcObject = null; video.classList.remove('active'); }
            placeholder?.classList.remove('hidden');
            btn?.classList.remove('sr-media-active');
            if (btn) btn.querySelector('span').textContent = 'Enable Camera';
            this.updateReadiness();
            return;
        }

        try {
            // Acquire video and audio as SEPARATE streams so mic issues
            // (keyboard mic, OS interrupts) don't kill the camera track
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            let audioStreamLocal = null;
            try {
                audioStreamLocal = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            } catch (audioErr) {
                console.warn('[Media] Could not get audio:', audioErr.message);
                this.showToast('Microphone not available. You can still join with camera only.');
            }

            this.cameraStream = videoStream;
            this.audioStream = audioStreamLocal;
            this.cameraOn = true;

            if (video) { video.srcObject = videoStream; video.classList.add('active'); }
            placeholder?.classList.add('hidden');
            btn?.classList.add('sr-media-active');
            if (btn) btn.querySelector('span').textContent = 'Camera On';

            // Monitor video track — re-enable if it ends unexpectedly
            const videoTrack = videoStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.addEventListener('ended', () => {
                    console.warn('[Camera] Video track ended unexpectedly');
                    if (this.cameraOn) {
                        this.cameraStream = null;
                        this.cameraOn = false;
                        setTimeout(() => this.enableCamera(), 500);
                    }
                });
            }

            // Monitor audio track separately — re-acquire if killed
            if (audioStreamLocal) {
                const audioTrack = audioStreamLocal.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.addEventListener('ended', () => {
                        console.warn('[Audio] Audio track ended — re-acquiring mic');
                        navigator.mediaDevices.getUserMedia({ video: false, audio: true }).then(newAudio => {
                            this.audioStream = newAudio;
                            // Update audio in existing peer connections
                            this._replaceAudioTrackInPeers(newAudio.getAudioTracks()[0]);
                            // The mic monitor cloned the now-dead track; rebuild
                            // it from the freshly-acquired stream so it keeps
                            // detecting "speaking while muted".
                            if (this._micMonitor) {
                                this._stopMicMonitor();
                                this._startMicMonitor();
                            }
                        }).catch(e => console.warn('[Audio] Re-acquire failed:', e.message));
                    });
                }
            }
        } catch (err) {
            console.error('Camera error:', err);
            this.showToast('Could not access camera. Please allow camera permission.');
        }
        this.updateReadiness();
    },

    async shareScreen() {
        const btn = document.getElementById('sr-prejoin-screen-btn');

        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
            this.screenSharing = false;
            btn?.classList.remove('sr-media-active');
            if (btn) btn.querySelector('span').textContent = 'Share Screen';
            this.updateReadiness();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            this.screenStream = stream;
            this.screenSharing = true;
            btn?.classList.add('sr-media-active');
            if (btn) btn.querySelector('span').textContent = 'Screen Shared';

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                this.screenStream = null;
                this.screenSharing = false;
                btn?.classList.remove('sr-media-active');
                if (btn) btn.querySelector('span').textContent = 'Share Screen';
                this.updateReadiness();
                this.attachRemoteStreams();
            });
        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                this.showToast('Could not share screen. Please try again.');
            }
        }
        this.updateReadiness();
    },

    updateReadiness() {
        const nameInput = document.getElementById('sr-candidate-name');
        const hasName = nameInput && nameInput.value.trim().length > 0;
        const hasCamera = !!this.cameraStream;
        const hasScreen = !!this.screenStream;
        const screenRequired = this.canScreenShare;

        const nameDot = document.querySelector('#sr-ready-name .sr-ready-dot');
        const cameraDot = document.querySelector('#sr-ready-camera .sr-ready-dot');
        const screenDot = document.querySelector('#sr-ready-screen .sr-ready-dot');

        if (nameDot) nameDot.classList.toggle('sr-ready-done', hasName);
        if (cameraDot) cameraDot.classList.toggle('sr-ready-done', hasCamera);
        if (screenDot) screenDot.classList.toggle('sr-ready-done', hasScreen);

        // Screen share only required on devices that support it
        const ready = hasName && hasCamera && (screenRequired ? hasScreen : true);
        const joinBtn = document.getElementById('sr-join-candidate-btn');
        if (joinBtn) joinBtn.disabled = !ready;
    },

    // ==================== JOIN ROOM ====================

    async joinRoom(role) {
        const joinRole = role || this.userRole || 'candidate';
        let name = '';

        if (joinRole === 'recruiter') {
            name = this.userName || 'Recruiter';
        } else {
            const nameInput = document.getElementById('sr-candidate-name');
            name = nameInput ? nameInput.value.trim() : '';
            if (!name) { this.showToast('Please enter your name to join'); nameInput?.focus(); return; }
            if (!this.cameraStream) { this.showToast('Please enable your camera to join'); return; }
            if (this.canScreenShare && !this.screenStream) { this.showToast('Please share your screen to join'); return; }
        }

        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_id: this.roomId, name, role: joinRole })
            });

            if (res.status === 403) {
                const err = await res.json().catch(() => ({}));
                this.showToast(err.detail || 'This interview has ended. You cannot join again.');
                setTimeout(() => { window.location.href = '/b4kx'; }, 2500);
                return;
            }
            if (!res.ok) { this.showToast('Failed to join. Please try again.'); return; }

            const data = await res.json();
            this.participantId = data.participant_id;
            this.userName = name;
            this.userRole = joinRole;

            await this.refreshRoom();

            // Switch screens
            document.getElementById('sr-prejoin')?.classList.add('hidden');
            document.getElementById('sr-room')?.classList.remove('hidden');

            // Candidate's mic is UNMUTED by default — reconcile the track + button
            // via the single source of truth (still auto-pauses while the AI is
            // speaking). Also start the "speaking while muted" monitor so we can
            // prompt them to unmute if they talk after manually muting.
            if (joinRole === 'candidate') {
                this.micOn = true;
                this._applyMicState();
                this._startMicMonitor();
            }

            const roomName = document.getElementById('sr-room-name');
            if (roomName) {
                const config = this.roomConfig.config || {};
                roomName.textContent = config.hiringRole ? `Screening: ${config.hiringRole}` : 'Screening Interview';
            }

            this.renderRoomLayout();
            this.updateParticipantCount();
            this.startTimer();

            // Unlock audio on join (user gesture — needed for mobile autoplay)
            this.unlockAudio();

            // Hide end button for candidates
            if (this.userRole === 'candidate') {
                document.getElementById('sr-btn-end')?.classList.add('hidden');
            }

            // Hide chat input for recruiter (read-only observer)
            if (this.userRole === 'recruiter') {
                document.getElementById('sr-chat-input-area')?.classList.add('hidden');
                document.getElementById('sr-stt-indicator')?.classList.add('hidden');

                // Recruiter MUST acquire audio before WebRTC signaling.
                // Without at least one sendrecv transceiver (from a real track),
                // some browsers skip ICE gathering for recvonly-only connections,
                // causing the recruiter to receive ZERO media from the candidate.
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    this.audioStream = audioStream;
                    this.micOn = true;
                    console.log('[Join] Recruiter acquired audio for WebRTC');
                } catch (e) {
                    console.warn('[Join] Recruiter audio unavailable:', e.message);
                }
            }

            // Pre-warm STT engine for candidate so it's instantly ready when interview begins
            if (this.userRole === 'candidate') {
                this._prewarmSTT();
            }

            // Ensure ICE/TURN servers are fetched before connecting
            if (!this.iceServersFetched) {
                await this.fetchIceServers();
            }

            // Connect WebSocket for signaling
            this.connectSignaling();
        } catch (err) {
            console.error('Join error:', err);
            this.showToast('Connection error. Please try again.');
        }
    },

    async refreshRoom() {
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/room/${this.roomId}`);
            if (res.ok) this.roomConfig = await res.json();
        } catch (e) { /* silent */ }
    },

    // ==================== WEBSOCKET SIGNALING ====================

    connectSignaling() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/screening_round/ws/${this.roomId}/${this.participantId}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Signaling connected as', this.participantId);
            if (this.userRole === 'candidate') {
                // Only send candidate-ready on first join (not rejoin)
                if (!this.interviewStarted && !this._interviewEnded) {
                    setTimeout(() => this.sendCandidateReady(), 1500);
                }
                // Initialize proctoring after camera is active
                if (this.cameraStream) {
                    const videoEl = document.getElementById('sr-my-camera-feed');
                    if (videoEl) {
                        if (typeof ScreeningProctor !== 'undefined') {
                            ScreeningProctor.init(videoEl, this.cameraStream);
                        }
                    }
                }
                // Resume STT if interview is running and mic is on
                if (this.interviewStarted && this.micOn) {
                    setTimeout(() => this.startListening(), 1000);
                }
            }
        };

        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            // Queue messages and process sequentially to prevent race conditions
            // (ICE candidates arriving before offer/answer setRemoteDescription completes)
            this._signalingQueue.push(msg);
            this._drainSignalingQueue();
        };

        this.ws.onclose = () => {
            console.log('[WS] Signaling disconnected');
            if (this._intentionalLeave || this._interviewEnded) return;

            // Auto-reconnect for both recruiter and candidate
            this.updateChatStatus('Reconnecting...', null);
            this.addSystemMessage('Connection lost. Attempting to reconnect...');

            let retries = 0;
            const maxRetries = 3;
            const tryReconnect = () => {
                if (this._intentionalLeave || this._interviewEnded) return;
                retries++;
                console.log(`[WS] Reconnect attempt ${retries}/${maxRetries}`);
                try {
                    this.connectSignaling();
                } catch (e) {
                    console.error('[WS] Reconnect failed:', e);
                    if (retries < maxRetries) {
                        setTimeout(tryReconnect, 3000 * retries);
                    } else {
                        this.updateChatStatus('Connection lost', null);
                        this.addSystemMessage('Reconnection failed after multiple attempts.');
                        if (this.userRole === 'candidate') {
                            this.handleAutoClose();
                        }
                    }
                }
            };
            setTimeout(tryReconnect, 2000);
        };

        this.ws.onerror = (err) => {
            console.error('[WS] Error:', err);
        };
    },

    async _drainSignalingQueue() {
        if (this._signalingBusy) return; // already processing
        this._signalingBusy = true;
        try {
            while (this._signalingQueue.length > 0) {
                const msg = this._signalingQueue.shift();
                try {
                    await this.handleSignalingMessage(msg);
                } catch (e) {
                    console.error('[WS] Handle error:', e);
                }
            }
        } finally {
            this._signalingBusy = false;
        }
    },

    async handleSignalingMessage(msg) {
        console.log('[WS] Received:', msg.type, msg.from || msg.peers || '');

        switch (msg.type) {
            // ---- WebRTC Signaling ----
            case 'existing-peers':
                for (const peerId of msg.peers) {
                    await this.createPeerAndOffer(peerId);
                }
                break;

            case 'peer-joined':
                console.log('[WS] Peer joined:', msg.participant_id);
                await this.refreshRoom();
                this.renderRoomLayout();
                this.updateParticipantCount();
                // The new peer received 'existing-peers' and will send us an offer.
                // We wait for their offer to avoid dual-offer glare/race conditions.
                // Fallback: if no offer arrives in 10s (e.g. signaling lost), create one.
                if (!this._peerJoinedFallback) this._peerJoinedFallback = {};
                if (this._peerJoinedFallback[msg.participant_id]) {
                    clearTimeout(this._peerJoinedFallback[msg.participant_id]);
                }
                this._peerJoinedFallback[msg.participant_id] = setTimeout(() => {
                    delete this._peerJoinedFallback[msg.participant_id];
                    const pc = this.peers[msg.participant_id];
                    if (pc && pc.connectionState === 'connected') return; // already connected
                    if (this._intentionalLeave || this._interviewEnded) return;
                    console.warn('[RTC] No offer from', msg.participant_id, 'in 10s — creating offer as fallback');
                    this.createPeerAndOffer(msg.participant_id);
                }, 10000);
                break;

            case 'offer':
                await this.handleOffer(msg.from, msg.data);
                break;

            case 'answer':
                await this.handleAnswer(msg.from, msg.data);
                break;

            case 'ice-candidate':
                if (msg.data) {
                    if (this.peers[msg.from] && this._remoteDescSet[msg.from]) {
                        // Remote description is set — safe to add candidate directly
                        try {
                            await this.peers[msg.from].addIceCandidate(new RTCIceCandidate(msg.data));
                        } catch (e) {
                            console.error('[ICE] Add candidate error:', e);
                        }
                    } else {
                        // Buffer candidate until remote description is set
                        if (!this._pendingCandidates[msg.from]) {
                            this._pendingCandidates[msg.from] = [];
                        }
                        this._pendingCandidates[msg.from].push(msg.data);
                        console.log('[ICE] Buffered candidate for', msg.from, '(remoteDesc not set yet)');
                    }
                }
                break;

            case 'peer-left':
                // Clear any pending fallback offer timer for this peer
                if (this._peerJoinedFallback?.[msg.participant_id]) {
                    clearTimeout(this._peerJoinedFallback[msg.participant_id]);
                    delete this._peerJoinedFallback[msg.participant_id];
                }
                this.removePeer(msg.participant_id);
                break;

            // ---- Interview Engine Messages ----
            case 'interview-started':
                this.interviewStarted = true;
                this.updateChatStatus('Interview in progress', 'live');
                this.addSystemMessage('Interview has started. The panel will take turns asking questions.');
                // Discourage closing the tab while the interview is live.
                this._enableExitGuard();
                if (this.userRole === 'candidate') {
                    // Blank slate at interview start — clear any stale chunks
                    // from a prior session/rejoin so the textarea begins empty.
                    this._chunkChainReset();
                    // Reconcile mic + STT + recorder via the single source of
                    // truth. If TTS is already queued, this leaves the mic
                    // auto-paused until the queue drains.
                    this._applyMicState();
                    // Auto-start screen recording
                    if (typeof ScreeningRecorder !== 'undefined' && this.screenStream) {
                        console.log('[Room] Starting screen recorder...');
                        ScreeningRecorder.start(this.screenStream, this.audioStream);
                    }
                }
                break;

            case 'agent-thinking':
                // Don't stop STT here — candidate may still be speaking
                this.showTypingIndicator(msg.agent_id, msg.agent_name);
                this.highlightSpeakingAgent(msg.agent_id);
                // Clear any pending TTS audio from the previous agent
                // (background TTS may arrive late since it's fire-and-forget)
                if (this.isPlayingAudio) {
                    this._stopAllAudio();
                    // Reconcile mic state — TTS just stopped (mid-burst), so
                    // the candidate's mic should auto-resume.
                    if (this.userRole === 'candidate') this._applyMicState();
                } else {
                    this._stopAllAudio();
                }
                this.currentSpeakingAgent = msg.agent_id;
                break;

            case 'agent-speaking':
                this.removeTypingIndicator();
                this.addAgentMessage(msg.agent_id, msg.agent_name, msg.agent_role, msg.text);
                this.highlightSpeakingAgent(msg.agent_id);
                this.currentSpeakingAgent = msg.agent_id;
                // Audio may arrive with the message or separately via agent-audio
                if (msg.audio_base64) {
                    if (this._sttActive) {
                        try { this.recognition.stop(); } catch (e) {}
                    }
                    this.queueAudio(msg.audio_base64);
                }
                break;

            case 'agent-audio':
                // TTS audio arrived after text (fire-and-forget background task)
                // Only play if it's from the current/last speaking agent (discard stale audio)
                if (msg.audio_base64 && (!this.currentSpeakingAgent || msg.agent_id === this.currentSpeakingAgent)) {
                    if (this._sttActive) {
                        try { this.recognition.stop(); } catch (e) {}
                    }
                    this.queueAudio(msg.audio_base64);
                }
                break;

            case 'waiting-response':
                this.updateChatStatus('Your turn to respond', 'live');
                if (this.userRole === 'candidate') {
                    // Fresh turn — clear any transcript left over from a prior turn
                    // (e.g. a send that failed while the WS was briefly down) so the
                    // new answer can never be prefixed with stale text.
                    this.sttBuffer = '';
                    this._lastInterim = '';
                    this._suppressInputEvent = true;
                    const _ci = document.getElementById('sr-chat-input');
                    if (_ci) { _ci.value = ''; _ci.style.height = 'auto'; }
                    this._suppressInputEvent = false;
                    this.focusChatInput();
                    // Reconcile mic + STT — if any TTS is still flushing
                    // locally _applyMicState will keep the mic paused; once
                    // the TTS queue drains, _maybeFinishAudio re-applies and the mic
                    // turns back on.
                    this._applyMicState();
                    // Belt-and-braces: retry a couple of times in case start()
                    // raced with mic acquisition.
                    setTimeout(() => {
                        if (this.micOn && !this.isPlayingAudio
                            && (!this.isListening || !this._sttActive)) {
                            this.startListening();
                        }
                    }, 800);
                    setTimeout(() => {
                        if (this.micOn && !this.isPlayingAudio
                            && (!this.isListening || !this._sttActive)) {
                            this.startListening();
                        }
                    }, 2000);
                }
                break;

            case 'candidate-message':
                // Don't duplicate own messages
                if (msg.name !== this.userName || this.userRole === 'recruiter') {
                    this.addCandidateMessage(msg.name, msg.text);
                }
                break;

            case 'system-message':
                this.addSystemMessage(msg.text);
                break;

            case 'chat-history':
                // Late join: receive all previous conversation messages
                if (msg.history && Array.isArray(msg.history)) {
                    console.log(`[WS] Received chat history: ${msg.history.length} messages`);
                    this.interviewStarted = true;
                    this.updateChatStatus('Interview in progress', 'live');
                    // Rejoined an in-progress interview — re-arm the exit guard.
                    this._enableExitGuard();
                    this.addSystemMessage('You joined an ongoing interview. Showing conversation history:');
                    for (const entry of msg.history) {
                        if (entry.type === 'agent') {
                            const agent = this.agents.find(a => a.id === entry.agent_id);
                            const agentName = agent ? agent.name : entry.speaker.split(' (')[0];
                            const agentRole = agent ? agent.role : (entry.speaker.includes('(') ? entry.speaker.split('(')[1].replace(')', '') : 'Interviewer');
                            this.addAgentMessage(entry.agent_id || '', agentName, agentRole, entry.text);
                        } else if (entry.type === 'candidate') {
                            this.addCandidateMessage(entry.speaker || 'Candidate', entry.text);
                        } else if (entry.type === 'system') {
                            this.addSystemMessage(entry.text);
                        }
                    }
                    this.addSystemMessage('End of history. Live conversation continues below.');
                    // Resume recording on rejoin (preserve chunks from before leave)
                    if (this.userRole === 'candidate' && typeof ScreeningRecorder !== 'undefined' && !ScreeningRecorder.isRecording() && this.screenStream) {
                        const hasOldChunks = ScreeningRecorder._chunks && ScreeningRecorder._chunks.length > 0;
                        console.log(`[Room] ${hasOldChunks ? 'Resuming' : 'Starting'} screen recorder on rejoin...`);
                        ScreeningRecorder.start(this.screenStream, this.audioStream, hasOldChunks);
                    }
                }
                break;

            case 'interview-ended':
                this.interviewStarted = false;
                this._interviewEnded = true;
                // Live-interview guard is no longer needed; the submission overlay
                // installs its own guard while the recording uploads.
                this._disableExitGuard();
                this.stopListening();
                this._chunkChainReset();
                this.clearSpeakingAgent();
                this.removeTypingIndicator();

                // Stop proctoring and send data to server
                if (this.userRole === 'candidate' && typeof ScreeningProctor !== 'undefined' && ScreeningProctor._running) {
                    const proctorData = ScreeningProctor.getResults();
                    ScreeningProctor.stop();
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ type: 'proctor-data', data: proctorData }));
                        console.log('[Proctor] Sent proctoring data to server');
                    }
                }

                // Stop recording and upload (candidate only)
                // Check isRecording() OR hasData() — recorder may have stopped due to
                // track ending but still has chunks that need uploading
                if (this.userRole === 'candidate' && typeof ScreeningRecorder !== 'undefined'
                    && (ScreeningRecorder.isRecording() || ScreeningRecorder.hasData())) {
                    this.addSystemMessage('Saving interview recording...');
                    this._recordingUpload = ScreeningRecorder.stopAndUpload(this.roomId).then(result => {
                        if (result && result.success) {
                            this.addSystemMessage('Recording saved successfully.');
                        } else {
                            this.addSystemMessage('Recording upload failed. Retrying...');
                            return ScreeningRecorder.retryUpload(this.roomId).then(retryResult => {
                                if (retryResult && retryResult.success) {
                                    this.addSystemMessage('Recording saved on retry.');
                                } else {
                                    this.addSystemMessage('Recording could not be saved.');
                                }
                            });
                        }
                    }).catch(e => {
                        console.error('[Recorder] Stop/upload error:', e);
                    });
                }

                // Stop any playing TTS audio immediately
                this._stopAllAudio();

                // Disable end and leave buttons
                const endBtn2 = document.getElementById('sr-btn-end');
                if (endBtn2) { endBtn2.disabled = true; endBtn2.style.opacity = '0.5'; }
                const leaveBtn2 = document.getElementById('sr-btn-leave');
                if (leaveBtn2) { leaveBtn2.disabled = true; leaveBtn2.style.opacity = '0.5'; }

                if (this.userRole === 'recruiter') {
                    // Redirect recruiter to feedback loading page
                    this.showToast('Interview ended. Redirecting to feedback...');
                    // Store room_id for feedback page
                    localStorage.setItem('lastScreeningRoomId', this.roomId);
                    setTimeout(() => {
                        this.cleanupAndRedirect('/s6oz');
                    }, 2000);
                } else {
                    // Candidate: show submission overlay and handle upload
                    this.showSubmissionOverlay();
                }
                break;

            case 'feedback-generating':
            case 'feedback-ready':
                // These are handled by the feedback dashboard page now
                break;
        }
    },

    sendSignal(targetId, type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, target: targetId, data }));
        }
    },

    // ==================== WEBRTC ====================

    /**
     * Create a new RTCPeerConnection for a specific peer.
     * Sets up ICE handling, track receiving, and connection state monitoring.
     */
    setupPeerConnection(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
        }
        // Reset signaling state for this peer
        delete this._remoteDescSet[peerId];
        delete this._pendingCandidates[peerId];

        const pc = new RTCPeerConnection({ iceServers: this.ICE_SERVERS });
        this.peers[peerId] = pc;

        // ICE candidate handling
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
            }
        };

        // Track streams from this peer — reclassify on every ontrack since
        // audio tracks may arrive after video tracks for the same stream
        const peerStreamIds = new Set();

        // When remote tracks arrive
        pc.ontrack = (event) => {
            console.log('[RTC] ontrack from', peerId, '— track:', event.track.kind, 'streams:', event.streams.length);

            const stream = event.streams[0];
            if (!stream) {
                console.warn('[RTC] ontrack with no stream');
                return;
            }

            peerStreamIds.add(stream.id);

            if (!this.remoteStreams[peerId]) {
                this.remoteStreams[peerId] = {};
            }

            // Re-classify ALL streams from this peer on every ontrack event.
            // This handles the race where video ontrack fires before audio is
            // attached to the same stream — on the next ontrack the audio will
            // be present and classification corrects itself.
            const allStreams = [];
            for (const sid of peerStreamIds) {
                // Find the stream object — it might be the current one or one from a prior event
                const s = (stream.id === sid) ? stream : this.remoteStreams[peerId]._streamMap?.[sid];
                if (s) allStreams.push(s);
            }

            // Store stream references by ID for future re-classification
            if (!this.remoteStreams[peerId]._streamMap) {
                this.remoteStreams[peerId]._streamMap = {};
            }
            this.remoteStreams[peerId]._streamMap[stream.id] = stream;

            // Classify: stream with audio = camera, video-only = screen
            this.remoteStreams[peerId].camera = null;
            this.remoteStreams[peerId].screen = null;
            for (const s of allStreams) {
                const hasAudio = s.getAudioTracks().length > 0;
                if (hasAudio) {
                    this.remoteStreams[peerId].camera = s;
                    console.log('[RTC] Classified CAMERA stream from', peerId, '(id:', s.id, ')');
                } else {
                    this.remoteStreams[peerId].screen = s;
                    console.log('[RTC] Classified SCREEN stream from', peerId, '(id:', s.id, ')');
                }
            }

            // Update the UI
            this.attachRemoteStreams();

            // Clear all watchdog timers — we received media successfully
            this._clearTrackWatchdog(peerId);

            // Monitor remote track lifecycle for recovery
            event.track.addEventListener('ended', () => {
                console.warn('[RTC] Remote track ended from', peerId, ':', event.track.kind);
                setTimeout(() => this.attachRemoteStreams(), 500);
            });
            event.track.addEventListener('unmute', () => {
                console.log('[RTC] Remote track unmuted from', peerId, ':', event.track.kind);
                this.attachRemoteStreams();
            });
        };

        pc.onconnectionstatechange = () => {
            console.log('[RTC] Connection state with', peerId, ':', pc.connectionState);
            if (pc.connectionState === 'failed') {
                console.warn('[RTC] Connection failed with', peerId, '— attempting ICE restart');
                this._attemptIceRestart(peerId);
            }
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            console.log('[RTC] ICE state with', peerId, ':', state);
            if (state === 'disconnected') {
                // ICE disconnected — give it a few seconds to recover before restart
                setTimeout(() => {
                    if (this.peers[peerId] && this.peers[peerId].iceConnectionState === 'disconnected') {
                        console.warn('[RTC] ICE still disconnected after 5s — attempting restart');
                        this._attemptIceRestart(peerId);
                    }
                }, 5000);
            }
        };

        return pc;
    },

    /**
     * I am the initiator — create a peer connection and send an offer.
     * If I have local media, add tracks. Otherwise add recvonly transceivers.
     * Ensures at least 1 audio + 2 video transceivers exist for receiving.
     */
    async createPeerAndOffer(peerId) {
        const pc = this.setupPeerConnection(peerId);

        // Add local media tracks if available
        this.addLocalTracks(pc);

        // Ensure enough transceivers to RECEIVE all media from the remote peer.
        // We need: 1 audio (candidate voice) + 2 video (camera + screen share).
        // If we have a local audio track (sendrecv), the audio transceiver already exists.
        // For video, add recvonly transceivers for any missing slots.
        const senders = pc.getSenders();
        const transceivers = pc.getTransceivers();
        const hasAudioTransceiver = transceivers.some(t => t.receiver?.track?.kind === 'audio' || (t.sender?.track?.kind === 'audio'));
        const videoTransceiverCount = transceivers.filter(t => t.receiver?.track?.kind === 'video' || (t.sender?.track?.kind === 'video')).length;
        if (!hasAudioTransceiver) {
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }
        for (let i = videoTransceiverCount; i < 2; i++) {
            pc.addTransceiver('video', { direction: 'recvonly' });
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(peerId, 'offer', { sdp: offer.sdp, type: offer.type });
        console.log('[RTC] Sent offer to', peerId);
    },

    /**
     * Received an offer — set up peer connection, add tracks, send answer.
     */
    async handleOffer(fromId, offerData) {
        // Clear peer-joined fallback timer — we received their offer
        if (this._peerJoinedFallback?.[fromId]) {
            clearTimeout(this._peerJoinedFallback[fromId]);
            delete this._peerJoinedFallback[fromId];
        }

        const existingPc = this.peers[fromId];

        // Glare handling: if we already sent an offer to this peer (have-local-offer),
        // use a tiebreaker — the peer with the smaller ID wins as the offerer.
        if (existingPc && existingPc.signalingState === 'have-local-offer') {
            const iAmPolite = this.participantId > fromId;
            if (iAmPolite) {
                // We back off — rollback our offer and accept theirs
                console.log('[RTC] Glare: rolling back our offer, accepting from', fromId);
                await existingPc.setLocalDescription({ type: 'rollback' });
                await existingPc.setRemoteDescription(new RTCSessionDescription(offerData));
                this._remoteDescSet[fromId] = true;
                await this._flushPendingCandidates(fromId);
                const answer = await existingPc.createAnswer();
                await existingPc.setLocalDescription(answer);
                this.sendSignal(fromId, 'answer', { sdp: answer.sdp, type: answer.type });
                console.log('[RTC] Sent answer (after rollback) to', fromId);
                return;
            } else {
                // We win — ignore their offer; they'll accept our offer
                console.log('[RTC] Glare: ignoring offer from', fromId, '(we are the offerer)');
                return;
            }
        }

        // Reuse existing PC if it's a renegotiation, otherwise create new
        let pc = this.peers[fromId];
        if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'closed') {
            pc = this.setupPeerConnection(fromId);
        }

        // Set remote description FIRST so the browser creates transceivers from
        // the offer's m-lines. Then addLocalTracks will reuse these transceivers
        // (matching by kind) instead of creating new ones that might not align.
        // This is critical when the offerer has recvonly transceivers (recruiter).
        delete this._remoteDescSet[fromId];
        delete this._pendingCandidates[fromId];
        await pc.setRemoteDescription(new RTCSessionDescription(offerData));
        this._remoteDescSet[fromId] = true;

        // NOW add local tracks — addTrack will reuse existing transceivers from
        // the offer, properly matching audio↔audio and video↔video
        this.addLocalTracks(pc);
        await this._flushPendingCandidates(fromId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(fromId, 'answer', { sdp: answer.sdp, type: answer.type });
        console.log('[RTC] Sent answer to', fromId);
    },

    /**
     * Received an answer to our offer.
     */
    async handleAnswer(fromId, answerData) {
        const pc = this.peers[fromId];
        if (!pc) {
            console.warn('[RTC] No PC found for answer from', fromId);
            return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(answerData));
        this._remoteDescSet[fromId] = true;
        await this._flushPendingCandidates(fromId);
        console.log('[RTC] Set remote description (answer) from', fromId);

        // Watchdog: verify remote tracks arrive within 15s, renegotiate if not
        this._startTrackWatchdog(fromId);
    },

    /**
     * Flush any ICE candidates that were buffered before remoteDescription was set.
     */
    async _flushPendingCandidates(peerId) {
        const pending = this._pendingCandidates[peerId];
        if (!pending || pending.length === 0) return;
        const pc = this.peers[peerId];
        if (!pc) return;
        console.log(`[ICE] Flushing ${pending.length} buffered candidates for`, peerId);
        for (const candidateData of pending) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
                console.error('[ICE] Flush candidate error:', e);
            }
        }
        delete this._pendingCandidates[peerId];
    },

    /**
     * Multi-phase connection health monitor:
     * Phase 1 (8s): If no remote media yet, attempt ICE restart.
     * Phase 2 (18s): If still no media, full peer reconnect.
     * Phase 3 (30s): If still no media, tear down and rebuild from scratch.
     * Handles: symmetric NAT, TURN relay issues, lost tracks, stale connections.
     */
    _startTrackWatchdog(peerId) {
        if (!this._trackWatchdogs) this._trackWatchdogs = {};
        // Clear any previous watchdog chain for this peer
        if (this._trackWatchdogs[peerId]) {
            this._trackWatchdogs[peerId].forEach(t => clearTimeout(t));
        }

        const _hasPeerMedia = () => {
            return this.remoteStreams[peerId] &&
                (this.remoteStreams[peerId].camera || this.remoteStreams[peerId].screen);
        };
        const _isAlive = () => {
            const pc = this.peers[peerId];
            return pc && pc.connectionState !== 'closed' && !this._intentionalLeave && !this._interviewEnded;
        };

        const timers = [];

        // Phase 1: ICE restart after 8s
        timers.push(setTimeout(() => {
            if (!_isAlive() || _hasPeerMedia()) return;
            console.warn('[RTC] Phase 1: No media from', peerId, 'after 8s — ICE restart');
            this._attemptIceRestart(peerId);
        }, 8000));

        // Phase 2: Full reconnect after 18s
        timers.push(setTimeout(() => {
            if (!_isAlive() || _hasPeerMedia()) return;
            console.warn('[RTC] Phase 2: No media from', peerId, 'after 18s — full reconnect');
            this.removePeer(peerId);
            this.createPeerAndOffer(peerId);
        }, 18000));

        // Phase 3: Last resort — tear down, re-fetch ICE, rebuild
        timers.push(setTimeout(async () => {
            if (_hasPeerMedia() || this._intentionalLeave || this._interviewEnded) return;
            console.warn('[RTC] Phase 3: No media from', peerId, 'after 30s — full rebuild with fresh ICE');
            this.removePeer(peerId);
            await this.fetchIceServers();
            this.createPeerAndOffer(peerId);
        }, 30000));

        this._trackWatchdogs[peerId] = timers;
    },

    /**
     * Cancel all watchdog timers for a peer (called when media arrives or peer removed).
     */
    _clearTrackWatchdog(peerId) {
        if (this._trackWatchdogs?.[peerId]) {
            this._trackWatchdogs[peerId].forEach(t => clearTimeout(t));
            delete this._trackWatchdogs[peerId];
        }
    },

    /**
     * Attempt ICE restart when connection fails — renegotiates without tearing down the peer.
     * Falls back to full reconnection if ICE restart also fails.
     */
    async _attemptIceRestart(peerId) {
        const pc = this.peers[peerId];
        if (!pc || pc.connectionState === 'closed') {
            // PC is gone — do a full reconnect
            console.log('[RTC] PC closed, doing full reconnect for', peerId);
            this.removePeer(peerId);
            await this.createPeerAndOffer(peerId);
            return;
        }
        try {
            delete this._remoteDescSet[peerId];
            delete this._pendingCandidates[peerId];
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            this.sendSignal(peerId, 'offer', { sdp: offer.sdp, type: offer.type });
            console.log('[RTC] Sent ICE restart offer to', peerId);
        } catch (e) {
            console.error('[RTC] ICE restart failed, doing full reconnect:', e);
            this.removePeer(peerId);
            await this.createPeerAndOffer(peerId);
        }
    },

    /**
     * Add local camera + screen tracks to a peer connection.
     * Returns true if any tracks were added.
     */
    addLocalTracks(pc) {
        let added = false;

        // Track IDs already on this PC (idempotency — don't double-add)
        const existingTrackIds = new Set(pc.getSenders().filter(s => s.track).map(s => s.track.id));

        // Create a combined stream for camera video + audio so remote sees them together
        if (this.cameraStream || this.audioStream) {
            const combinedStream = new MediaStream();
            if (this.cameraStream) {
                this.cameraStream.getVideoTracks().forEach(t => combinedStream.addTrack(t));
            }
            if (this.audioStream) {
                this.audioStream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
            }
            combinedStream.getTracks().forEach(track => {
                if (!existingTrackIds.has(track.id)) {
                    pc.addTrack(track, combinedStream);
                }
            });
            added = true;
        }

        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => {
                if (!existingTrackIds.has(track.id)) {
                    pc.addTrack(track, this.screenStream);
                }
            });
            added = true;
        }
        return added;
    },

    /**
     * Attach received remote streams to video elements in the DOM.
     * Called after ontrack or after re-render.
     */
    attachRemoteStreams() {
        // Update main view (screen share)
        const mainVideo = document.getElementById('sr-screen-video-main');
        const mainPlaceholder = document.getElementById('sr-main-placeholder');
        let foundScreen = false;

        // Check local screen share first
        if (this.screenStream) {
            if (mainVideo) {
                mainVideo.srcObject = this.screenStream;
                mainVideo.classList.add('active');
                mainVideo.play().catch(() => {});
            }
            mainPlaceholder?.classList.add('hidden');
            foundScreen = true;
        }

        // Then check remote screen shares
        if (!foundScreen) {
            for (const peerId of Object.keys(this.remoteStreams)) {
                if (this.remoteStreams[peerId].screen) {
                    if (mainVideo) {
                        mainVideo.srcObject = this.remoteStreams[peerId].screen;
                        mainVideo.classList.add('active');
                        mainVideo.play().catch(() => {
                            mainVideo.muted = true;
                            mainVideo.play().then(() => {
                                setTimeout(() => { mainVideo.muted = false; }, 300);
                            }).catch(e => console.warn('[UI] Screen play failed:', e));
                        });
                    }
                    mainPlaceholder?.classList.add('hidden');
                    foundScreen = true;
                    break;
                }
            }
        }

        if (!foundScreen) {
            if (mainVideo) { mainVideo.srcObject = null; mainVideo.classList.remove('active'); }
            mainPlaceholder?.classList.remove('hidden');
        }

        // Re-render side panel to show all tiles
        this.renderSidePanel();
    },

    removePeer(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        delete this.remoteStreams[peerId];
        delete this._remoteDescSet[peerId];
        delete this._pendingCandidates[peerId];
        this._clearTrackWatchdog(peerId);
        this._sidePanelFingerprint = null;  // Force panel rebuild
        this.attachRemoteStreams();
    },

    // ==================== ROOM LAYOUT (Google Meet Style) ====================

    renderRoomLayout() {
        this.attachRemoteStreams();
    },

    renderSidePanel() {
        const panel = document.getElementById('sr-side-panel');
        if (!panel) return;

        const config = this.roomConfig.config || {};
        const selectedAgents = config.selectedAgents || [];

        // Build the desired set of tile keys to detect what changed
        const desiredTiles = [];

        // My camera tile
        if (this.cameraStream) {
            desiredTiles.push({ key: 'my-camera', type: 'my-camera' });
        }

        // Remote peer camera tiles
        for (const peerId of Object.keys(this.remoteStreams)) {
            if (this.remoteStreams[peerId].camera) {
                desiredTiles.push({ key: `remote-${peerId}`, type: 'remote-camera', peerId });
            }
        }

        // AI agent tiles
        selectedAgents.forEach(agentData => {
            const agent = (typeof agentData === 'string') ? this.agents.find(a => a.id === agentData) : agentData;
            if (agent) desiredTiles.push({ key: `agent-${agent.id}`, type: 'agent', agent });
        });

        // Fallback avatar tiles for participants without WebRTC
        const participants = this.roomConfig.participants || [];
        participants.forEach(p => {
            if (p.id === this.participantId) return;
            if (this.remoteStreams[p.id]) return;
            desiredTiles.push({ key: `fallback-${p.id}`, type: 'fallback', participant: p });
        });

        // Compute a fingerprint to skip re-render if nothing changed
        const newFingerprint = desiredTiles.map(t => t.key).join('|');
        if (this._sidePanelFingerprint === newFingerprint) {
            // Tiles haven't changed — just re-attach streams without rebuilding DOM
            this._attachSidePanelStreams();
            return;
        }
        this._sidePanelFingerprint = newFingerprint;

        // Tiles changed — rebuild panel HTML
        let html = '';

        for (const tile of desiredTiles) {
            if (tile.type === 'my-camera') {
                html += `
                    <div class="sr-side-tile sr-tile-you" id="sr-my-camera-tile">
                        <video id="sr-my-camera-feed" autoplay muted playsinline></video>
                        <div class="sr-side-tile-label">${this.userName} (You)</div>
                    </div>
                `;
            } else if (tile.type === 'remote-camera') {
                const pInfo = participants.find(p => p.id === tile.peerId);
                const peerName = pInfo ? pInfo.name : 'Participant';
                const isRecruiter = pInfo && pInfo.role === 'recruiter';
                html += `
                    <div class="sr-side-tile ${isRecruiter ? 'sr-tile-recruiter' : ''}" data-peer-id="${tile.peerId}">
                        <video id="sr-remote-camera-${tile.peerId}" autoplay playsinline></video>
                        <div class="sr-side-tile-label">${peerName}</div>
                        ${isRecruiter ? '<div class="sr-tile-badge-recruiter">Recruiter</div>' : ''}
                    </div>
                `;
            } else if (tile.type === 'agent') {
                const a = tile.agent;
                html += `
                    <div class="sr-side-tile" data-id="${a.id}">
                        <div class="sr-side-tile-avatar" style="background: ${a.color || '#6366f1'}">${a.avatar || a.name?.charAt(0) || 'A'}</div>
                        <div class="sr-side-tile-label">${a.name}</div>
                        <div class="sr-side-tile-role">${a.role || 'Interviewer'}</div>
                    </div>
                `;
            } else if (tile.type === 'fallback') {
                const p = tile.participant;
                const isRecruiter = p.role === 'recruiter';
                const initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
                const avatarColor = isRecruiter ? '#059669' : '#6366f1';
                html += `
                    <div class="sr-side-tile ${isRecruiter ? 'sr-tile-recruiter' : ''}" data-id="${p.id}">
                        <div class="sr-side-tile-avatar" style="background: ${avatarColor}">${initial}</div>
                        <div class="sr-side-tile-label">${p.name}</div>
                        <div class="sr-side-tile-role">${isRecruiter ? 'Recruiter' : 'Candidate'}</div>
                        ${isRecruiter ? '<div class="sr-tile-badge-recruiter">Recruiter</div>' : ''}
                    </div>
                `;
            }
        }

        panel.innerHTML = html;

        // Attach all streams to the new DOM elements
        this._attachSidePanelStreams();

        // Re-attach proctor canvas overlay (panel rebuild destroys it)
        if (this.userRole === 'candidate' && typeof ScreeningProctor !== 'undefined') {
            ScreeningProctor._reattachCanvas();
        }

        // Recruiter side: proctor overlay disabled — proctoring runs on candidate side only
        if (false && this.userRole === 'recruiter' && typeof RecruiterProctorOverlay !== 'undefined') {
            for (const peerId of Object.keys(this.remoteStreams)) {
                if (this.remoteStreams[peerId].camera) {
                    // Find candidate tile — check participants list OR just use first non-recruiter peer
                    const participants = this.roomConfig.participants || [];
                    const pInfo = participants.find(p => p.id === peerId);
                    // If participant info available, check role; otherwise assume candidate (only candidates have camera streams for recruiter)
                    const isCandidate = !pInfo || pInfo.role === 'candidate';
                    if (isCandidate) {
                        const tileEl = document.querySelector(`[data-peer-id="${peerId}"]`);
                        const videoEl = document.getElementById(`sr-remote-camera-${peerId}`);
                        if (tileEl && videoEl) {
                            if (RecruiterProctorOverlay._running) {
                                // Panel rebuild destroyed the canvas — reattach with new tile reference
                                RecruiterProctorOverlay.reattach(tileEl);
                            } else {
                                RecruiterProctorOverlay.start(tileEl, videoEl, this.remoteStreams[peerId].camera);
                            }
                        }
                    }
                }
            }
        }
    },

    /**
     * Attach media streams to video elements in the side panel without
     * rebuilding DOM. Called after innerHTML rebuild AND on subsequent
     * ontrack events when the tile set hasn't changed (fingerprint match).
     */
    _attachSidePanelStreams() {
        // Local camera
        if (this.cameraStream) {
            const myFeed = document.getElementById('sr-my-camera-feed');
            if (myFeed && myFeed.srcObject !== this.cameraStream) {
                myFeed.srcObject = this.cameraStream;
                myFeed.play().catch(() => {});
            }
        }

        // Remote camera feeds
        for (const peerId of Object.keys(this.remoteStreams)) {
            if (this.remoteStreams[peerId].camera) {
                const remoteVideo = document.getElementById(`sr-remote-camera-${peerId}`);
                if (remoteVideo && remoteVideo.srcObject !== this.remoteStreams[peerId].camera) {
                    remoteVideo.srcObject = this.remoteStreams[peerId].camera;
                    remoteVideo.play().catch(() => {
                        remoteVideo.muted = true;
                        remoteVideo.play().then(() => {
                            setTimeout(() => { remoteVideo.muted = false; }, 300);
                        }).catch(e => console.warn('[UI] Remote camera play failed:', e));
                    });
                    console.log('[UI] Attached remote camera for', peerId);
                }
            }
        }
    },

    // ==================== TIMER ====================

    startTimer(reset = true) {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (reset) this.elapsedSeconds = 0;

        this.timerInterval = setInterval(() => {
            this.elapsedSeconds++;
            const m = String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
            const s = String(this.elapsedSeconds % 60).padStart(2, '0');
            const display = document.getElementById('sr-timer-display');
            if (display) display.textContent = `${m}:${s}`;
        }, 1000);
    },

    // ==================== CONTROLS ====================

    toggleMic() {
        // micOn = the candidate's *intent* / button state. The actual track
        // enable state is derived in _applyMicState() so that auto-pause during
        // TTS can override without forgetting the user's preference.
        this.micOn = !this.micOn;
        console.log('[Mic] toggled →', this.micOn ? 'ON' : 'OFF',
            '| interviewStarted=', this.interviewStarted,
            '| isPlayingAudio=', this.isPlayingAudio,
            '| userRole=', this.userRole,
            '| sttSupported=', this.sttSupported);
        this._applyMicState();
    },

    /**
     * Reconcile the audio track + STT + turn recorder + button UI from the two
     * sources of truth:
     *   - this.micOn         : candidate's intent (set by toggleMic)
     *   - this.isPlayingAudio: AI is currently speaking via TTS
     *
     * effective = micOn && !isPlayingAudio
     */
    _applyMicState() {
        const effective = this.micOn && !this.isPlayingAudio;
        const autoPaused = this.micOn && this.isPlayingAudio;

        // 1. Hard-mute the audio track when not effective. This is the only way
        //    to guarantee the candidate's mic never picks up the AI's voice
        //    (echoCancellation is not 100% — speaker bleed slips through).
        if (this.audioStream) {
            this.audioStream.getAudioTracks().forEach(t => { t.enabled = effective; });
        }

        // 2. Button UI reflects the candidate's *intent* (micOn). When auto-
        //    paused we keep the "on" icon but add a class so CSS can show a
        //    subtle hint (pulse, halo, etc.).
        const btn = document.getElementById('sr-btn-mic');
        if (btn) {
            btn.classList.toggle('sr-control-off', !this.micOn);
            btn.classList.toggle('sr-control-auto-paused', autoPaused);
            btn.querySelector('.sr-icon-mic-on')?.classList.toggle('hidden', !this.micOn);
            btn.querySelector('.sr-icon-mic-off')?.classList.toggle('hidden', this.micOn);
            const title = !this.micOn
                ? 'Unmute (click to turn mic on)'
                : autoPaused
                    ? 'Mic auto-paused while interviewer is speaking'
                    : 'Mute';
            btn.setAttribute('title', title);
            btn.setAttribute('aria-label', title);
        }

        // 3. STT follows the effective state. Don't gate on interviewStarted —
        //    the candidate can tap mic right after joining; we want STT armed.
        //
        //    Full stop/start per turn (NOT a warm soft-pause). A warm-paused
        //    Sarvam WS sits idle through the AI's (often 30s+) TTS turns; Sarvam
        //    closes idle streaming sockets, so on resume the socket is dead and
        //    the restart path re-transcribes overlapping audio, concatenating
        //    duplicates ("...work expHello My name is Harish...") that compound
        //    every turn. A fresh session per turn never goes idle and carries no
        //    cross-turn state. The #1 _openMic leak fix is what makes this
        //    per-turn churn safe now (it was the original AudioContext-leak hot
        //    path). See [[project_sarvam_stt]] gotcha.
        if (effective && this.userRole === 'candidate') {
            console.log('[Mic] applying → start STT');
            this.startListening();
        } else {
            console.log('[Mic] applying → stop STT (effective=', effective, ')');
            this.stopListening();
        }

        // 4. STT indicator: show a clear auto-pause state vs user-muted state.
        const indicator = document.getElementById('sr-stt-indicator');
        if (indicator) {
            if (autoPaused) {
                indicator.classList.remove('hidden', 'sr-stt-warning');
                indicator.classList.add('sr-stt-auto-paused');
                indicator.innerHTML = '<div class="sr-stt-pulse"></div><span>Interviewer is speaking, please wait</span>';
            } else {
                indicator.classList.remove('sr-stt-auto-paused');
                // The Listening / hidden states are managed by startListening /
                // stopListening; nothing to do here.
            }
        }
    },

    // ---- "Speaking while muted" detection ----------------------------------
    // When the candidate mutes, this.audioStream's track is hard-disabled
    // (track.enabled=false → silence), so we can't read its level. A dedicated,
    // always-on mic stream lets us measure the candidate's voice even while
    // muted and prompt them to unmute. Local-only: never sent or recorded.
    _startMicMonitor() {
        if (this._micMonitor || this.userRole !== 'candidate') return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;

        // Reuse the existing capture instead of opening a THIRD concurrent
        // getUserMedia. During an answer there were up to three simultaneous mic
        // streams open (this.audioStream + Sarvam's capture + this monitor); iOS
        // Safari and some Android Chrome builds effectively allow one mic
        // consumer, so the extra captures could fail with audio-capture, steal
        // the device, or defeat echo-cancellation (AI voice bleeding into STT).
        //
        // A CLONED track shares the same underlying source — no new device
        // capture, no extra permission — and its enabled state is INDEPENDENT of
        // the original. That last part is essential: the monitor exists to
        // detect the candidate speaking while muted, and muting hard-disables
        // this.audioStream's track (enabled=false → silence). The clone stays
        // enabled, so it keeps reading the mic even while the main track is
        // muted, exactly like the old dedicated stream did.
        const baseTrack = this.audioStream && this.audioStream.getAudioTracks
            ? this.audioStream.getAudioTracks()[0]
            : null;
        const startWith = (stream) => {
            try {
                const ctx = new Ctx();
                const src = ctx.createMediaStreamSource(stream);
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                src.connect(analyser);
                const m = {
                    stream, ctx, src, analyser,
                    data: new Uint8Array(analyser.fftSize),
                    speakingMs: 0, lastPrompt: 0, interval: null,
                };
                m.interval = setInterval(() => this._sampleMicLevel(), 100);
                this._micMonitor = m;
                console.log('[MicMonitor] started');
            } catch (e) {
                console.warn('[MicMonitor] could not start:', e && e.message);
                try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
            }
        };

        if (baseTrack && typeof baseTrack.clone === 'function') {
            try {
                const monitorTrack = baseTrack.clone();
                monitorTrack.enabled = true;   // stay live even while the main track is muted
                startWith(new MediaStream([monitorTrack]));
                return;
            } catch (e) {
                console.warn('[MicMonitor] track clone failed, falling back:', e && e.message);
            }
        }

        // Fallback only when there's no shared stream to clone (e.g. mic never
        // acquired). Opening our own capture here is the old behaviour.
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
            .then(startWith)
            .catch((e) => console.warn('[MicMonitor] could not start:', e && e.message));
    },

    _sampleMicLevel() {
        const m = this._micMonitor;
        if (!m) return;
        try { m.analyser.getByteTimeDomainData(m.data); } catch (_) { return; }
        let sum = 0;
        for (let i = 0; i < m.data.length; i++) { const v = (m.data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / m.data.length);
        const SPEAKING = 0.05;  // tuned for normal speech; ignores quiet room noise

        // Only nudge when the candidate is muted and the AI isn't speaking (so we
        // don't flag the AI's voice bleeding through). The monitor only runs once
        // the candidate is in the call, so no extra "started" gate is needed.
        const shouldWatch = !this.micOn && !this.isPlayingAudio;
        if (!shouldWatch) {
            m.speakingMs = 0;
            if (this.micOn) this._hideMutedPrompt();
            return;
        }
        if (rms > SPEAKING) m.speakingMs += 100;
        else m.speakingMs = Math.max(0, m.speakingMs - 150);

        const now = Date.now();
        if (m.speakingMs >= 400 && (now - m.lastPrompt > 8000)) {
            m.lastPrompt = now;
            this._showMutedPrompt();
        }
    },

    _stopMicMonitor() {
        const m = this._micMonitor;
        if (!m) return;
        try { clearInterval(m.interval); } catch (_) {}
        try { m.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        try { m.ctx.close(); } catch (_) {}
        this._micMonitor = null;
    },

    _showMutedPrompt() {
        const el = document.getElementById('sr-muted-prompt');
        if (!el) return;
        el.classList.remove('hidden');
        clearTimeout(this._mutedPromptTimer);
        this._mutedPromptTimer = setTimeout(() => this._hideMutedPrompt(), 6000);
    },

    _hideMutedPrompt() {
        const el = document.getElementById('sr-muted-prompt');
        if (el) el.classList.add('hidden');
        clearTimeout(this._mutedPromptTimer);
    },

    _unmuteFromPrompt() {
        this.micOn = true;
        this._applyMicState();
        this._hideMutedPrompt();
    },

    toggleCamera() {
        if (!this.cameraStream) {
            this.showToast('Camera is not available');
            return;
        }

        this.cameraOn = !this.cameraOn;
        const btn = document.getElementById('sr-btn-camera');
        if (!btn) return;

        btn.classList.toggle('sr-control-off', !this.cameraOn);
        btn.querySelector('.sr-icon-camera-on')?.classList.toggle('hidden', !this.cameraOn);
        btn.querySelector('.sr-icon-camera-off')?.classList.toggle('hidden', this.cameraOn);

        this.cameraStream.getVideoTracks().forEach(t => { t.enabled = this.cameraOn; });
    },

    async toggleScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
            this.screenSharing = false;
            document.getElementById('sr-btn-screenshare')?.classList.remove('sr-control-active');
            this.attachRemoteStreams();
            // Update peers — remove screen track
            this.replaceScreenTrackInPeers(null);
        } else {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                this.screenStream = stream;
                this.screenSharing = true;
                document.getElementById('sr-btn-screenshare')?.classList.add('sr-control-active');

                stream.getVideoTracks()[0].addEventListener('ended', () => {
                    this.screenStream = null;
                    this.screenSharing = false;
                    document.getElementById('sr-btn-screenshare')?.classList.remove('sr-control-active');
                    this.attachRemoteStreams();
                    this.replaceScreenTrackInPeers(null);
                });

                this.attachRemoteStreams();
                // Add screen track to existing peer connections
                this.replaceScreenTrackInPeers(stream.getVideoTracks()[0]);
            } catch (err) {
                if (err.name !== 'NotAllowedError') {
                    this.showToast('Could not share screen.');
                }
            }
        }
    },

    replaceScreenTrackInPeers(newTrack) {
        for (const peerId of Object.keys(this.peers)) {
            const pc = this.peers[peerId];
            const senders = pc.getSenders();
            // Find the screen share sender (the video sender that isn't from camera)
            const cameraTracks = this.cameraStream ? this.cameraStream.getVideoTracks().map(t => t.id) : [];
            const screenSender = senders.find(s =>
                s.track && s.track.kind === 'video' && !cameraTracks.includes(s.track.id)
            );

            if (screenSender && newTrack) {
                screenSender.replaceTrack(newTrack).catch(e => console.warn('[RTC] Replace screen track failed:', e));
            } else if (newTrack) {
                // Adding a brand new track requires renegotiation
                pc.addTrack(newTrack, this.screenStream);
                this._renegotiate(peerId);
            }
        }
    },

    async _renegotiate(peerId) {
        const pc = this.peers[peerId];
        if (!pc || pc.signalingState === 'closed') return;
        try {
            delete this._remoteDescSet[peerId];
            delete this._pendingCandidates[peerId];
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(peerId, 'offer', { sdp: offer.sdp, type: offer.type });
            console.log('[RTC] Sent renegotiation offer to', peerId);
        } catch (e) {
            console.error('[RTC] Renegotiation failed:', e);
        }
    },

    _replaceAudioTrackInPeers(newTrack) {
        for (const peerId of Object.keys(this.peers)) {
            const pc = this.peers[peerId];
            const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender && newTrack) {
                audioSender.replaceTrack(newTrack).catch(e => console.warn('[RTC] Replace audio track failed:', e));
            }
        }
    },

    /**
     * Leave button handler. Candidates get a clear choice (step out vs submit)
     * with a warning; recruiters keep the simple step-out confirm.
     */
    promptLeave() {
        // Recruiters (and any non-live state) use the plain step-out path.
        if (this.userRole !== 'candidate' || this._interviewEnded || !this.interviewStarted) {
            this.leaveRoom();
            return;
        }
        if (document.getElementById('sr-leave-choice')) return; // already open

        const btnBase = 'width:100%;padding:13px 16px;border-radius:10px;font-size:14.5px;font-weight:600;cursor:pointer;border:1px solid transparent;font-family:inherit;';
        const overlay = document.createElement('div');
        overlay.id = 'sr-leave-choice';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.55);backdrop-filter:blur(2px);';
        overlay.innerHTML = `
          <div role="dialog" aria-modal="true" style="background:#fff;max-width:440px;width:90%;border-radius:16px;padding:26px 26px 24px;box-shadow:0 24px 60px rgba(0,0,0,0.25);font-family:inherit;">
            <h3 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#0f172a;">Leave the interview?</h3>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#475569;">
              You can step out and rejoin while the interview is still in progress.
            </p>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#b91c1c;font-weight:600;">
              Please don't just close the tab. If your interview isn't submitted, it won't be saved and you may not be shortlisted for the next round.
            </p>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button id="sr-leave-submit" style="${btnBase}background:#4f46e5;color:#fff;">Submit &amp; end interview</button>
              <button id="sr-leave-stepout" style="${btnBase}background:#fff;color:#334155;border-color:#cbd5e1;">Step out (I'll rejoin shortly)</button>
              <button id="sr-leave-cancel" style="${btnBase}background:transparent;color:#64748b;">Cancel</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#sr-leave-cancel').onclick = close;
        overlay.querySelector('#sr-leave-stepout').onclick = () => { close(); this.leaveRoom(true); };
        overlay.querySelector('#sr-leave-submit').onclick = () => { close(); this.submitAndEndInterview(); };
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    },

    /**
     * Candidate finishes and submits early. The backend finalizes the interview
     * and broadcasts 'interview-ended', which drives the submission overlay and
     * recording upload (same path as a recruiter-ended interview).
     */
    submitAndEndInterview() {
        if (this._interviewEnded) return;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'end-interview' }));
        }

        this.interviewStarted = false;
        this.stopListening();

        // Prevent double submit via the controls.
        const leaveBtn = document.getElementById('sr-btn-leave');
        if (leaveBtn) { leaveBtn.disabled = true; leaveBtn.style.opacity = '0.5'; }
        this.showToast('Submitting your interview...');
    },

    /**
     * beforeunload guard shown while a candidate's interview is live. Browsers
     * display a generic confirmation, but it still prevents an accidental close.
     */
    _liveUnloadBlock(e) {
        e.preventDefault();
        e.returnValue = "Your interview isn't submitted yet. If you leave now it may not be saved.";
        return e.returnValue;
    },

    _enableExitGuard() {
        if (this.userRole !== 'candidate' || this._exitGuardOn) return;
        this._exitGuardOn = true;
        if (!this._boundLiveUnload) this._boundLiveUnload = this._liveUnloadBlock.bind(this);
        window.addEventListener('beforeunload', this._boundLiveUnload);
    },

    _disableExitGuard() {
        if (!this._exitGuardOn) return;
        this._exitGuardOn = false;
        if (this._boundLiveUnload) window.removeEventListener('beforeunload', this._boundLiveUnload);
    },

    leaveRoom(skipConfirm = false) {
        if (!skipConfirm && !confirm('Leave the meeting? You can rejoin while the interview is still in progress.')) return;

        this._intentionalLeave = true;

        // Stop STT + chunk chain
        this.stopListening();
        this._chunkChainReset();
        this._stopMicMonitor();
        this._hideMutedPrompt();

        // Stop proctoring (will reinit on rejoin)
        if (typeof ScreeningProctor !== 'undefined' && ScreeningProctor._running) {
            ScreeningProctor.stop();
        }
        if (typeof RecruiterProctorOverlay !== 'undefined' && RecruiterProctorOverlay._running) {
            RecruiterProctorOverlay.stop();
        }

        // Stop recorder BEFORE killing media tracks (preserves collected chunks)
        if (typeof ScreeningRecorder !== 'undefined' && ScreeningRecorder.isRecording()) {
            try {
                if (ScreeningRecorder._mediaRecorder && ScreeningRecorder._mediaRecorder.state !== 'inactive') {
                    ScreeningRecorder._mediaRecorder.stop();
                }
                ScreeningRecorder._recording = false;
                console.log(`[Recorder] Paused on leave (${ScreeningRecorder._chunks.length} chunks preserved)`);
            } catch (e) {
                console.warn('[Recorder] Error stopping on leave:', e);
            }
        }

        // Clear all watchdog timers
        if (this._trackWatchdogs) {
            for (const pid of Object.keys(this._trackWatchdogs)) {
                this._clearTrackWatchdog(pid);
            }
        }

        // Close all peer connections
        for (const peerId of Object.keys(this.peers)) {
            this.peers[peerId].close();
        }
        this.peers = {};
        this.remoteStreams = {};
        this._sidePanelFingerprint = null;

        // Close WebSocket
        if (this.ws) { this.ws.close(); this.ws = null; }

        // Stop all media tracks
        if (this.cameraStream) { this.cameraStream.getTracks().forEach(t => t.stop()); this.cameraStream = null; }
        if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
        this.cameraOn = false;
        this.screenSharing = false;

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Notify backend
        fetch(`${this.API_BASE}/api/screening_round/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: this.roomId, participant_id: this.participantId })
        }).catch(() => {});

        // Show rejoin overlay, hide room
        document.getElementById('sr-room')?.classList.add('hidden');
        const overlay = document.getElementById('sr-rejoin-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            if (this._interviewEnded) {
                this._showRejoinEnded(overlay);
            } else {
                // Poll room status to detect if interview ends while on overlay
                this._rejoinPoll = setInterval(async () => {
                    try {
                        await this.refreshRoom();
                        if (!this.roomConfig || this.roomConfig.status === 'ended') {
                            this._interviewEnded = true;
                            clearInterval(this._rejoinPoll);
                            this._showRejoinEnded(overlay);
                        }
                    } catch (e) { /* silent */ }
                }, 5000);
            }
        }
    },

    async rejoinRoom() {
        const overlay = document.getElementById('sr-rejoin-overlay');

        // Check if room still active
        try {
            await this.refreshRoom();
            if (!this.roomConfig || this.roomConfig.status === 'ended') {
                this.showToast('This interview has ended.');
                setTimeout(() => { window.location.href = '/b4kx'; }, 2000);
                return;
            }
        } catch (e) {
            this.showToast('Could not reach server. Please try again.');
            return;
        }

        // Re-acquire camera for candidate
        if (this.userRole === 'candidate') {
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
                this.cameraStream = videoStream;
                this.cameraOn = true;
            } catch (e) {
                this.showToast('Camera access required to rejoin as candidate.');
                return;
            }

            // Re-acquire audio
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioStream = audioStream;
                this.micOn = true;
            } catch (e) {
                console.warn('[Rejoin] Could not get audio:', e);
            }

            // Re-acquire screen share
            if (this.canScreenShare) {
                try {
                    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                    this.screenStream = screenStream;
                    this.screenSharing = true;
                    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
                        this.screenStream = null;
                        this.screenSharing = false;
                        document.getElementById('sr-btn-screenshare')?.classList.remove('sr-control-active');
                        this.attachRemoteStreams();
                        this.replaceScreenTrackInPeers(null);
                    });
                } catch (e) {
                    console.warn('[Rejoin] Screen share skipped:', e);
                }
            }
        } else {
            // Recruiter: no media needed, but try audio for convenience
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioStream = audioStream;
                this.micOn = true;
            } catch (e) { /* recruiter audio optional */ }
        }

        // Re-join the room (get new participant_id)
        try {
            const res = await fetch(`${this.API_BASE}/api/screening_round/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_id: this.roomId, name: this.userName, role: this.userRole })
            });

            if (res.status === 403) {
                this.showToast('This interview has ended. You cannot rejoin.');
                setTimeout(() => { window.location.href = '/b4kx'; }, 2000);
                return;
            }
            if (!res.ok) { this.showToast('Failed to rejoin. Please try again.'); return; }

            const data = await res.json();
            this.participantId = data.participant_id;
        } catch (e) {
            this.showToast('Connection error. Please try again.');
            return;
        }

        // Reset ALL signaling state for clean reconnection
        this._intentionalLeave = false;
        if (this._rejoinPoll) { clearInterval(this._rejoinPoll); this._rejoinPoll = null; }
        this._signalingQueue = [];
        this._signalingBusy = false;
        this._pendingCandidates = {};
        this._remoteDescSet = {};
        this._sidePanelFingerprint = null;  // Force full panel rebuild
        // Clear all watchdog timers from previous connection
        if (this._trackWatchdogs) {
            for (const pid of Object.keys(this._trackWatchdogs)) {
                this._clearTrackWatchdog(pid);
            }
        }
        if (this._peerJoinedFallback) {
            for (const pid of Object.keys(this._peerJoinedFallback)) {
                clearTimeout(this._peerJoinedFallback[pid]);
            }
            this._peerJoinedFallback = {};
        }

        // Hide overlay, show room
        overlay?.classList.add('hidden');
        document.getElementById('sr-room')?.classList.remove('hidden');

        // Re-render layout
        this.renderRoomLayout();
        this.updateParticipantCount();
        this.startTimer(false);  // Don't reset timer on rejoin

        // Reset control button states
        const micBtn = document.getElementById('sr-btn-mic');
        if (micBtn) {
            micBtn.classList.toggle('sr-control-off', !this.micOn);
            micBtn.querySelector('.sr-icon-mic-on')?.classList.toggle('hidden', !this.micOn);
            micBtn.querySelector('.sr-icon-mic-off')?.classList.toggle('hidden', this.micOn);
        }
        const camBtn = document.getElementById('sr-btn-camera');
        if (camBtn) {
            camBtn.classList.toggle('sr-control-off', !this.cameraOn);
            camBtn.querySelector('.sr-icon-camera-on')?.classList.toggle('hidden', !this.cameraOn);
            camBtn.querySelector('.sr-icon-camera-off')?.classList.toggle('hidden', this.cameraOn);
        }
        if (this.screenSharing) {
            document.getElementById('sr-btn-screenshare')?.classList.add('sr-control-active');
        }

        // Re-enable end/leave buttons
        const endBtn = document.getElementById('sr-btn-end');
        if (endBtn) { endBtn.disabled = false; endBtn.style.opacity = '1'; }
        const leaveBtn = document.getElementById('sr-btn-leave');
        if (leaveBtn) { leaveBtn.disabled = false; }

        // Re-fetch ICE servers (TURN credentials may have expired)
        await this.fetchIceServers();

        // Reconnect WebSocket signaling — this triggers existing-peers → createPeerAndOffer
        this.connectSignaling();
    },

    _showRejoinEnded(overlay) {
        const card = overlay.querySelector('.sr-rejoin-card');
        if (card) card.classList.add('sr-rejoin-ended');
        const title = overlay.querySelector('.sr-rejoin-title');
        if (title) title.textContent = 'Interview has ended';
        const subtitle = overlay.querySelector('.sr-rejoin-subtitle');
        if (subtitle) subtitle.textContent = 'The interview session has ended. You can no longer rejoin.';
    },

    endInterview() {
        if (!confirm('End this interview session?')) return;

        // Send end-interview signal to backend to stop AI agents
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'end-interview' }));
        }

        // DON'T redirect immediately — wait for feedback pipeline
        // The interview-ended WS message will handle the UI state
        this.interviewStarted = false;
        this.stopListening();

        // Disable end button to prevent double-click
        const endBtn = document.getElementById('sr-btn-end');
        if (endBtn) { endBtn.disabled = true; endBtn.textContent = 'Ending...'; }
    },

    /**
     * Show the fullscreen submission overlay for candidates when interview ends.
     * Manages step progress, recording upload, and transition to thank-you screen.
     */
    showSubmissionOverlay() {
        const overlay = document.getElementById('sr-submit-overlay');
        if (!overlay) return;

        // Show overlay — covers the entire room
        overlay.classList.remove('hidden');

        // Prevent accidental window close during submission
        window.addEventListener('beforeunload', this._beforeUnloadBlock);

        // Start elapsed timer
        let elapsed = 0;
        const timerEl = document.getElementById('sr-submit-timer');
        const timerInterval = setInterval(() => {
            elapsed++;
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            if (timerEl) timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }, 1000);

        // Step references
        const stepFinalize = document.getElementById('sr-step-finalize');
        const stepRecording = document.getElementById('sr-step-recording');
        const stepProctor = document.getElementById('sr-step-proctor');

        const markDone = (stepEl) => {
            if (!stepEl) return;
            const icon = stepEl.querySelector('.sr-submit-step-icon');
            if (icon) { icon.classList.remove('sr-step-active', 'sr-step-pending'); icon.classList.add('sr-step-done'); }
        };
        const markActive = (stepEl) => {
            if (!stepEl) return;
            const icon = stepEl.querySelector('.sr-submit-step-icon');
            if (icon) { icon.classList.remove('sr-step-pending', 'sr-step-done'); icon.classList.add('sr-step-active'); }
        };

        // Step 1: Finalize session (already done — interview just ended)
        setTimeout(() => {
            markDone(stepFinalize);
            markActive(stepRecording);
        }, 800);

        // Step 2: Wait for recording upload
        const waitForRecording = () => {
            return new Promise((resolve) => {
                const check = () => {
                    const uploadPromise = this._recordingUpload ||
                        (typeof ScreeningRecorder !== 'undefined' && ScreeningRecorder._uploadPromise);
                    if (uploadPromise) {
                        uploadPromise.then(() => resolve()).catch(() => resolve());
                    } else {
                        // No recording — resolve after short delay
                        setTimeout(resolve, 1000);
                    }
                };
                // Small delay to let stopAndUpload promise get assigned
                setTimeout(check, 600);
            });
        };

        // Step 3: Proctor data (already sent via WebSocket in interview-ended handler)
        const waitForProctor = () => {
            return new Promise(resolve => setTimeout(resolve, 500));
        };

        // Run the pipeline
        (async () => {
            // Wait for recording upload
            await waitForRecording();
            markDone(stepRecording);
            markActive(stepProctor);

            // Wait for proctor data
            await waitForProctor();
            markDone(stepProctor);

            // Small pause before showing thank-you
            await new Promise(r => setTimeout(r, 600));

            // Stop timer
            clearInterval(timerInterval);

            // Transition to thank-you stage
            const submittingStage = document.getElementById('sr-submit-stage-submitting');
            const doneStage = document.getElementById('sr-submit-stage-done');
            if (submittingStage) submittingStage.classList.add('hidden');
            if (doneStage) doneStage.classList.remove('hidden');

            // Countdown and redirect
            let countdown = 5;
            const countdownEl = document.getElementById('sr-submit-countdown');
            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdownEl) countdownEl.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                    window.removeEventListener('beforeunload', this._beforeUnloadBlock);
                    this.cleanupAndRedirect('/b4kx');
                }
            }, 1000);
        })();
    },

    _beforeUnloadBlock(e) {
        e.preventDefault();
        e.returnValue = 'Your interview is being submitted. Are you sure you want to leave?';
        return e.returnValue;
    },

    handleAutoClose() {
        // Fallback for non-candidate or cases where overlay isn't available
        if (this.userRole === 'candidate') {
            // Try the overlay first
            if (document.getElementById('sr-submit-overlay')) {
                this.showSubmissionOverlay();
                return;
            }
        }

        // Disable chat input
        const input = document.getElementById('sr-chat-input');
        const sendBtn = document.getElementById('sr-chat-send-btn');
        if (input) { input.disabled = true; input.placeholder = 'Interview has ended'; }
        if (sendBtn) sendBtn.disabled = true;

        if (this.userRole === 'candidate') {
            const waitAndRedirect = () => {
                const uploadPromise = this._recordingUpload ||
                    (typeof ScreeningRecorder !== 'undefined' && ScreeningRecorder._uploadPromise);
                if (uploadPromise) {
                    uploadPromise.then(() => {
                        this._autoCloseTimer = setTimeout(() => this.cleanupAndRedirect(), 2000);
                    }).catch(() => {
                        this._autoCloseTimer = setTimeout(() => this.cleanupAndRedirect(), 2000);
                    });
                } else {
                    this._autoCloseTimer = setTimeout(() => this.cleanupAndRedirect(), 5000);
                }
            };
            setTimeout(waitAndRedirect, 500);
        }
    },

    cleanupAndRedirect(redirectUrl) {
        this.stopListening();

        // Stop proctoring if still running
        if (typeof ScreeningProctor !== 'undefined' && ScreeningProctor._running) {
            ScreeningProctor.stop();
        }
        if (typeof RecruiterProctorOverlay !== 'undefined' && RecruiterProctorOverlay._running) {
            RecruiterProctorOverlay.stop();
        }

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Close all peer connections
        for (const peerId of Object.keys(this.peers)) {
            this.peers[peerId].close();
        }
        this.peers = {};
        this.remoteStreams = {};

        // Close WebSocket
        if (this.ws) { this.ws.close(); this.ws = null; }

        // Stop all media
        if (this.cameraStream) { this.cameraStream.getTracks().forEach(t => t.stop()); this.cameraStream = null; }
        if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }

        fetch(`${this.API_BASE}/api/screening_round/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: this.roomId, participant_id: this.participantId })
        }).catch(() => {});

        setTimeout(() => { window.location.href = redirectUrl || '/b4kx'; }, 1200);
    },

    // ==================== PARTICIPANT COUNT ====================

    updateParticipantCount() {
        const el = document.getElementById('sr-participant-count-text');
        if (!el) return;

        const config = this.roomConfig.config || {};
        const agentCount = (config.selectedAgents || []).length;
        const humanCount = (this.roomConfig.participants || []).length;
        el.textContent = agentCount + humanCount;
    },

    // ==================== EVENTS ====================

    bindEvents() {
        document.getElementById('sr-join-candidate-btn')?.addEventListener('click', () => this.joinRoom('candidate'));
        document.getElementById('sr-join-recruiter-btn')?.addEventListener('click', () => this.joinRoom('recruiter'));

        document.getElementById('sr-candidate-name')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.joinRoom('candidate'); }
        });

        document.getElementById('sr-candidate-name')?.addEventListener('input', () => this.updateReadiness());

        // Pre-join media buttons
        document.getElementById('sr-prejoin-camera-btn')?.addEventListener('click', () => this.enableCamera());
        document.getElementById('sr-prejoin-screen-btn')?.addEventListener('click', () => this.shareScreen());

        // "You're muted" prompt actions
        document.getElementById('sr-muted-prompt-unmute')?.addEventListener('click', () => this._unmuteFromPrompt());
        document.getElementById('sr-muted-prompt-close')?.addEventListener('click', () => this._hideMutedPrompt());
        window.addEventListener('beforeunload', () => this._stopMicMonitor());

        // Room controls
        document.getElementById('sr-btn-mic')?.addEventListener('click', () => this.toggleMic());
        document.getElementById('sr-btn-camera')?.addEventListener('click', () => this.toggleCamera());
        document.getElementById('sr-btn-screenshare')?.addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('sr-btn-chat')?.addEventListener('click', () => this.toggleChat());
        document.getElementById('sr-btn-leave')?.addEventListener('click', () => this.promptLeave());
        document.getElementById('sr-btn-end')?.addEventListener('click', () => this.endInterview());
        document.getElementById('sr-rejoin-btn')?.addEventListener('click', () => this.rejoinRoom());

        // Chat input
        document.getElementById('sr-chat-send-btn')?.addEventListener('click', () => this.sendChatMessage());
        document.getElementById('sr-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });

        // Auto-resize textarea. We also keep sttBuffer in sync with whatever's
        // in the input so manual edits aren't clobbered by the next STT result.
        const chatInput = document.getElementById('sr-chat-input');
        if (chatInput) {
            chatInput.addEventListener('input', () => {
                chatInput.style.height = 'auto';
                chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
                if (!this._suppressInputEvent) {
                    this.sttBuffer = chatInput.value;
                    // Manual typing also extends the silence window so the
                    // candidate isn't auto-submitted while still composing.
                    this._resetSilenceTimer();
                }
            });
            // Track explicit keystrokes only. The `input` event can fire
            // spuriously from programmatic updates / autofill / spell-check
            // and was wrongly tripping a flag that blocked STT from writing
            // text into the textarea.
            chatInput.addEventListener('keydown', (e) => {
                if (e.key && e.key.length === 1) {
                    this._userTypedThisTurn = true;
                }
            });
        }

    },

    // ==================== SPEECH-TO-TEXT (Cross-Browser) ====================

    initSpeechRecognition() {
        // Detect browser for STT strategy
        const ua = navigator.userAgent;
        this._isSafari = /^((?!chrome|android).)*safari/i.test(ua);
        this._isFirefox = /firefox/i.test(ua);
        this._isChromeMobile = /android.*chrome/i.test(ua) || (/crios/i.test(ua));
        this._isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

        // Prefer Sarvam (Saaras v3 streaming) over the browser's Web Speech API.
        // Sarvam works in Firefox too, handles Hinglish natively via codemix
        // mode, and keeps the API key server-side. The browser path is kept as
        // a fallback for the rare case where Sarvam can't be initialized.
        const SarvamCtor = (window.sarvamSttSupported && window.SarvamSpeechRecognition)
            ? window.SarvamSpeechRecognition : null;
        const BrowserCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        const SpeechRecognition = SarvamCtor || BrowserCtor;
        this._sttProvider = SarvamCtor ? 'sarvam' : (BrowserCtor ? 'web-speech' : null);
        console.log('[STT] provider:', this._sttProvider);

        if (!SpeechRecognition) {
            console.warn('[STT] Speech recognition not supported in this browser');
            this.sttSupported = false;
            if (this._isFirefox) {
                this._showSttFallbackHint('Firefox does not support voice input. Please type your responses or use Chrome/Edge.');
            } else {
                this._showSttFallbackHint('Voice input is not available in this browser. Please type your responses.');
            }
            return;
        }

        if (!this._isSecureContext) {
            console.warn('[STT] Not a secure context — speech recognition requires HTTPS');
            this.sttSupported = false;
            this._showSttFallbackHint('Voice input requires HTTPS. Please type your responses.');
            return;
        }

        this.sttSupported = true;
        this._sttActive = false;
        this._sttRestartTimer = null;
        this._sttWatchdog = null;
        this._sttFailCount = 0;
        // Effectively unbounded — any successful onresult resets the counter,
        // so the only way to hit this ceiling is sustained hard failure (denied
        // permission / no mic). Network blips and recognition session cycles
        // should never starve the candidate's STT.
        this._sttMaxFails = 9999;
        this._sttNetworkFails = 0;
        this._lastInterim = '';
        this._SpeechRecognition = SpeechRecognition;

        this._createRecognition(SpeechRecognition);
        this._sttWarmedUp = false;

        // Pre-request microphone permission so it's ready when interview starts
        // This prevents the permission dialog from interrupting the interview flow
        this._ensureMicPermission();
    },

    async _ensureMicPermission() {
        try {
            // Check if permission is already granted
            if (navigator.permissions) {
                const result = await navigator.permissions.query({ name: 'microphone' });
                if (result.state === 'granted') {
                    console.log('[STT] Mic permission already granted');
                    return;
                }
            }
            // If we already have an audioStream from camera setup, mic is available
            if (this.audioStream) {
                console.log('[STT] Mic available via existing audio stream');
                return;
            }
            // Request mic access early (will prompt user if needed)
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // If we don't have an audioStream yet, keep this one
            if (!this.audioStream) {
                this.audioStream = stream;
                console.log('[STT] Acquired mic stream for STT');
            } else {
                // Already have audio, release this one
                stream.getTracks().forEach(t => t.stop());
            }
        } catch (e) {
            console.warn('[STT] Could not pre-acquire mic:', e.message);
            // Don't disable STT — SpeechRecognition may still work with its own mic request
        }
    },

    /**
     * Pre-warm the STT engine by starting and immediately stopping a SEPARATE
     * recognition instance. This forces the browser to initialize the speech
     * service, acquire mic access, and connect to Google speech servers BEFORE
     * the candidate needs to speak. Without this, the first .start() has a
     * 1-3s cold-start delay while the browser establishes the connection.
     *
     * Uses a separate instance so the main this.recognition is never touched.
     */
    _prewarmSTT() {
        if (!this.sttSupported || !this._SpeechRecognition || this._sttWarmedUp) return;
        // Sarvam has no Google-style cold start — the WS opens in ~100-300ms
        // once start() is called. Running a fake start/stop cycle here would
        // just churn the mic + open a useless upstream session. Skip it.
        if (this._sttProvider === 'sarvam') {
            this._sttWarmedUp = true;
            console.log('[STT] Sarvam: skipping prewarm (not needed).');
            return;
        }
        try {
            console.log('[STT] Pre-warming speech engine...');
            const warmup = new this._SpeechRecognition();
            warmup.lang = 'en-IN';
            warmup.continuous = false;
            warmup.interimResults = false;
            warmup.onstart = () => {
                this._sttWarmedUp = true;
                console.log('[STT] Pre-warm connected — stopping to release');
                try { warmup.stop(); } catch (e) {}
            };
            warmup.onend = () => {
                console.log('[STT] Pre-warm complete — engine is hot');
            };
            warmup.onerror = (e) => {
                if (e.error !== 'no-speech' && e.error !== 'aborted') {
                    console.warn('[STT] Pre-warm error:', e.error);
                }
            };
            warmup.onresult = () => {};
            warmup.start();
        } catch (e) {
            console.warn('[STT] Pre-warm failed:', e.message);
        }
    },

    _createRecognition(SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'en-IN';
        // 3 alternatives instead of 1 — primary is still [0] (spec sorts by
        // confidence descending), but the extras let us log ambiguity and
        // give us a way to detect low-confidence runs.
        this.recognition.maxAlternatives = 3;

        if (this._isSafari) {
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            console.log('[STT] Safari mode: non-continuous, finals only');
        } else {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
        }

        // Contextual biasing (Chrome 142+): feed tech-interview vocabulary
        // to the recognizer so it leans toward those phrases instead of
        // phonetically-similar everyday words ("javascript" wins over
        // "java scripts", "Node.js" wins over "node yes", etc.). Boost 5.0
        // is the MDN example default; range is 0-10.
        try {
            const PhraseCtor = window.SpeechRecognitionPhrase
                            || window.webkitSpeechRecognitionPhrase;
            if (PhraseCtor && 'phrases' in this.recognition) {
                this.recognition.phrases = this._STT_BIAS_PHRASES.map(
                    (p) => new PhraseCtor(p, 5.0)
                );
                console.log('[STT] Contextual biasing applied:',
                            this._STT_BIAS_PHRASES.length, 'phrases');
            } else {
                console.log('[STT] SpeechRecognitionPhrase not supported — relying on post-processing only');
            }
        } catch (e) {
            console.warn('[STT] Phrase biasing setup failed:', e && e.message);
        }

        // Mic-energy stream (Sarvam STT only). Drives the live "listening" cue and
        // the auto-submit watchdog off real speech, independent of transcript lag.
        if ('onaudio' in this.recognition) {
            this.recognition.onaudio = (rms) => this._onMicAudio(rms);
        }

        this.recognition.onstart = () => {
            this._sttActive = true;
            this._sttFailCount = 0;
            this._sttNetworkFails = 0;
            this._lastInterim = '';
            console.log('[STT] Recognition started successfully');
            // Show active indicator
            const indicator = document.getElementById('sr-stt-indicator');
            if (indicator && this.isListening) {
                indicator.classList.remove('hidden', 'sr-stt-warning');
                indicator.innerHTML = '<div class="sr-stt-pulse"></div><span>Listening...</span>';
            }
        };

        this.recognition.onresult = (event) => {
            // Drop any in-flight result that arrives in the ~1.2s window
            // after Send — those are the words the candidate just submitted,
            // still being finalised by the speech service. Without this
            // guard they re-populate the cleared textarea ("ghost text").
            if (this._postSendGuardUntil && Date.now() < this._postSendGuardUntil) {
                console.log('[STT] discarding post-send in-flight result');
                return;
            }

            // Any incoming transcription proves the session is healthy — clear
            // accumulated error counters so transient network blips earlier in
            // the session don't eventually starve the watchdog.
            this._sttFailCount = 0;
            this._sttNetworkFails = 0;

            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript;
                if (result.isFinal) {
                    finalTranscript += transcript;
                    // Diagnostic: log the n-best alternatives + confidence
                    // so we can tune phrase bias / corrections from real
                    // user transcripts when something still mis-recognizes.
                    if (result.length > 1) {
                        const alts = [];
                        for (let j = 0; j < result.length; j++) {
                            const c = (result[j].confidence || 0).toFixed(2);
                            alts.push(`"${result[j].transcript}"@${c}`);
                        }
                        console.log('[STT] alternatives:', alts.join('  |  '));
                    }
                } else {
                    interimTranscript += transcript;
                }
            }

            this._lastInterim = interimTranscript;

            const input = document.getElementById('sr-chat-input');
            if (input) {
                this._suppressInputEvent = true;
                if (finalTranscript) {
                    this.sttBuffer += finalTranscript + ' ';
                    this._lastInterim = '';
                    // Apply domain corrections to the accumulated buffer so
                    // the textarea shows tech terms with proper spelling in
                    // real time (only after a final lands; interim stays raw
                    // to avoid flicker). _autocorrect runs again at send.
                    this.sttBuffer = this._applySTTCorrections(this.sttBuffer);
                }
                input.value = this._joinAccumulatorAndTail(interimTranscript);
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                this._suppressInputEvent = false;
                console.log('[STT] result:', { finalTranscript, interimTranscript, sttBuffer: this.sttBuffer });
            }

            // Any speech (interim OR final) restarts the 8s silence
            // countdown. The auto-submit fires only when the candidate
            // has been silent past the window AND there's buffered text.
            this._resetSilenceTimer();
        };

        this.recognition.onerror = (event) => {
            this._sttActive = false;
            const error = event.error;

            if (error === 'not-allowed') {
                console.error('[STT] Microphone permission denied');
                this.showToast('Microphone access denied. Please allow microphone and reload.');
                this.isListening = false;
                this._showSttFallbackHint('Microphone blocked. Allow mic access in browser settings and reload.');
                return;
            }

            if (error === 'network') {
                this._sttNetworkFails++;
                this._sttFailCount++;
                console.warn(`[STT] Network error (${this._sttNetworkFails})`);
                // Network errors are common on localhost — keep retrying with backoff
                if (this._sttNetworkFails >= 20) {
                    console.error('[STT] Persistent network errors — speech servers unreachable');
                    this.isListening = false;
                    this._showSttFallbackHint('Voice input unavailable (cannot reach speech servers). Please type your responses.');
                    return;
                }
                // Exponential backoff: 500ms, 1s, 2s, 4s, capped at 5s
                const backoff = Math.min(500 * Math.pow(1.5, this._sttNetworkFails - 1), 5000);
                if (this.isListening) {
                    this._scheduleRestart(backoff);
                }
                return;
            }

            if (error === 'service-not-allowed' || error === 'language-not-supported') {
                console.error('[STT] Service not available:', error);
                this.isListening = false;
                this._showSttFallbackHint('Voice input is not available on this device. Please type your responses.');
                return;
            }

            if (error === 'audio-capture') {
                console.error('[STT] No microphone found or mic in use by another app');
                this._sttFailCount++;
                if (this._sttFailCount >= 5) {
                    this._showSttFallbackHint('Microphone not available. Please check your mic and reload, or type your responses.');
                    return;
                }
            }

            if (error !== 'no-speech' && error !== 'aborted') {
                console.warn('[STT] Error:', error);
                this._sttFailCount++;
            }

            if (this.isListening && this._sttFailCount < this._sttMaxFails) {
                this._scheduleRestart(0);
            }
        };

        this.recognition.onend = () => {
            this._sttActive = false;

            // Rescue unfinalised interim transcript (Chrome kills recognition after ~60s)
            if (this._lastInterim) {
                this.sttBuffer += this._lastInterim + ' ';
                this._lastInterim = '';
                const input = document.getElementById('sr-chat-input');
                if (input) {
                    this._suppressInputEvent = true;
                    input.value = this._joinAccumulatorAndTail('');
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                    this._suppressInputEvent = false;
                }
                console.log('[STT] Rescued interim on end.');
            }

            // Auto-restart immediately. The mic is hard-muted via
            // _applyMicState while TTS plays, so it's safe to restart STT even
            // mid-TTS — the moment the mic comes back, recognition is already
            // listening, eliminating any gap in capture.
            if (this.isListening && this._sttFailCount < this._sttMaxFails) {
                this._scheduleRestart(0);
            }
        };
    },

    _showSttFallbackHint(message) {
        const indicator = document.getElementById('sr-stt-indicator');
        if (indicator) {
            indicator.classList.remove('hidden');
            indicator.classList.add('sr-stt-warning');
            indicator.innerHTML = '<div class="sr-stt-pulse"></div><span>' + message + '</span>';
        }
        this.showToast(message);
    },

    _scheduleRestart(delayMs) {
        if (this._sttRestartTimer) clearTimeout(this._sttRestartTimer);
        this._sttRestartTimer = setTimeout(() => {
            this._sttRestartTimer = null;
            // Never spin up a recognition session while the AI is speaking — a
            // restart that raced TTS would transcribe the AI's own voice. (In the
            // normal flow stopListening already sets isListening=false during TTS,
            // so this is belt-and-braces.)
            if (this.isListening && !this._sttActive && !this.isPlayingAudio) {
                // Reuse the same resilient start path the mic-on tap uses.
                this._safeStartRecognition(0);
            }
        }, delayMs);
    },

    _startSttWatchdog() {
        this._stopSttWatchdog();
        // 500ms is fine for Web Speech (sync start), but Sarvam's async startup
        // (mic + worklet + WS) takes 300-800ms. A 500ms watchdog would fire
        // mid-startup and throw InvalidStateError every cycle. Use a slower
        // interval for Sarvam.
        const interval = this._sttProvider === 'sarvam' ? 2000 : 500;
        this._sttWatchdog = setInterval(() => {
            if (this.isListening && !this._sttActive
                && !this.isPlayingAudio
                && this._sttFailCount < this._sttMaxFails) {
                console.log('[STT] Watchdog: restarting dead recognition');
                this._scheduleRestart(0);
            }
        }, interval);
    },

    _stopSttWatchdog() {
        if (this._sttWatchdog) {
            clearInterval(this._sttWatchdog);
            this._sttWatchdog = null;
        }
    },

    /**
     * Resilient start: handles the most common Web Speech state-race where
     * tap-off → tap-on triggers InvalidStateError because the previous
     * session hasn't finished closing yet. Retries with backoff and falls
     * back to recreating the recognition object if abort()+wait isn't enough.
     */
    startListening() {
        if (!this.sttSupported || !this.recognition) {
            console.warn('[STT] startListening called but STT not supported/initialized');
            return;
        }
        if (this.userRole !== 'candidate') return;
        if (this.isListening && this._sttActive) {
            console.log('[STT] already running, skip');
            return;
        }

        this.isListening = true;
        this._sttFailCount = 0;
        this._sttNetworkFails = 0;

        // Sync sttBuffer with current input
        const input = document.getElementById('sr-chat-input');
        if (input) this.sttBuffer = input.value;

        this._startSttWatchdog();

        // Show STT indicator
        const indicator = document.getElementById('sr-stt-indicator');
        if (indicator) {
            indicator.classList.remove('hidden', 'sr-stt-warning');
            indicator.innerHTML = '<div class="sr-stt-pulse"></div><span>Listening...</span>';
        }

        this._safeStartRecognition(0);
    },

    /**
     * Attempts recognition.start(). On InvalidStateError (prior session
     * still finalising), aborts and retries with backoff up to 4 times.
     * One single user tap is enough — no more "tap 2-3 times to wake it up".
     */
    _safeStartRecognition(attempt) {
        if (!this.isListening) return; // user tapped off in the meantime
        if (!this.recognition) return;
        if (this._sttActive) return;   // onstart already fired

        try {
            this.recognition.start();
            console.log('[STT] start() ok (attempt', attempt + 1, ')');
        } catch (e) {
            console.warn('[STT] start() attempt', attempt + 1, 'threw:', e.name, e.message);

            // Force-cleanup the previous session and retry.
            if (e.name === 'InvalidStateError') {
                // Sarvam's start() is async; an InvalidStateError just means
                // the previous session is still acquiring mic/WS (~50-500ms).
                // Calling abort() here would tear down the AudioContext mid-
                // await and corrupt the AudioWorklet registration on the
                // next session. Just wait longer for Sarvam.
                if (this._sttProvider !== 'sarvam') {
                    try { this.recognition.abort(); } catch (_) {}
                }

                if (attempt >= 4) {
                    // Last resort: recreate the recognition object.
                    console.warn('[STT] recreating recognition after', attempt + 1, 'failures');
                    if (this._SpeechRecognition) {
                        this._createRecognition(this._SpeechRecognition);
                    }
                }
                // Sarvam needs more time for the in-flight async to settle,
                // and we don't want the watchdog hammering it every 500ms.
                const baseDelay = this._sttProvider === 'sarvam' ? 600 : 150;
                const delay = Math.min(baseDelay * (attempt + 1), 2400);
                setTimeout(() => this._safeStartRecognition(attempt + 1), delay);
                return;
            }

            // Non-state error — fall through to the watchdog / onerror retry path.
        }
    },

    stopListening() {
        if (!this.recognition) return;

        this.isListening = false;
        this._stopSttWatchdog();

        if (this._sttRestartTimer) {
            clearTimeout(this._sttRestartTimer);
            this._sttRestartTimer = null;
        }

        // Always force-stop with abort(), regardless of _sttActive.
        // - Gating on _sttActive missed the start()->onstart in-flight
        //   window (~50-100ms), so a quick tap-on-then-tap-off could leak
        //   STT staying alive after the user toggled mic off.
        // - abort() is more forceful than stop(): it discards the
        //   in-flight utterance instead of waiting for it to finalise.
        //   onend still fires, which rescues any _lastInterim into the
        //   buffer, so the candidate doesn't lose their last words.
        try { this.recognition.abort(); } catch (_) {}

        const indicator = document.getElementById('sr-stt-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.classList.remove('sr-stt-warning');
        }
    },

    // ==================== STT helpers (Web Speech only) ====================

    /** Returns the textarea-ready text — sttBuffer (final words seen so far)
     *  plus any current interim. Whisper accumulator was removed. */
    _joinAccumulatorAndTail(extraInterim) {
        return ((this.sttBuffer || '') + (extraInterim || '')).trim();
    },

    // No-op stubs preserved so older call sites compile harmlessly.
    _setupVad()         {},
    _teardownVad()      {},
    _chunkChainStart()  {},
    _chunkChainStop()   { return Promise.resolve(this._joinAccumulatorAndTail('')); },
    _chunkChainReset()  {},
    _turnStartRecording() {},
    _turnStopAndFlush()   { return Promise.resolve(null); },

    _pickRecorderMime() {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/mpeg',
        ];
        for (const m of candidates) {
            try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
        }
        return '';
    },

    _turnHasUsableStream() {
        if (!this.audioStream) return false;
        const tracks = this.audioStream.getAudioTracks();
        return tracks.length > 0 && tracks[0].readyState === 'live';
    },

    // ==================== INTERVIEW CHAT ====================

    sendCandidateReady() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'candidate-ready' }));
            console.log('[Interview] Sent candidate-ready');
        }
    },

    // ==================== AUTO-SUBMIT ON SILENCE ====================

    /** Apply the _STT_PHRASE_CORRECTIONS regex dictionary to a string.
     *  Used by both onresult (live textarea polish) and _autocorrect
     *  (final pass before WS send), so the candidate sees the corrected
     *  text in the input AND the agents receive it cleaned up. */
    _applySTTCorrections(text) {
        if (!text) return text;
        let s = text;
        for (const [pattern, replacement] of this._STT_PHRASE_CORRECTIONS) {
            s = s.replace(pattern, replacement);
        }
        return s;
    },

    /** Light cleanup applied to the candidate's response before it ships.
     *  Runs the domain corrections first, then trims, collapses runs of
     *  whitespace, capitalises the first letter of each sentence, and
     *  adds a terminal period if the candidate's speech tailed off without
     *  one. Web Speech's final results already carry Chrome's
     *  auto-correction; this is the cosmetic + domain last mile. */
    _autocorrect(raw) {
        let s = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!s) return s;
        // Domain corrections (tech vocab) before any other shaping — order
        // matters since corrections can change the first character / casing.
        s = this._applySTTCorrections(s);
        // Capitalise the very first character.
        s = s.charAt(0).toUpperCase() + s.slice(1);
        // Capitalise after sentence-ending punctuation.
        s = s.replace(/([.!?])\s+([a-z])/g, (_m, p, c) => p + ' ' + c.toUpperCase());
        // Add a trailing period if it ends mid-thought without punctuation.
        if (!/[.!?…]$/.test(s)) s += '.';
        return s;
    },

    /** Called ~5x/sec with the live mic RMS from the Sarvam STT client. While the
     *  candidate is audibly speaking we keep re-arming the silence watchdog, so it
     *  can NEVER fire mid-answer just because Sarvam's transcript is lagging behind
     *  the speech. We also show an immediate "listening" cue so the candidate knows
     *  their voice is being captured even before the text appears. */
    _onMicAudio(rms) {
        if (this.userRole !== 'candidate') return;
        if (this.isPlayingAudio) return;        // agent is talking; mic is muted
        if (!(rms > this._SPEECH_RMS)) return;  // background noise / silence — ignore

        this._lastSpeechTs = Date.now();
        // Live capture cue (throttled): reassure the candidate while they speak.
        const indicator = document.getElementById('sr-stt-indicator');
        if (indicator && this.isListening && indicator.classList.contains('hidden') === false) {
            // keep it showing the active listening state
            if (indicator.dataset.state !== 'hearing') {
                indicator.dataset.state = 'hearing';
                indicator.classList.remove('sr-stt-warning');
                indicator.innerHTML = '<div class="sr-stt-pulse"></div><span>Listening...</span>';
            }
        }
        // Audible speech re-arms the full silence window AND cancels any countdown
        // that may have started during a brief pause.
        this._resetSilenceTimer();
    },

    /** (Re)arm the silence watchdog. Fires sendChatMessage once the
     *  candidate has been silent for _AUTO_SUBMIT_SILENCE_MS, provided
     *  there's actually buffered text worth shipping and the agent isn't
     *  the one currently talking. Safe to call repeatedly — each call
     *  resets the countdown. */
    _resetSilenceTimer() {
        this._clearSilenceTimer();
        if (this.userRole !== 'candidate') return;
        if (this.isPlayingAudio) return;          // agent's turn — don't tick
        const input = document.getElementById('sr-chat-input');
        const hasText = (this.sttBuffer && this.sttBuffer.trim().length > 0)
                     || (input && input.value && input.value.trim().length > 0);
        if (!hasText) return;
        this._silenceTimer = setTimeout(() => {
            this._silenceTimer = null;
            // Recheck — agent may have started speaking inside the window.
            if (this.isPlayingAudio) return;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            const stillHasText = (this.sttBuffer && this.sttBuffer.trim().length > 0)
                              || ((document.getElementById('sr-chat-input')?.value || '').trim().length > 0);
            if (!stillHasText) return;
            console.log('[STT] silence window elapsed — starting submit countdown');
            this._beginAutoSubmitGrace();
        }, this._AUTO_SUBMIT_SILENCE_MS);
    },

    /** After the silence window, count down visibly before sending. Any new
     *  speech or keystroke routes through _resetSilenceTimer -> _clearSilenceTimer,
     *  which cancels this countdown and re-arms the full silence window, so a
     *  candidate who simply paused mid-answer is never cut off. */
    _beginAutoSubmitGrace() {
        if (this.isPlayingAudio) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const hasText = (this.sttBuffer && this.sttBuffer.trim().length > 0)
                     || ((document.getElementById('sr-chat-input')?.value || '').trim().length > 0);
        if (!hasText) return;

        this._clearAutoSubmitGrace();
        let remaining = this._AUTO_SUBMIT_GRACE_SECS;
        const tick = () => {
            this._graceTimer = null;
            if (this.isPlayingAudio) { return; }   // agent took over
            if (remaining <= 0) {
                this.updateChatStatus('Your turn to respond', 'live');
                this.sendChatMessage();
                return;
            }
            this.updateChatStatus(
                'Submitting your answer in ' + remaining + '… keep talking to continue', 'live');
            remaining -= 1;
            this._graceTimer = setTimeout(tick, 1000);
        };
        tick();
    },

    _clearAutoSubmitGrace() {
        if (this._graceTimer) {
            clearTimeout(this._graceTimer);
            this._graceTimer = null;
            // A countdown was visibly running and got cancelled (candidate resumed)
            // — clear the "Submitting in N…" note.
            if (this.userRole === 'candidate' && !this.isPlayingAudio) {
                this.updateChatStatus('Your turn to respond', 'live');
            }
        }
    },

    _clearSilenceTimer() {
        if (this._silenceTimer) {
            clearTimeout(this._silenceTimer);
            this._silenceTimer = null;
        }
        // New speech/typing or a manual send must also kill any visible countdown.
        this._clearAutoSubmitGrace();
    },

    sendChatMessage() {
        const input = document.getElementById('sr-chat-input');
        if (!input) return;

        // Whether ship is manual or auto-triggered, the countdown is done.
        this._clearSilenceTimer();

        // Ship any unfinalised interim — Chrome holds the last few hundred
        // milliseconds in interim until the next final result.
        if (this._lastInterim) {
            this.sttBuffer += this._lastInterim + ' ';
            this._lastInterim = '';
        }
        const rawText = (this.sttBuffer || input.value).trim();
        if (!rawText) return;
        const text = this._autocorrect(rawText);

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.showToast('Connection lost. Please rejoin.');
            return;
        }

        // Ship it instantly — no transcription round-trip.
        this.ws.send(JSON.stringify({ type: 'candidate-response', text }));
        this.addCandidateMessage(this.userName, text);

        // Reset for the next turn.
        this._suppressInputEvent = true;
        input.value = '';
        input.style.height = 'auto';
        this._suppressInputEvent = false;
        this.sttBuffer = '';
        this._lastInterim = '';
        this._userTypedThisTurn = false;

        // Web Speech holds the just-spoken phrase in flight for a few hundred
        // ms after we send. Drop any onresult that lands in this window so
        // the textarea stays empty until the candidate speaks the next turn.
        this._postSendGuardUntil = Date.now() + 1200;

        // Sarvam supports a flush signal (Sep 2025) that finalizes the
        // current segment without closing the WS. Calling it here makes the
        // post-send guard window shorter in practice — any remaining audio
        // gets transcribed and dropped by the guard above, then Sarvam stops
        // emitting until the candidate starts speaking the next turn.
        if (this.recognition && typeof this.recognition.flush === 'function') {
            try { this.recognition.flush(); } catch (_) {}
        }

        // Keep Web Speech alive if mic is still on; the guard above drops the
        // stale in-flight result without disrupting recognition.
        if (!this._sttActive && this.micOn && !this.isPlayingAudio
            && this.userRole === 'candidate') {
            this._scheduleRestart(0);
        }
    },

    addAgentMessage(agentId, agentName, agentRole, text) {
        const container = document.getElementById('sr-chat-messages');
        if (!container) return;

        const agent = this.agents.find(a => a.id === agentId);
        const color = agent ? agent.color : '#6366f1';
        const avatar = agent ? agent.avatar : agentName.charAt(0);

        const div = document.createElement('div');
        div.className = 'sr-msg sr-msg-agent';
        div.innerHTML = `
            <div class="sr-msg-avatar" style="background: ${color}">${avatar}</div>
            <div class="sr-msg-body">
                <div class="sr-msg-header">
                    <span class="sr-msg-name">${agentName}</span>
                    <span class="sr-msg-role">${agentRole}</span>
                </div>
                <div class="sr-msg-text">${this.escapeHtml(text)}</div>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    addCandidateMessage(name, text) {
        const container = document.getElementById('sr-chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'sr-msg sr-msg-candidate';
        div.innerHTML = `
            <div class="sr-msg-avatar" style="background: #22c55e">${(name || 'C').charAt(0).toUpperCase()}</div>
            <div class="sr-msg-body">
                <div class="sr-msg-header">
                    <span class="sr-msg-name">${this.escapeHtml(name || 'Candidate')}</span>
                </div>
                <div class="sr-msg-text">${this.escapeHtml(text)}</div>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    addRecruiterMessage(name, text) {
        const container = document.getElementById('sr-chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'sr-msg sr-msg-recruiter';
        div.innerHTML = `
            <div class="sr-msg-avatar" style="background: #f59e0b">${(name || 'R').charAt(0).toUpperCase()}</div>
            <div class="sr-msg-body">
                <div class="sr-msg-header">
                    <span class="sr-msg-name">${this.escapeHtml(name || 'Recruiter')}</span>
                    <span class="sr-msg-role">Recruiter</span>
                </div>
                <div class="sr-msg-text">${this.escapeHtml(text)}</div>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    addSystemMessage(text) {
        const container = document.getElementById('sr-chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'sr-msg sr-msg-system';
        div.innerHTML = `<div class="sr-msg-text">${this.escapeHtml(text)}</div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    showTypingIndicator(agentId, agentName) {
        this.removeTypingIndicator();
        const container = document.getElementById('sr-chat-messages');
        if (!container) return;

        const agent = this.agents.find(a => a.id === agentId);
        const color = agent ? agent.color : '#6366f1';
        const avatar = agent ? agent.avatar : agentName.charAt(0);

        const div = document.createElement('div');
        div.className = 'sr-typing-indicator';
        div.id = 'sr-typing-indicator';
        div.innerHTML = `
            <div class="sr-typing-avatar" style="background: ${color}">${avatar}</div>
            <div class="sr-typing-dots"><span></span><span></span><span></span></div>
            <span class="sr-typing-name">${agentName} is thinking...</span>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    removeTypingIndicator() {
        document.getElementById('sr-typing-indicator')?.remove();
    },

    updateChatStatus(text, status) {
        const dot = document.querySelector('#sr-chat-status .sr-status-dot');
        const span = document.getElementById('sr-status-text');
        if (span) span.textContent = text;
        if (dot) {
            dot.classList.remove('sr-status-live', 'sr-status-paused');
            if (status === 'live') dot.classList.add('sr-status-live');
            if (status === 'paused') dot.classList.add('sr-status-paused');
        }
    },

    focusChatInput() {
        const input = document.getElementById('sr-chat-input');
        if (input) setTimeout(() => input.focus(), 300);
    },

    highlightSpeakingAgent(agentId) {
        this.clearSpeakingAgent();
        this.currentSpeakingAgent = agentId;
        const tile = document.querySelector(`.sr-side-tile[data-id="${agentId}"]`);
        if (tile) tile.classList.add('sr-agent-speaking');
    },

    clearSpeakingAgent() {
        this.currentSpeakingAgent = null;
        document.querySelectorAll('.sr-side-tile.sr-agent-speaking').forEach(
            el => el.classList.remove('sr-agent-speaking')
        );
    },

    // ---- TTS Audio Playback ----

    /**
     * Unlock audio playback on mobile — must be called from a user gesture
     * (click/tap). Creates a persistent <audio> element and plays a silent
     * buffer so the browser marks audio as user-activated.
     */
    unlockAudio() {
        if (this.audioUnlocked) return;

        // Create + resume the Web Audio context here, inside the user gesture, so
        // TTS playback (which uses Web Audio) is allowed to start later without a
        // gesture. Browsers block AudioContext until a gesture resumes it.
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx && !this.audioCtx) {
                this.audioCtx = new Ctx();
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
        } catch (e) {
            console.warn('[TTS] Could not create AudioContext:', e);
        }

        // Create persistent audio element (kept as a fallback for the silent-WAV
        // unlock ping; TTS itself now plays through Web Audio).
        this.ttsAudioEl = document.createElement('audio');
        this.ttsAudioEl.setAttribute('playsinline', '');
        this.ttsAudioEl.id = 'sr-tts-audio';
        document.body.appendChild(this.ttsAudioEl);

        // Play a tiny silent WAV to unlock the audio context
        // Minimal valid WAV: 44-byte header + 1 sample of silence
        const silentWav = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        try {
            const byteChars = atob(silentWav);
            const byteArray = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                byteArray[i] = byteChars.charCodeAt(i);
            }
            const blob = new Blob([byteArray], { type: 'audio/wav' });
            this.ttsAudioEl.src = URL.createObjectURL(blob);
            this.ttsAudioEl.play().then(() => {
                this.audioUnlocked = true;
                console.log('[TTS] Audio unlocked for playback');
            }).catch(() => {
                console.warn('[TTS] Could not unlock audio');
            });
        } catch (e) {
            console.warn('[TTS] Audio unlock failed:', e);
        }
    },

    _ensureAudioCtx() {
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new Ctx();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        // Shared output chain: a gentle compressor/limiter that evens out the
        // chunk-to-chunk and agent-to-agent loudness swings so the voice holds a
        // consistent mid level. Rebuilt only if the AudioContext changed.
        if (!this._ttsOut || this._ttsOut.context !== this.audioCtx) {
            try {
                // Gentle PEAK limiter only. With the per-chunk gain now smoothed to
                // a steady RMS, the average level should pass untouched; the limiter
                // just catches the occasional loud peak. A low threshold here (-22)
                // used to compress the NORMAL level and fight the leveling, making
                // loudness feel inconsistent.
                const comp = this.audioCtx.createDynamicsCompressor();
                comp.threshold.value = -10;
                comp.knee.value = 18;
                comp.ratio.value = 4;
                comp.attack.value = 0.003;
                comp.release.value = 0.25;
                comp.connect(this.audioCtx.destination);
                this._ttsOut = comp;
            } catch (e) {
                this._ttsOut = null;  // fall back to direct destination
            }
        }
        return this.audioCtx;
    },

    // Mean RMS amplitude of a decoded buffer (sampled for speed) — used to level
    // each TTS chunk to a consistent loudness.
    _bufferRms(buf) {
        try {
            const floor = this._TTS_SPEECH_FLOOR;
            let sumSq = 0, n = 0;
            const channels = Math.min(buf.numberOfChannels, 2);
            for (let c = 0; c < channels; c++) {
                const data = buf.getChannelData(c);
                const step = Math.max(1, Math.floor(data.length / 8000));
                // Measure loudness over SPEECH only — skip near-silent samples so a
                // chunk with lots of leading/trailing silence isn't over-amplified.
                for (let i = 0; i < data.length; i += step) {
                    const s = data[i];
                    if (s > floor || s < -floor) { sumSq += s * s; n++; }
                }
            }
            return n ? Math.sqrt(sumSq / n) : 0;
        } catch (e) { return 0; }
    },

    _base64ToUint8(base64) {
        const byteChars = atob(base64);
        const arr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            arr[i] = byteChars.charCodeAt(i);
        }
        return arr;
    },

    // Stop and clear everything currently playing/queued (used on interrupt/end).
    _stopAllAudio() {
        this.audioChunkQueue = [];
        this._pendingBuffers = [];
        if (this._prebufferTimer) { clearTimeout(this._prebufferTimer); this._prebufferTimer = null; }
        this._playbackStarted = false;
        this._ttsGainEma = null;
        for (const src of this._scheduledSources) {
            try { src.onended = null; src.stop(); } catch (e) {}
        }
        this._scheduledSources = [];
        this._nextStartTime = 0;
        this.isPlayingAudio = false;
    },

    queueAudio(base64Data) {
        if (!base64Data) return;
        this.audioChunkQueue.push(base64Data);

        const wasPlaying = this.isPlayingAudio;
        if (!wasPlaying) {
            this.isPlayingAudio = true;
            this._nextStartTime = 0;       // fresh schedule clock for this TTS burst
            this._playbackStarted = false; // hold until the prebuffer lead is ready
            this._pendingBuffers = [];
            this._ttsGainEma = null;       // restart loudness smoothing for this burst
            // First chunk of a new TTS burst: auto-mute the candidate's mic so it
            // never picks up the AI's voice through the speakers, and pause the
            // silence watchdog so the candidate isn't auto-submitted while the
            // agent is talking.
            if (this.userRole === 'candidate') {
                this._clearSilenceTimer();
                this._applyMicState();
            }
        }
        this._drainAudioQueue();
    },

    // Decode each chunk fully, then either hold it in the prebuffer (until the lead
    // is ready) or schedule it on the AudioContext timeline so chunks play
    // back-to-back with no gap and no start-of-playback pitch ramp.
    async _drainAudioQueue() {
        if (this._decoding) return;     // a drain loop is already running
        this._decoding = true;

        let ctx;
        try {
            ctx = this._ensureAudioCtx();
        } catch (e) {
            console.error('[TTS] No AudioContext available:', e);
            this._decoding = false;
            this._stopAllAudio();
            if (this.userRole === 'candidate') this._applyMicState();
            return;
        }

        // Make sure the context is actually RUNNING before we schedule the first
        // buffer. If it is still 'suspended' (autoplay policy), resume() is async —
        // scheduling against a not-yet-running clock made the first word start mid
        // ramp-up, so it sounded slow and was barely audible. Await the resume.
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (e) {}
        }

        try {
            while (this.audioChunkQueue.length > 0) {
                const base64 = this.audioChunkQueue.shift();
                let audioBuffer;
                try {
                    const bytes = this._base64ToUint8(base64);
                    // decodeAudioData fully decodes before we ever start playback,
                    // so the audio never plays during decoder warm-up.
                    audioBuffer = await ctx.decodeAudioData(bytes.buffer);
                } catch (e) {
                    console.warn('[TTS] Chunk decode failed, skipping:', e);
                    continue;
                }

                if (this._playbackStarted) {
                    this._scheduleBuffer(ctx, audioBuffer);
                } else {
                    // Still filling the prebuffer. Hold the decoded chunk and start
                    // once we have a safety lead (enough chunks OR enough seconds of
                    // audio), or when the fallback timer fires.
                    this._pendingBuffers.push(audioBuffer);
                    const bufferedSec = this._pendingBuffers.reduce((s, b) => s + (b.duration || 0), 0);
                    if (this._pendingBuffers.length >= this._PREBUFFER_CHUNKS
                        || bufferedSec >= this._PREBUFFER_MIN_SEC) {
                        this._startPlayback(ctx);
                    } else if (!this._prebufferTimer) {
                        this._prebufferTimer = setTimeout(() => {
                            this._prebufferTimer = null;
                            const c = this.audioCtx;
                            if (c && !this._playbackStarted) this._startPlayback(c);
                        }, this._PREBUFFER_MS);
                    }
                }
            }
        } finally {
            this._decoding = false;
        }

        // A chunk may have arrived during the last await; pick it up.
        if (this.audioChunkQueue.length > 0) {
            this._drainAudioQueue();
        } else {
            this._maybeFinishAudio();
        }
    },

    // Flush the prebuffer and begin gapless playback.
    _startPlayback(ctx) {
        if (this._playbackStarted) return;
        this._playbackStarted = true;
        if (this._prebufferTimer) { clearTimeout(this._prebufferTimer); this._prebufferTimer = null; }
        const pending = this._pendingBuffers;
        this._pendingBuffers = [];
        for (const buf of pending) {
            this._scheduleBuffer(ctx, buf);
        }
    },

    // Schedule one decoded AudioBuffer to play right after the previous one.
    _scheduleBuffer(ctx, audioBuffer) {
        // Start at the later of "now" or the end of the previously scheduled
        // chunk. The FIRST chunk of a burst (_nextStartTime still 0) gets a bigger
        // lead so its opening word isn't clipped while the audio clock settles
        // right after resume(); later chunks need only a small jitter cushion.
        const lead = (this._nextStartTime === 0) ? 0.14 : 0.04;
        const startAt = Math.max(ctx.currentTime + lead, this._nextStartTime);
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        // Loudness-normalize this chunk toward the target RMS so volume stays
        // consistent across chunks/agents, then route through the shared
        // compressor (or straight to destination if it failed to build).
        const rms = this._bufferRms(audioBuffer);
        let target = (rms > 0.0005) ? (this._TTS_TARGET_RMS / rms) : 1;
        target = Math.min(this._TTS_MAX_GAIN, Math.max(this._TTS_MIN_GAIN, target));
        // Smooth across the burst's chunks so the level eases instead of jumping
        // from one chunk to the next (the cause of "starts low, then suddenly loud").
        this._ttsGainEma = (this._ttsGainEma == null)
            ? target
            : (this._TTS_GAIN_SMOOTH * this._ttsGainEma + (1 - this._TTS_GAIN_SMOOTH) * target);
        const gain = this._ttsGainEma;
        const out = this._ttsOut || ctx.destination;
        if (Math.abs(gain - 1) > 0.02) {
            const gainNode = ctx.createGain();
            gainNode.gain.value = gain;
            src.connect(gainNode);
            gainNode.connect(out);
        } else {
            src.connect(out);
        }
        src.onended = () => {
            const idx = this._scheduledSources.indexOf(src);
            if (idx !== -1) this._scheduledSources.splice(idx, 1);
            this._maybeFinishAudio();
        };
        src.start(startAt);
        this._nextStartTime = startAt + audioBuffer.duration;
        this._scheduledSources.push(src);
    },

    // The burst is over only when nothing is left to decode, the prebuffer is
    // empty, and every scheduled chunk has finished playing. Then re-arm the mic.
    _maybeFinishAudio() {
        if (this.isPlayingAudio
            && !this._decoding
            && this.audioChunkQueue.length === 0
            && this._pendingBuffers.length === 0
            && this._scheduledSources.length === 0) {
            this.isPlayingAudio = false;
            this._playbackStarted = false;
            this._nextStartTime = 0;
            if (this.userRole === 'candidate') {
                this._applyMicState();
            }
        }
    },

    toggleChat() {
        this.chatOpen = !this.chatOpen;
        const panel = document.getElementById('sr-chat-panel');
        const btn = document.getElementById('sr-btn-chat');
        if (panel) panel.classList.toggle('hidden', !this.chatOpen);
        if (btn) btn.classList.toggle('sr-control-active', this.chatOpen);
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ==================== UTILS ====================

    showToast(message) {
        const existing = document.querySelector('.sr-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'sr-toast';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '100px', left: '50%',
            transform: 'translateX(-50%) translateY(10px)',
            padding: '12px 24px', background: '#1e1e1e', color: '#fff',
            borderRadius: '8px', fontSize: '14px', fontWeight: '500',
            fontFamily: 'Inter, sans-serif', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: '9999', opacity: '0', transition: 'all 0.25s ease'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
            setTimeout(() => toast.remove(), 250);
        }, 2500);
    }
};

document.addEventListener('DOMContentLoaded', () => ScreeningRoom.init());
window.ScreeningRoom = ScreeningRoom;
