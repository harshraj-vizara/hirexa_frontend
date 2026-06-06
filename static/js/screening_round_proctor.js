/**
 * Scoreniq — Screening Round Proctoring & Behavioral Analysis
 * Client-side face analysis using MediaPipe Face Mesh.
 * Uses a hidden full-resolution video element for accurate analysis,
 * draws landmarks on the visible camera tile's canvas overlay.
 */

const ScreeningProctor = {
    // State
    _running: false,
    _ready: false,       // true once FaceMesh model is loaded
    _faceMesh: null,
    _animFrame: null,
    _intervalId: null,
    _intervalMs: 200, // 5 FPS
    _startTime: 0,
    _processing: false,  // guard against overlapping send() calls

    // Elements
    _hiddenVideo: null,   // 640x480 for analysis
    _visibleVideo: null,  // small tile for landmark overlay
    _canvas: null,        // canvas overlay on visible tile
    _canvasCtx: null,
    _stream: null,        // camera MediaStream

    // Status indicator
    _statusEl: null,

    // ==================== METRICS ACCUMULATOR ====================

    _metrics: {
        totalFrames: 0,
        eyeContactFrames: 0,
        headStableFrames: 0,
        gazeOffscreenFrames: 0,
        multipleFacesCount: 0,
        faceMissingFrames: 0,
        faceIdentityChanges: 0,
        tabSwitchCount: 0,
        tabAwaySeconds: 0,
        lookingAwayTransitions: 0,
    },

    // Gaze state for debouncing
    _gazeState: {
        isAway: false,
        awayFrameCount: 0,
        lastTransitionTime: 0,
    },

    // Head tracking
    _prevYaw: null,
    _prevPitch: null,

    // Face identity baseline
    _baselineRatios: null,
    _baselineFrameCount: 0,
    _BASELINE_FRAMES: 10,

    // Tab tracking
    _tabHidden: false,
    _tabHiddenAt: 0,
    _tabSwitches: [],

    // Event timeline
    _events: [],

    // Adaptive FPS
    _lastFrameTime: 0,

    // ==================== INIT ====================

    init(visibleVideoEl, cameraStream) {
        if (this._running) return;
        console.log('[Proctor] Initializing...');

        this._stream = cameraStream;
        this._visibleVideo = visibleVideoEl;
        this._startTime = Date.now();
        this._running = true;
        this._ready = false;
        this._processing = false;

        // Reset metrics
        this._resetMetrics();

        // Create hidden video at full resolution
        this._createHiddenVideo(cameraStream);

        // Create canvas overlay on visible tile
        this._createCanvasOverlay();

        // Create status indicator
        this._createStatusIndicator();

        // Setup tab visibility tracking
        this._setupTabTracking();

        // Initialize MediaPipe Face Mesh
        this._initFaceMesh();
    },

    _resetMetrics() {
        this._metrics = {
            totalFrames: 0,
            eyeContactFrames: 0,
            headStableFrames: 0,
            gazeOffscreenFrames: 0,
            multipleFacesCount: 0,
            faceMissingFrames: 0,
            faceIdentityChanges: 0,
            tabSwitchCount: 0,
            tabAwaySeconds: 0,
            lookingAwayTransitions: 0,
        };
        this._gazeState = { isAway: false, awayFrameCount: 0, lastTransitionTime: 0 };
        this._prevYaw = null;
        this._prevPitch = null;
        this._baselineRatios = null;
        this._baselineFrameCount = 0;
        this._tabSwitches = [];
        this._events = [];
    },

    // ==================== HIDDEN VIDEO ====================

    _createHiddenVideo(stream) {
        // Remove any leftover from previous session
        const old = document.getElementById('sr-proctor-video');
        if (old) old.remove();

        this._hiddenVideo = document.createElement('video');
        this._hiddenVideo.id = 'sr-proctor-video';
        this._hiddenVideo.setAttribute('autoplay', '');
        this._hiddenVideo.setAttribute('playsinline', '');
        this._hiddenVideo.muted = true;
        this._hiddenVideo.width = 640;
        this._hiddenVideo.height = 480;
        this._hiddenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:640px;height:480px;pointer-events:none;opacity:0;';
        this._hiddenVideo.srcObject = stream;
        document.body.appendChild(this._hiddenVideo);
        this._hiddenVideo.play().catch(e => console.warn('[Proctor] Hidden video play failed:', e));
    },

    // ==================== CANVAS OVERLAY ====================

    _createCanvasOverlay() {
        const tile = document.getElementById('sr-my-camera-tile');
        if (!tile) {
            console.warn('[Proctor] Camera tile not found, will retry on reattach');
            return;
        }

        // Remove existing canvas if any
        const existing = tile.querySelector('.sr-proctor-canvas');
        if (existing) existing.remove();

        // Match canvas resolution to tile's rendered size for sharp drawing
        const rect = tile.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const canvasW = Math.round(rect.width * dpr) || 480;
        const canvasH = Math.round(rect.height * dpr) || 360;

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'sr-proctor-canvas';
        this._canvas.width = canvasW;
        this._canvas.height = canvasH;
        tile.appendChild(this._canvas);
        this._canvasCtx = this._canvas.getContext('2d');
        console.log(`[Proctor] Canvas overlay created: ${canvasW}x${canvasH} on tile ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    },

    /** Re-attach canvas after side panel rebuilds (renderSidePanel destroys DOM) */
    _reattachCanvas() {
        if (!this._running) return;
        this._createCanvasOverlay();
        this._updateStatusIndicator();
    },

    // ==================== STATUS INDICATOR ====================

    _createStatusIndicator() {
        const tile = document.getElementById('sr-my-camera-tile');
        if (!tile) return;

        const existing = tile.querySelector('.sr-proctor-status');
        if (existing) existing.remove();

        this._statusEl = document.createElement('div');
        this._statusEl.className = 'sr-proctor-status sr-proctor-status-ok';
        this._statusEl.innerHTML = '<span class="sr-proctor-status-dot"></span>';
        tile.appendChild(this._statusEl);
    },

    _updateStatusIndicator() {
        const tile = document.getElementById('sr-my-camera-tile');
        if (!tile) return;

        let el = tile.querySelector('.sr-proctor-status');
        if (!el) {
            this._createStatusIndicator();
            el = tile.querySelector('.sr-proctor-status');
        }
        if (!el) return;

        // Determine current status
        const m = this._metrics;
        const hasIssue = m.multipleFacesCount > 0 || m.faceIdentityChanges > 0 || m.tabSwitchCount > 2;
        el.className = 'sr-proctor-status ' + (hasIssue ? 'sr-proctor-status-warn' : 'sr-proctor-status-ok');
    },

    // ==================== TAB TRACKING ====================

    _setupTabTracking() {
        this._visibilityHandler = () => {
            if (!this._running) return;
            const now = Date.now();
            const elapsed = (now - this._startTime) / 1000;

            if (document.hidden) {
                this._tabHidden = true;
                this._tabHiddenAt = now;
                this._metrics.tabSwitchCount++;
                this._tabSwitches.push({ time: elapsed, action: 'left' });
                this._addEvent('tab_switch', 'Candidate switched away from tab');
            } else {
                if (this._tabHidden && this._tabHiddenAt) {
                    const awayMs = now - this._tabHiddenAt;
                    this._metrics.tabAwaySeconds += Math.round(awayMs / 1000);
                    this._tabSwitches.push({ time: elapsed, action: 'returned', duration: Math.round(awayMs / 1000) });
                }
                this._tabHidden = false;
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    },

    // ==================== MEDIAPIPE INIT ====================

    _initFaceMesh() {
        if (typeof FaceMesh === 'undefined') {
            console.warn('[Proctor] MediaPipe FaceMesh not loaded yet, retrying in 1s...');
            if (this._running) setTimeout(() => this._initFaceMesh(), 1000);
            return;
        }

        console.log('[Proctor] Creating FaceMesh instance...');

        try {
            this._faceMesh = new FaceMesh({
                locateFile: (file) => {
                    const url = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
                    console.log(`[Proctor] Loading: ${file}`);
                    return url;
                }
            });

            this._faceMesh.setOptions({
                maxNumFaces: 2,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });

            this._faceMesh.onResults((results) => this._onResults(results));

            // CRITICAL: call initialize() and wait for WASM + model to load before processing
            console.log('[Proctor] Initializing FaceMesh model (downloading WASM + model)...');
            this._faceMesh.initialize().then(() => {
                console.log('[Proctor] FaceMesh model ready! Starting analysis loop.');
                this._ready = true;
                this._startLoop();
            }).catch(err => {
                console.error('[Proctor] FaceMesh initialization FAILED:', err);
            });
        } catch (err) {
            console.error('[Proctor] FaceMesh creation error:', err);
        }
    },

    _startLoop() {
        if (!this._running) return;

        this._intervalId = setInterval(() => {
            if (!this._running || !this._ready || !this._hiddenVideo) return;
            if (this._hiddenVideo.readyState < 2) return; // HAVE_CURRENT_DATA
            if (this._processing) return; // previous frame still processing

            const now = performance.now();
            if (this._lastFrameTime && (now - this._lastFrameTime) < this._intervalMs) return;

            this._lastFrameTime = now;
            this._processing = true;

            this._faceMesh.send({ image: this._hiddenVideo }).then(() => {
                const processingTime = performance.now() - now;
                this._processing = false;

                // Adaptive FPS
                if (processingTime > 150) {
                    this._intervalMs = Math.min(400, this._intervalMs + 50);
                } else if (this._intervalMs > 200) {
                    this._intervalMs = Math.max(200, this._intervalMs - 25);
                }
            }).catch(err => {
                this._processing = false;
                console.warn('[Proctor] Frame send error:', err);
            });
        }, 100);
    },

    // ==================== FACE MESH RESULTS ====================

    _onResults(results) {
        if (!this._running) return;

        const faces = results.multiFaceLandmarks || [];

        this._metrics.totalFrames++;

        // Log first successful result
        if (this._metrics.totalFrames === 1) {
            console.log(`[Proctor] First result: ${faces.length} face(s) detected`);
        }

        // --- No face detected ---
        if (faces.length === 0) {
            // Only count as missing if camera is on
            if (typeof ScreeningRoom !== 'undefined' && ScreeningRoom.cameraOn) {
                this._metrics.faceMissingFrames++;
                if (this._metrics.faceMissingFrames % 15 === 1) {
                    this._addEvent('face_missing', 'No face detected in camera');
                }
            }
            this._clearCanvas();
            return;
        }

        // --- Multiple faces ---
        if (faces.length > 1) {
            this._metrics.multipleFacesCount++;
            if (this._metrics.multipleFacesCount <= 5 || this._metrics.multipleFacesCount % 10 === 0) {
                this._addEvent('multiple_faces', `${faces.length} faces detected`);
            }
            this._updateStatusIndicator();
        }

        // Analyze primary face (largest / first)
        const landmarks = faces[0];
        const elapsed = (Date.now() - this._startTime) / 1000;
        this._analyzeFace(landmarks, elapsed);

        // Draw landmarks on visible canvas
        this._drawLandmarks(faces);
    },

    // ==================== FACE ANALYSIS ====================

    _analyzeFace(landmarks, elapsed) {
        // --- Head pose estimation (yaw & pitch from key landmarks) ---
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];
        const leftCheek = landmarks[234];
        const rightCheek = landmarks[454];

        // Yaw: horizontal position of nose relative to cheeks
        const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
        const noseRelative = (noseTip.x - leftCheek.x) / (faceWidth || 0.001);
        const yaw = (noseRelative - 0.5) * 60;

        // Pitch: vertical nose-to-chin vs nose-to-forehead ratio
        const noseToChin = Math.abs(chin.y - noseTip.y);
        const noseToForehead = Math.abs(noseTip.y - forehead.y);
        const pitchRatio = noseToChin / (noseToForehead || 0.001);
        const pitch = (pitchRatio - 1.0) * 30;

        // --- Eye contact (gaze estimation using iris landmarks) ---
        let gazeHorizontal = 0.5;

        if (landmarks.length > 473) {
            const leftIris = landmarks[468];
            const leftOuter = landmarks[33];
            const leftInner = landmarks[133];
            const leftGaze = (leftIris.x - leftOuter.x) / ((leftInner.x - leftOuter.x) || 0.001);

            const rightIris = landmarks[473];
            const rightInner = landmarks[362];
            const rightOuter = landmarks[263];
            const rightGaze = (rightIris.x - rightInner.x) / ((rightOuter.x - rightInner.x) || 0.001);

            gazeHorizontal = (leftGaze + rightGaze) / 2;
        }

        // Eye contact: gaze ratio 0.30-0.70 AND head yaw < ±15°
        const isEyeContact = gazeHorizontal >= 0.30 && gazeHorizontal <= 0.70 && Math.abs(yaw) < 15;
        if (isEyeContact) {
            this._metrics.eyeContactFrames++;
        }

        // --- Head stability ---
        if (this._prevYaw !== null) {
            const deltaYaw = Math.abs(yaw - this._prevYaw);
            const deltaPitch = Math.abs(pitch - this._prevPitch);
            if (deltaYaw < 3 && deltaPitch < 3) {
                this._metrics.headStableFrames++;
            }
        }
        this._prevYaw = yaw;
        this._prevPitch = pitch;

        // --- Gaze off-screen detection (debounced) ---
        const isGazeOff = gazeHorizontal < 0.20 || gazeHorizontal > 0.80 || Math.abs(yaw) > 25;
        if (isGazeOff) {
            this._metrics.gazeOffscreenFrames++;
            this._gazeState.awayFrameCount++;

            if (!this._gazeState.isAway && this._gazeState.awayFrameCount >= 3) {
                const now = Date.now();
                if (now - this._gazeState.lastTransitionTime > 500) {
                    this._gazeState.isAway = true;
                    this._gazeState.lastTransitionTime = now;
                    this._metrics.lookingAwayTransitions++;
                }
            }
        } else {
            if (this._gazeState.isAway) {
                this._gazeState.isAway = false;
            }
            this._gazeState.awayFrameCount = 0;
        }

        // --- Face identity baseline & swap detection ---
        this._checkFaceIdentity(landmarks);
    },

    _checkFaceIdentity(landmarks) {
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];
        const leftCheek = landmarks[234];
        const rightCheek = landmarks[454];
        const mouthLeft = landmarks[61];
        const mouthRight = landmarks[291];

        const faceHeight = Math.sqrt(Math.pow(forehead.x - chin.x, 2) + Math.pow(forehead.y - chin.y, 2));
        const faceWidth = Math.sqrt(Math.pow(rightCheek.x - leftCheek.x, 2) + Math.pow(rightCheek.y - leftCheek.y, 2));
        const mouthWidth = Math.sqrt(Math.pow(mouthRight.x - mouthLeft.x, 2) + Math.pow(mouthRight.y - mouthLeft.y, 2));

        const ratios = {
            widthToHeight: faceWidth / (faceHeight || 0.001),
            mouthToFace: mouthWidth / (faceWidth || 0.001),
            nosePosition: (noseTip.y - forehead.y) / (faceHeight || 0.001),
        };

        // Building baseline
        if (this._baselineFrameCount < this._BASELINE_FRAMES) {
            if (!this._baselineRatios) {
                this._baselineRatios = { widthToHeight: 0, mouthToFace: 0, nosePosition: 0 };
            }
            this._baselineRatios.widthToHeight += ratios.widthToHeight / this._BASELINE_FRAMES;
            this._baselineRatios.mouthToFace += ratios.mouthToFace / this._BASELINE_FRAMES;
            this._baselineRatios.nosePosition += ratios.nosePosition / this._BASELINE_FRAMES;
            this._baselineFrameCount++;
            return;
        }

        // Compare against baseline
        const diff =
            Math.abs(ratios.widthToHeight - this._baselineRatios.widthToHeight) +
            Math.abs(ratios.mouthToFace - this._baselineRatios.mouthToFace) +
            Math.abs(ratios.nosePosition - this._baselineRatios.nosePosition);

        if (diff > 0.15) {
            this._metrics.faceIdentityChanges++;
            this._addEvent('face_identity_change', 'Possible face swap detected');
            this._updateStatusIndicator();
            this._baselineRatios = { ...ratios };
            this._baselineFrameCount = this._BASELINE_FRAMES;
        }
    },

    // ==================== LANDMARK DRAWING ====================

    _drawLandmarks(faces) {
        if (!this._canvas || !this._canvasCtx) return;
        const ctx = this._canvasCtx;
        const w = this._canvas.width;
        const h = this._canvas.height;

        ctx.clearRect(0, 0, w, h);

        for (const landmarks of faces) {
            // ---- Face oval contour — glowing teal outline ----
            ctx.shadowColor = 'rgba(78, 205, 196, 0.4)';
            ctx.shadowBlur = 4;
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)';
            ctx.lineWidth = 2;
            const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
            ctx.beginPath();
            for (let i = 0; i < faceOval.length; i++) {
                const p = landmarks[faceOval[i]];
                if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                else ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // ---- Eye contours — bright teal ----
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.7)';
            ctx.lineWidth = 1.5;
            const eyes = [
                [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
                [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398, 362],
            ];
            for (const contour of eyes) {
                ctx.beginPath();
                for (let i = 0; i < contour.length; i++) {
                    const p = landmarks[contour[i]];
                    if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                    else ctx.lineTo(p.x * w, p.y * h);
                }
                ctx.stroke();
            }

            // ---- Lips contour ----
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.4)';
            ctx.lineWidth = 1.2;
            const lips = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];
            ctx.beginPath();
            for (let i = 0; i < lips.length; i++) {
                const p = landmarks[lips[i]];
                if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                else ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.stroke();

            // ---- Nose bridge line ----
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.4)';
            ctx.lineWidth = 1;
            const noseBridge = [6, 197, 195, 5, 4, 1];
            ctx.beginPath();
            for (let i = 0; i < noseBridge.length; i++) {
                const p = landmarks[noseBridge[i]];
                if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                else ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.stroke();

            // ---- Eyebrows ----
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.45)';
            ctx.lineWidth = 1.2;
            const brows = [
                [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
                [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
            ];
            for (const brow of brows) {
                ctx.beginPath();
                for (let i = 0; i < brow.length; i++) {
                    const p = landmarks[brow[i]];
                    if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                    else ctx.lineTo(p.x * w, p.y * h);
                }
                ctx.stroke();
            }

            // ---- Iris dots — bright teal with glow ring ----
            if (landmarks.length > 473) {
                for (const idx of [468, 473]) {
                    const x = landmarks[idx].x * w;
                    const y = landmarks[idx].y * h;
                    // Outer glow
                    ctx.shadowColor = 'rgba(78, 205, 196, 0.6)';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = 'rgba(78, 205, 196, 0.4)';
                    ctx.beginPath();
                    ctx.arc(x, y, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    // Core dot
                    ctx.fillStyle = 'rgba(78, 205, 196, 1.0)';
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // ---- Key landmark dots (nose tip, chin, forehead) ----
            ctx.fillStyle = 'rgba(78, 205, 196, 0.5)';
            for (const idx of [1, 152, 10]) {
                const x = landmarks[idx].x * w;
                const y = landmarks[idx].y * h;
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    },

    _clearCanvas() {
        if (!this._canvas || !this._canvasCtx) return;
        this._canvasCtx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    },

    // ==================== EVENTS ====================

    _addEvent(type, description) {
        const elapsed = (Date.now() - this._startTime) / 1000;
        this._events.push({
            time: Math.round(elapsed),
            type: type,
            description: description,
        });
        if (this._events.length > 200) {
            this._events = this._events.slice(-150);
        }
    },

    // ==================== RESULTS ====================

    getResults() {
        const m = this._metrics;
        const durationSeconds = Math.round((Date.now() - this._startTime) / 1000);
        const durationMinutes = durationSeconds / 60 || 1;
        const total = m.totalFrames || 1;

        const eyeContactPct = Math.round((m.eyeContactFrames / total) * 10000) / 100;
        const headStabilityScore = Math.round((m.headStableFrames / Math.max(1, total - 1)) * 10000) / 100;
        const gazeOffscreenPct = Math.round((m.gazeOffscreenFrames / total) * 10000) / 100;
        const lookingAwayPerMin = Math.round((m.lookingAwayTransitions / durationMinutes) * 100) / 100;

        let integrity = 100;
        integrity -= Math.min(30, m.multipleFacesCount * 5);
        integrity -= Math.min(15, m.faceMissingFrames * 0.5);
        integrity -= Math.min(25, m.faceIdentityChanges * 10);
        integrity -= Math.min(15, gazeOffscreenPct * 0.15);
        integrity -= Math.min(15, m.tabSwitchCount * 3);
        integrity = Math.max(0, Math.min(100, Math.round(integrity * 100) / 100));

        console.log(`[Proctor] Results: integrity=${integrity}, frames=${m.totalFrames}, eye=${eyeContactPct}%, tabs=${m.tabSwitchCount}`);

        return {
            integrity_score: integrity,
            multiple_faces_count: m.multipleFacesCount,
            face_missing_count: m.faceMissingFrames,
            face_identity_changes: m.faceIdentityChanges,
            gaze_offscreen_pct: gazeOffscreenPct,
            tab_switch_count: m.tabSwitchCount,
            tab_away_seconds: m.tabAwaySeconds,
            eye_contact_pct: eyeContactPct,
            head_stability_score: headStabilityScore,
            looking_away_per_min: lookingAwayPerMin,
            total_frames: m.totalFrames,
            duration_seconds: durationSeconds,
            events: this._events.slice(-100),
            tab_switches: this._tabSwitches,
        };
    },

    // ==================== STOP ====================

    stop() {
        if (!this._running) return;
        console.log('[Proctor] Stopping...');
        this._running = false;
        this._ready = false;

        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }

        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }

        if (this._hiddenVideo) {
            this._hiddenVideo.srcObject = null;
            this._hiddenVideo.remove();
            this._hiddenVideo = null;
        }

        if (this._canvas) {
            this._canvas.remove();
            this._canvas = null;
            this._canvasCtx = null;
        }

        if (this._statusEl) {
            this._statusEl.remove();
            this._statusEl = null;
        }

        if (this._faceMesh) {
            this._faceMesh.close();
            this._faceMesh = null;
        }
    },
};


/**
 * RecruiterProctorOverlay — Display-only face landmarks on the remote candidate camera.
 * No metrics collection, just visual overlay so the recruiter sees the same techy look.
 */
const RecruiterProctorOverlay = {
    _running: false,
    _ready: false,
    _faceMesh: null,
    _intervalId: null,
    _processing: false,
    _hiddenVideo: null,
    _canvas: null,
    _canvasCtx: null,
    _tileEl: null,

    start(tileEl, videoEl, stream) {
        if (this._running) return;
        console.log('[RecruiterProctor] Starting overlay on candidate feed...');
        this._running = true;
        this._tileEl = tileEl;

        // Create hidden video for analysis
        const old = document.getElementById('sr-recruiter-proctor-video');
        if (old) old.remove();
        this._hiddenVideo = document.createElement('video');
        this._hiddenVideo.id = 'sr-recruiter-proctor-video';
        this._hiddenVideo.setAttribute('autoplay', '');
        this._hiddenVideo.setAttribute('playsinline', '');
        this._hiddenVideo.muted = true;
        this._hiddenVideo.width = 640;
        this._hiddenVideo.height = 480;
        this._hiddenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:640px;height:480px;pointer-events:none;opacity:0;';
        this._hiddenVideo.srcObject = stream;
        document.body.appendChild(this._hiddenVideo);
        this._hiddenVideo.play().catch(() => {});

        // Create canvas overlay
        this._createCanvas();

        // Init FaceMesh
        this._initFaceMesh();
    },

    _createCanvas() {
        if (!this._tileEl) return;
        const existing = this._tileEl.querySelector('.sr-proctor-canvas');
        if (existing) existing.remove();

        const rect = this._tileEl.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'sr-proctor-canvas';
        this._canvas.width = Math.round(rect.width * dpr) || 480;
        this._canvas.height = Math.round(rect.height * dpr) || 360;
        this._tileEl.appendChild(this._canvas);
        this._canvasCtx = this._canvas.getContext('2d');
    },

    reattach(newTileEl) {
        if (!this._running) return;
        if (newTileEl) this._tileEl = newTileEl;
        if (!this._tileEl) return;
        this._createCanvas();
    },

    _initFaceMesh() {
        if (typeof FaceMesh === 'undefined') {
            if (this._running) setTimeout(() => this._initFaceMesh(), 1000);
            return;
        }

        this._faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
        });
        this._faceMesh.setOptions({
            maxNumFaces: 2,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
        this._faceMesh.onResults((results) => this._onResults(results));

        this._faceMesh.initialize().then(() => {
            console.log('[RecruiterProctor] FaceMesh ready.');
            this._ready = true;
            this._intervalId = setInterval(() => {
                if (!this._running || !this._ready || !this._hiddenVideo || this._hiddenVideo.readyState < 2 || this._processing) return;
                this._processing = true;
                this._faceMesh.send({ image: this._hiddenVideo }).then(() => {
                    this._processing = false;
                }).catch(() => { this._processing = false; });
            }, 200);
        }).catch(err => console.error('[RecruiterProctor] Init failed:', err));
    },

    _onResults(results) {
        if (!this._running || !this._canvas || !this._canvasCtx) return;
        const faces = results.multiFaceLandmarks || [];
        const ctx = this._canvasCtx;
        const w = this._canvas.width;
        const h = this._canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (faces.length === 0) return;

        // Reuse ScreeningProctor's drawing logic
        for (const landmarks of faces) {
            ctx.shadowColor = 'rgba(78, 205, 196, 0.4)';
            ctx.shadowBlur = 4;
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)';
            ctx.lineWidth = 2;
            const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
            ctx.beginPath();
            for (let i = 0; i < faceOval.length; i++) {
                const p = landmarks[faceOval[i]];
                if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                else ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = 'rgba(78, 205, 196, 0.7)';
            ctx.lineWidth = 1.5;
            const eyes = [
                [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
                [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398, 362],
            ];
            for (const contour of eyes) {
                ctx.beginPath();
                for (let i = 0; i < contour.length; i++) {
                    const p = landmarks[contour[i]];
                    if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                    else ctx.lineTo(p.x * w, p.y * h);
                }
                ctx.stroke();
            }

            ctx.strokeStyle = 'rgba(78, 205, 196, 0.4)';
            ctx.lineWidth = 1.2;
            const lips = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];
            ctx.beginPath();
            for (let i = 0; i < lips.length; i++) {
                const p = landmarks[lips[i]];
                if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                else ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.stroke();

            ctx.strokeStyle = 'rgba(78, 205, 196, 0.45)';
            ctx.lineWidth = 1.2;
            const brows = [
                [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
                [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
            ];
            for (const brow of brows) {
                ctx.beginPath();
                for (let i = 0; i < brow.length; i++) {
                    const p = landmarks[brow[i]];
                    if (i === 0) ctx.moveTo(p.x * w, p.y * h);
                    else ctx.lineTo(p.x * w, p.y * h);
                }
                ctx.stroke();
            }

            if (landmarks.length > 473) {
                for (const idx of [468, 473]) {
                    const x = landmarks[idx].x * w;
                    const y = landmarks[idx].y * h;
                    ctx.shadowColor = 'rgba(78, 205, 196, 0.6)';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = 'rgba(78, 205, 196, 0.4)';
                    ctx.beginPath();
                    ctx.arc(x, y, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = 'rgba(78, 205, 196, 1.0)';
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    },

    stop() {
        if (!this._running) return;
        this._running = false;
        this._ready = false;
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
        if (this._hiddenVideo) { this._hiddenVideo.srcObject = null; this._hiddenVideo.remove(); this._hiddenVideo = null; }
        if (this._canvas) { this._canvas.remove(); this._canvas = null; this._canvasCtx = null; }
        if (this._faceMesh) { this._faceMesh.close(); this._faceMesh = null; }
    },
};
