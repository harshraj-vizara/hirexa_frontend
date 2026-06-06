/**
 * Scoreniq - Facial Expression Analysis Module
 * Uses MediaPipe Face Landmarker (browser-side) for real-time facial analysis
 * during mock interviews. Draws FULL DENSE triangulated face mesh overlay
 * (yellow/neon wireframe) and computes emotion scores sent to backend for LLM feedback.
 */

import { FilesetResolver, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

class FacialAnalyzer {
    constructor() {
        this.faceLandmarker = null;
        this.initialized = false;
        this.running = false;
        this.intervalId = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;

        // Drawing state
        this.drawRAF = null;
        this.lastLandmarks = null;
        this.landmarkFadeAlpha = 0;
        this.pulsePhase = 0;
        this.frameCount = 0;
        this._pixelCoords = null; // reusable array for pre-computed pixel positions
        this._keyPoints = [
            1, 4, 5, 6, 10, 33, 133, 152, 168, 263, 362, 389, 127, 234, 454, 323,
            61, 291, 0, 17, 78, 308, 474, 475, 476, 477, 469, 470, 471, 472
        ];

        // Tesselation connections from MediaPipe (loaded at runtime)
        this.connFormat = 'object'; // 'object' ({start,end}) or 'array' ([start,end])
        this.tesselationConnections = null;
        this.leftEyeConnections = null;
        this.rightEyeConnections = null;
        this.leftIrisConnections = null;
        this.rightIrisConnections = null;
        this.lipsConnections = null;
        this.faceOvalConnections = null;
        this.leftEyebrowConnections = null;
        this.rightEyebrowConnections = null;

        // Data collection
        this.samples = [];
        this.faceAbsentCount = 0;
        this.totalFrames = 0;
        this.cameraStartTime = null;
        this.totalCameraTime = 0; // ms

        console.log('[FacialAnalyzer] Module loaded and constructor initialized');
    }

    async initialize() {
        if (this.initialized) {
            console.log('[FacialAnalyzer] Already initialized, skipping');
            return true;
        }

        try {
            console.log('[FacialAnalyzer] ⏳ Loading MediaPipe FilesetResolver for vision tasks...');
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
            );
            console.log('[FacialAnalyzer] ✅ FilesetResolver loaded successfully');

            console.log('[FacialAnalyzer] ⏳ Creating FaceLandmarker model (GPU delegate, blendshapes enabled)...');
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU'
                },
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: false,
                runningMode: 'VIDEO',
                numFaces: 1
            });
            console.log('[FacialAnalyzer] ✅ FaceLandmarker model created successfully');

            // Load MediaPipe's built-in face mesh connections
            this._loadConnections();

            this.initialized = true;
            console.log('[FacialAnalyzer] ✅ Initialization complete - ready to analyze faces');
            return true;
        } catch (error) {
            console.error('[FacialAnalyzer] ❌ Failed to initialize:', error.message);
            console.error('[FacialAnalyzer] Stack:', error.stack);
            this.initialized = false;
            return false;
        }
    }

    _loadConnections() {
        // Use MediaPipe's built-in connection constants for the FULL dense mesh
        try {
            // Log what's available on FaceLandmarker
            console.log('[FacialAnalyzer] Checking FaceLandmarker static properties...');
            console.log('[FacialAnalyzer]   FACE_LANDMARKS_TESSELATION:', typeof FaceLandmarker.FACE_LANDMARKS_TESSELATION, FaceLandmarker.FACE_LANDMARKS_TESSELATION ? `(${FaceLandmarker.FACE_LANDMARKS_TESSELATION.length} items)` : '(null/undefined)');

            this.tesselationConnections = FaceLandmarker.FACE_LANDMARKS_TESSELATION || null;
            this.leftEyeConnections = FaceLandmarker.FACE_LANDMARKS_LEFT_EYE || null;
            this.rightEyeConnections = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE || null;
            this.leftIrisConnections = FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS || null;
            this.rightIrisConnections = FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS || null;
            this.lipsConnections = FaceLandmarker.FACE_LANDMARKS_LIPS || null;
            this.faceOvalConnections = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL || null;
            this.leftEyebrowConnections = FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW || null;
            this.rightEyebrowConnections = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW || null;

            // Detect connection format (object with .start/.end vs array [start, end])
            if (this.tesselationConnections && this.tesselationConnections.length > 0) {
                const sample = this.tesselationConnections[0];
                console.log('[FacialAnalyzer]   Sample connection object:', JSON.stringify(sample), 'type:', typeof sample);
                if (typeof sample === 'object' && 'start' in sample) {
                    this.connFormat = 'object'; // { start, end }
                } else if (Array.isArray(sample)) {
                    this.connFormat = 'array'; // [start, end]
                } else {
                    this.connFormat = 'unknown';
                    console.warn('[FacialAnalyzer] ⚠️ Unknown connection format:', sample);
                }
                console.log(`[FacialAnalyzer]   Connection format: ${this.connFormat}`);
            }

            const tessCount = this.tesselationConnections ? this.tesselationConnections.length : 0;
            console.log(`[FacialAnalyzer] ✅ Loaded MediaPipe connections: ${tessCount} tesselation edges`);
            console.log(`[FacialAnalyzer]   - Face oval: ${this.faceOvalConnections?.length || 0} connections`);
            console.log(`[FacialAnalyzer]   - Left eye: ${this.leftEyeConnections?.length || 0} connections`);
            console.log(`[FacialAnalyzer]   - Right eye: ${this.rightEyeConnections?.length || 0} connections`);
            console.log(`[FacialAnalyzer]   - Lips: ${this.lipsConnections?.length || 0} connections`);
            console.log(`[FacialAnalyzer]   - Left iris: ${this.leftIrisConnections?.length || 0} connections`);
            console.log(`[FacialAnalyzer]   - Right iris: ${this.rightIrisConnections?.length || 0} connections`);
        } catch (err) {
            console.warn('[FacialAnalyzer] ⚠️ Could not load MediaPipe built-in connections:', err);
            this.tesselationConnections = null;
            this.connFormat = 'object';
        }
    }

    // Helper to get start/end indices from a connection (handles both formats)
    _connStart(conn) {
        if (typeof conn === 'object' && 'start' in conn) return conn.start;
        if (Array.isArray(conn)) return conn[0];
        return conn.start; // fallback
    }

    _connEnd(conn) {
        if (typeof conn === 'object' && 'end' in conn) return conn.end;
        if (Array.isArray(conn)) return conn[1];
        return conn.end; // fallback
    }

    start(videoElement, canvasElement) {
        if (!this.initialized || !this.faceLandmarker) {
            console.warn('[FacialAnalyzer] ⚠️ Not initialized, cannot start analysis');
            return false;
        }

        if (this.running) {
            console.warn('[FacialAnalyzer] ⚠️ Already running');
            return true;
        }

        this.videoElement = videoElement;
        this.canvasElement = canvasElement || null;
        if (this.canvasElement) {
            this.canvasCtx = this.canvasElement.getContext('2d');
        }
        this.running = true;
        this.cameraStartTime = Date.now();
        this.lastLandmarks = null;
        this.landmarkFadeAlpha = 0;
        this.frameCount = 0;

        console.log('[FacialAnalyzer] 🎬 Starting face analysis...');
        console.log(`[FacialAnalyzer]   - Video element: ${videoElement.id || 'unnamed'} (${videoElement.videoWidth}x${videoElement.videoHeight})`);
        console.log(`[FacialAnalyzer]   - Canvas overlay: ${canvasElement ? 'YES' : 'NO'}`);
        console.log(`[FacialAnalyzer]   - Analysis rate: 2 FPS (every 500ms)`);
        console.log(`[FacialAnalyzer]   - Drawing: requestAnimationFrame (display refresh rate)`);

        // Analysis at 2 FPS (every 500ms) for data collection
        this.intervalId = setInterval(() => {
            this.analyzeFrame();
        }, 500);

        // Smooth drawing loop at display refresh rate
        if (this.canvasElement) {
            this._startDrawLoop();
        }

        console.log('[FacialAnalyzer] ✅ Analysis started successfully');
        return true;
    }

    stop() {
        console.log('[FacialAnalyzer] 🛑 Stopping face analysis...');

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[FacialAnalyzer]   - Cleared analysis interval');
        }

        if (this.drawRAF) {
            cancelAnimationFrame(this.drawRAF);
            this.drawRAF = null;
            console.log('[FacialAnalyzer]   - Cancelled draw animation frame');
        }

        if (this.cameraStartTime) {
            const sessionTime = Date.now() - this.cameraStartTime;
            this.totalCameraTime += sessionTime;
            this.cameraStartTime = null;
            console.log(`[FacialAnalyzer]   - Session time: ${Math.round(sessionTime / 1000)}s (total: ${Math.round(this.totalCameraTime / 1000)}s)`);
        }

        // Clear canvas
        if (this.canvasCtx && this.canvasElement) {
            this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            console.log('[FacialAnalyzer]   - Canvas cleared');
        }

        this.running = false;
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;
        this.lastLandmarks = null;

        console.log(`[FacialAnalyzer] ✅ Stopped. Total frames analyzed: ${this.totalFrames}, Samples collected: ${this.samples.length}, Face absent: ${this.faceAbsentCount}`);
    }

    analyzeFrame() {
        if (!this.running || !this.videoElement || !this.faceLandmarker) {
            console.log('[FacialAnalyzer] ⏭️ Skipping frame - not ready (running:', this.running, ', video:', !!this.videoElement, ', model:', !!this.faceLandmarker, ')');
            return;
        }
        if (this.videoElement.readyState < 2) {
            console.log('[FacialAnalyzer] ⏭️ Skipping frame - video not ready (readyState:', this.videoElement.readyState, ')');
            return;
        }

        try {
            const timestamp = performance.now();
            const results = this.faceLandmarker.detectForVideo(this.videoElement, timestamp);
            this.totalFrames++;
            this.frameCount++;

            if (!results.faceLandmarks || results.faceLandmarks.length === 0 ||
                !results.faceBlendshapes || results.faceBlendshapes.length === 0) {
                this.faceAbsentCount++;
                this.lastLandmarks = null;
                console.log(`[FacialAnalyzer] 👤 Frame #${this.frameCount}: NO FACE DETECTED (absent: ${this.faceAbsentCount}/${this.totalFrames})`);
                return;
            }

            // Store landmarks for drawing
            this.lastLandmarks = results.faceLandmarks[0];
            const landmarkCount = this.lastLandmarks.length;

            const blendshapes = results.faceBlendshapes[0].categories;
            const bsMap = {};
            for (const bs of blendshapes) {
                bsMap[bs.categoryName] = bs.score;
            }

            const sample = {
                blinkIntensity: this._avg(bsMap['eyeBlinkLeft'], bsMap['eyeBlinkRight']),
                smile: this._avg(bsMap['mouthSmileLeft'], bsMap['mouthSmileRight']),
                frown: this._avg(bsMap['mouthFrownLeft'], bsMap['mouthFrownRight']),
                browFurrow: this._avg(bsMap['browDownLeft'], bsMap['browDownRight']),
                eyeSquint: this._avg(bsMap['eyeSquintLeft'], bsMap['eyeSquintRight']),
                lipTension: this._avg(bsMap['mouthPressLeft'], bsMap['mouthPressRight']),
                gazeDown: this._avg(bsMap['eyeLookDownLeft'], bsMap['eyeLookDownRight']),
                gazeHorizontal: this._gazeDeviation(bsMap),
                displeasure: this._avg(bsMap['mouthFrownLeft'], bsMap['mouthFrownRight']) +
                             (bsMap['noseSneerLeft'] || 0) * 0.5 + (bsMap['noseSneerRight'] || 0) * 0.5,
                timestamp: Date.now()
            };

            this.samples.push(sample);

            // Log every 5th frame to avoid console spam causing jank
            if (this.frameCount % 5 === 0) {
                console.log(
                    `[FacialAnalyzer] 🔍 Frame #${this.frameCount}: FACE DETECTED ` +
                    `| Landmarks: ${landmarkCount} ` +
                    `| Smile: ${sample.smile.toFixed(3)} ` +
                    `| Blink: ${sample.blinkIntensity.toFixed(3)} ` +
                    `| BrowFurrow: ${sample.browFurrow.toFixed(3)} ` +
                    `| GazeH: ${sample.gazeHorizontal.toFixed(3)} ` +
                    `| GazeDown: ${sample.gazeDown.toFixed(3)}`
                );
            }

            // Log running emotion scores every 20 frames
            if (this.frameCount % 20 === 0) {
                const runningScores = this._computeRunningScores();
                console.log(
                    `[FacialAnalyzer] 📊 Running scores (${this.samples.length} samples): ` +
                    `Confidence=${runningScores.confidence} ` +
                    `Nervousness=${runningScores.nervousness} ` +
                    `Engagement=${runningScores.engagement} ` +
                    `Suspicion=${runningScores.suspicion}`
                );
            }

        } catch (error) {
            console.error(`[FacialAnalyzer] ❌ Frame #${this.frameCount} analysis error:`, error.message);
        }
    }

    _computeRunningScores() {
        const n = this.samples.length;
        if (n === 0) return { confidence: 0, nervousness: 0, engagement: 0, suspicion: 0 };

        const facePresenceRate = this.totalFrames > 0
            ? (this.totalFrames - this.faceAbsentCount) / this.totalFrames : 0;

        const avgSmile = this._sampleAvg('smile');
        const avgBlink = this._sampleAvg('blinkIntensity');
        const avgBrowFurrow = this._sampleAvg('browFurrow');
        const avgGazeH = this._sampleAvg('gazeHorizontal');
        const avgGazeDown = this._sampleAvg('gazeDown');
        const avgEyeSquint = this._sampleAvg('eyeSquint');
        const avgLipTension = this._sampleAvg('lipTension');

        const relaxedBrows = 1 - Math.min(1, avgBrowFurrow * 3);
        const steadyGaze = 1 - Math.min(1, avgGazeH * 3);
        const normalBlinks = 1 - Math.abs(avgBlink - 0.15) * 3;
        const confidence = Math.round(
            this._clamp((avgSmile * 2) * 40 + relaxedBrows * 25 + steadyGaze * 20 + Math.max(0, normalBlinks) * 15, 0, 100)
        );

        const highBlinkRate = Math.min(1, avgBlink * 3);
        const nervousness = Math.round(
            this._clamp(highBlinkRate * 30 + Math.min(1, avgBrowFurrow * 3) * 25 + Math.min(1, avgLipTension * 3) * 20 + Math.min(1, avgGazeH * 3) * 15 + Math.min(1, avgEyeSquint * 3) * 10, 0, 100)
        );

        const gazeFocus = 1 - Math.min(1, avgGazeH * 3);
        const notLookingDown = 1 - Math.min(1, avgGazeDown * 3);
        const engagement = Math.round(
            this._clamp(facePresenceRate * 40 + gazeFocus * 30 + Math.min(1, avgSmile * 2) * 15 + notLookingDown * 15, 0, 100)
        );

        const faceAbsenceRate = 1 - facePresenceRate;
        const suspicion = Math.round(
            this._clamp(faceAbsenceRate * 40 + Math.min(1, avgGazeH * 3) * 35 + Math.min(1, avgGazeDown * 3) * 25, 0, 100)
        );

        return { confidence, nervousness, engagement, suspicion };
    }

    // ==================== LANDMARK DRAWING ====================

    _startDrawLoop() {
        console.log('[FacialAnalyzer] 🎨 Starting landmark drawing loop (requestAnimationFrame)');
        const draw = () => {
            if (!this.running) return;
            this._drawLandmarks();
            this.drawRAF = requestAnimationFrame(draw);
        };
        this.drawRAF = requestAnimationFrame(draw);
    }

    _drawLandmarks() {
        if (!this.canvasCtx || !this.canvasElement) return;

        const canvas = this.canvasElement;
        const ctx = this.canvasCtx;

        // Match canvas resolution to actual display size (check sparingly)
        const rect = canvas.getBoundingClientRect();
        const rw = Math.round(rect.width);
        const rh = Math.round(rect.height);
        if (canvas.width !== rw || canvas.height !== rh) {
            canvas.width = rw;
            canvas.height = rh;
        }

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        this.pulsePhase += 0.03;

        if (!this.lastLandmarks) {
            this.landmarkFadeAlpha = Math.max(0, this.landmarkFadeAlpha - 0.05);
            if (this.landmarkFadeAlpha <= 0) return;
        } else {
            this.landmarkFadeAlpha = Math.min(1, this.landmarkFadeAlpha + 0.1);
        }

        if (this.landmarkFadeAlpha <= 0) return;

        const landmarks = this.lastLandmarks;
        if (!landmarks) return;

        const alpha = this.landmarkFadeAlpha;

        // Pre-compute all pixel coordinates ONCE (avoids repeated multiplication)
        const px = this._pixelCoords;
        if (!px || px.length !== landmarks.length) {
            this._pixelCoords = new Array(landmarks.length);
        }
        for (let i = 0; i < landmarks.length; i++) {
            const lm = landmarks[i];
            if (lm) {
                this._pixelCoords[i] = { x: lm.x * w, y: lm.y * h };
            } else {
                this._pixelCoords[i] = null;
            }
        }
        const pts = this._pixelCoords;

        // ========== 1) FULL DENSE TESSELATION MESH ==========
        // Single batch draw - no shadows, no per-line style changes
        if (this.tesselationConnections && this.tesselationConnections.length > 0) {
            ctx.lineWidth = 0.4;
            ctx.strokeStyle = `rgba(200,255,0,${(0.25 * alpha).toFixed(2)})`;
            ctx.beginPath();
            for (let i = 0; i < this.tesselationConnections.length; i++) {
                const conn = this.tesselationConnections[i];
                const pa = pts[this._connStart(conn)];
                const pb = pts[this._connEnd(conn)];
                if (!pa || !pb) continue;
                ctx.moveTo(pa.x, pa.y);
                ctx.lineTo(pb.x, pb.y);
            }
            ctx.stroke();
        }

        // ========== 2) FACE OVAL (brighter, NO shadowBlur for performance) ==========
        if (this.faceOvalConnections && this.faceOvalConnections.length > 0) {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = `rgba(220,255,0,${(0.7 * alpha).toFixed(2)})`;
            ctx.beginPath();
            for (let i = 0; i < this.faceOvalConnections.length; i++) {
                const conn = this.faceOvalConnections[i];
                const pa = pts[this._connStart(conn)];
                const pb = pts[this._connEnd(conn)];
                if (!pa || !pb) continue;
                ctx.moveTo(pa.x, pa.y);
                ctx.lineTo(pb.x, pb.y);
            }
            ctx.stroke();
        }

        // ========== 3) EYES ==========
        this._drawConnBatch(ctx, this.leftEyeConnections, pts, `rgba(255,255,0,${(0.9 * alpha).toFixed(2)})`, 1.2);
        this._drawConnBatch(ctx, this.rightEyeConnections, pts, `rgba(255,255,0,${(0.9 * alpha).toFixed(2)})`, 1.2);

        // ========== 4) IRISES ==========
        this._drawConnBatch(ctx, this.leftIrisConnections, pts, `rgba(255,255,50,${(0.8 * alpha).toFixed(2)})`, 1.5);
        this._drawConnBatch(ctx, this.rightIrisConnections, pts, `rgba(255,255,50,${(0.8 * alpha).toFixed(2)})`, 1.5);

        // ========== 5) EYEBROWS ==========
        this._drawConnBatch(ctx, this.leftEyebrowConnections, pts, `rgba(220,255,0,${(0.6 * alpha).toFixed(2)})`, 0.8);
        this._drawConnBatch(ctx, this.rightEyebrowConnections, pts, `rgba(220,255,0,${(0.6 * alpha).toFixed(2)})`, 0.8);

        // ========== 6) LIPS ==========
        this._drawConnBatch(ctx, this.lipsConnections, pts, `rgba(255,200,0,${(0.7 * alpha).toFixed(2)})`, 1);

        // ========== 7) ALL LANDMARK DOTS (single batched path) ==========
        ctx.fillStyle = `rgba(220,255,0,${(0.45 * alpha).toFixed(2)})`;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!p) continue;
            ctx.moveTo(p.x + 0.6, p.y);
            ctx.arc(p.x, p.y, 0.6, 0, 6.2832); // 2*PI = 6.2832
        }
        ctx.fill();

        // ========== 8) KEY FEATURE POINTS (batched) ==========
        ctx.fillStyle = `rgba(255,255,0,${(0.8 * alpha).toFixed(2)})`;
        ctx.beginPath();
        for (let i = 0; i < this._keyPoints.length; i++) {
            const p = pts[this._keyPoints[i]];
            if (!p) continue;
            ctx.moveTo(p.x + 1.5, p.y);
            ctx.arc(p.x, p.y, 1.5, 0, 6.2832);
        }
        ctx.fill();

        // ========== 9) SCANNING LINE (simple rect, no gradient) ==========
        const scanY = (Math.sin(this.pulsePhase * 0.8) * 0.5 + 0.5) * h;
        ctx.fillStyle = `rgba(220,255,0,${(0.08 * alpha).toFixed(2)})`;
        ctx.fillRect(0, scanY - 6, w, 12);
    }

    // Batched connection drawing - NO shadows, single stroke per group
    _drawConnBatch(ctx, connections, pts, color, lineWidth) {
        if (!connections || connections.length === 0) return;
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (let i = 0; i < connections.length; i++) {
            const conn = connections[i];
            const pa = pts[this._connStart(conn)];
            const pb = pts[this._connEnd(conn)];
            if (!pa || !pb) continue;
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
        }
        ctx.stroke();
    }

    // ==================== UTILITY ====================

    _avg(a, b) {
        return ((a || 0) + (b || 0)) / 2;
    }

    _gazeDeviation(bsMap) {
        const lookOutLeft = bsMap['eyeLookOutLeft'] || 0;
        const lookOutRight = bsMap['eyeLookOutRight'] || 0;
        const lookInLeft = bsMap['eyeLookInLeft'] || 0;
        const lookInRight = bsMap['eyeLookInRight'] || 0;
        return (lookOutLeft + lookOutRight + lookInLeft + lookInRight) / 4;
    }

    // ==================== DATA SUMMARY ====================

    getSummary() {
        console.log('[FacialAnalyzer] 📋 Generating summary...');
        console.log(`[FacialAnalyzer]   - Total frames: ${this.totalFrames}`);
        console.log(`[FacialAnalyzer]   - Samples collected: ${this.samples.length}`);
        console.log(`[FacialAnalyzer]   - Face absent count: ${this.faceAbsentCount}`);
        console.log(`[FacialAnalyzer]   - Camera time: ${Math.round(this.totalCameraTime / 1000)}s`);

        if (this.samples.length === 0 && this.totalFrames === 0) {
            console.log('[FacialAnalyzer] ⚠️ No data collected - camera was not used');
            return { camera_used: false };
        }

        const n = this.samples.length;
        const facePresenceRate = this.totalFrames > 0
            ? (this.totalFrames - this.faceAbsentCount) / this.totalFrames
            : 0;

        if (n === 0) {
            console.log('[FacialAnalyzer] ⚠️ No face samples - face was never detected');
            return {
                camera_used: true,
                total_frames: this.totalFrames,
                face_detected_frames: 0,
                camera_time_seconds: Math.round(this.totalCameraTime / 1000),
                confidence: 30,
                nervousness: 50,
                engagement: 20,
                suspicion: 80,
                blinks_per_minute: 0,
                smile_percentage: 0,
                gaze_away_percentage: 100,
                summary_text: 'Face was not detected during most of the camera session. The candidate may have been looking away or the camera angle was off.'
            };
        }

        const avgSmile = this._sampleAvg('smile');
        const avgBlink = this._sampleAvg('blinkIntensity');
        const avgBrowFurrow = this._sampleAvg('browFurrow');
        const avgGazeH = this._sampleAvg('gazeHorizontal');
        const avgGazeDown = this._sampleAvg('gazeDown');
        const avgEyeSquint = this._sampleAvg('eyeSquint');
        const avgLipTension = this._sampleAvg('lipTension');
        const avgFrown = this._sampleAvg('frown');

        console.log('[FacialAnalyzer] 📊 Average blendshape values:');
        console.log(`[FacialAnalyzer]   - Smile: ${avgSmile.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - Blink: ${avgBlink.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - BrowFurrow: ${avgBrowFurrow.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - GazeH: ${avgGazeH.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - GazeDown: ${avgGazeDown.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - EyeSquint: ${avgEyeSquint.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - LipTension: ${avgLipTension.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - Frown: ${avgFrown.toFixed(4)}`);
        console.log(`[FacialAnalyzer]   - Face presence: ${(facePresenceRate * 100).toFixed(1)}%`);

        const cameraSeconds = this.totalCameraTime / 1000;
        const highBlinks = this.samples.filter(s => s.blinkIntensity > 0.5).length;
        const blinksPerMinute = cameraSeconds > 0 ? Math.round((highBlinks / cameraSeconds) * 60) : 0;

        const smileFrames = this.samples.filter(s => s.smile > 0.3).length;
        const smilePercentage = Math.round((smileFrames / n) * 100);

        const gazeAwayFrames = this.samples.filter(s => s.gazeHorizontal > 0.2 || s.gazeDown > 0.3).length;
        const gazeAwayPercentage = Math.round((gazeAwayFrames / n) * 100);

        // Confidence: smile(40%) + relaxed brows(25%) + steady gaze(20%) + normal blinks(15%)
        const relaxedBrows = 1 - Math.min(1, avgBrowFurrow * 3);
        const steadyGaze = 1 - Math.min(1, avgGazeH * 3);
        const normalBlinks = 1 - Math.abs(avgBlink - 0.15) * 3;
        const confidence = Math.round(
            this._clamp((avgSmile * 2) * 40 + relaxedBrows * 25 + steadyGaze * 20 + Math.max(0, normalBlinks) * 15, 0, 100)
        );

        // Nervousness
        const highBlinkRate = Math.min(1, avgBlink * 3);
        const nervousness = Math.round(
            this._clamp(highBlinkRate * 30 + Math.min(1, avgBrowFurrow * 3) * 25 + Math.min(1, avgLipTension * 3) * 20 + Math.min(1, avgGazeH * 3) * 15 + Math.min(1, avgEyeSquint * 3) * 10, 0, 100)
        );

        // Engagement
        const gazeFocus = 1 - Math.min(1, avgGazeH * 3);
        const notLookingDown = 1 - Math.min(1, avgGazeDown * 3);
        const engagement = Math.round(
            this._clamp(facePresenceRate * 40 + gazeFocus * 30 + Math.min(1, avgSmile * 2) * 15 + notLookingDown * 15, 0, 100)
        );

        // Suspicion
        const faceAbsenceRate = 1 - facePresenceRate;
        const suspicion = Math.round(
            this._clamp(faceAbsenceRate * 40 + Math.min(1, avgGazeH * 3) * 35 + Math.min(1, avgGazeDown * 3) * 25, 0, 100)
        );

        const summaryParts = [];
        summaryParts.push(`Camera was active for ${Math.round(cameraSeconds)} seconds.`);
        summaryParts.push(`Face detected in ${Math.round(facePresenceRate * 100)}% of frames.`);
        summaryParts.push(`Smile detected in ${smilePercentage}% of frames.`);
        summaryParts.push(`Blink rate: ~${blinksPerMinute} blinks/min (normal: 15-20).`);
        summaryParts.push(`Gaze away from screen: ${gazeAwayPercentage}% of time.`);
        if (confidence > 60) summaryParts.push('Candidate appeared generally confident.');
        else if (confidence < 35) summaryParts.push('Candidate appeared to lack confidence in facial expressions.');
        if (nervousness > 60) summaryParts.push('Signs of nervousness detected (frequent blinking, brow tension).');
        if (engagement < 40) summaryParts.push('Low engagement detected - candidate frequently looked away.');
        if (suspicion > 60) summaryParts.push('High suspicion score - candidate may have been looking at notes or another screen.');

        const summary = {
            camera_used: true,
            total_frames: this.totalFrames,
            face_detected_frames: this.totalFrames - this.faceAbsentCount,
            camera_time_seconds: Math.round(cameraSeconds),
            confidence,
            nervousness,
            engagement,
            suspicion,
            blinks_per_minute: blinksPerMinute,
            smile_percentage: smilePercentage,
            gaze_away_percentage: gazeAwayPercentage,
            summary_text: summaryParts.join(' ')
        };

        console.log('[FacialAnalyzer] ✅ Final Summary:');
        console.log(`[FacialAnalyzer]   - Confidence: ${confidence}/100`);
        console.log(`[FacialAnalyzer]   - Nervousness: ${nervousness}/100`);
        console.log(`[FacialAnalyzer]   - Engagement: ${engagement}/100`);
        console.log(`[FacialAnalyzer]   - Suspicion: ${suspicion}/100`);
        console.log(`[FacialAnalyzer]   - Blinks/min: ${blinksPerMinute}`);
        console.log(`[FacialAnalyzer]   - Smile%: ${smilePercentage}%`);
        console.log(`[FacialAnalyzer]   - Gaze away%: ${gazeAwayPercentage}%`);
        console.log('[FacialAnalyzer]   - Summary text:', summary.summary_text);
        return summary;
    }

    _sampleAvg(key) {
        if (this.samples.length === 0) return 0;
        const sum = this.samples.reduce((acc, s) => acc + (s[key] || 0), 0);
        return sum / this.samples.length;
    }

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    reset() {
        console.log('[FacialAnalyzer] 🔄 Resetting all data...');
        this.stop();
        this.samples = [];
        this.faceAbsentCount = 0;
        this.totalFrames = 0;
        this.cameraStartTime = null;
        this.totalCameraTime = 0;
        this.lastLandmarks = null;
        this.landmarkFadeAlpha = 0;
        this.pulsePhase = 0;
        this.frameCount = 0;
        console.log('[FacialAnalyzer] ✅ Reset complete - all data cleared');
    }
}

// Attach to InterviewArena IMMEDIATELY (not on DOMContentLoaded, since this module
// loads from CDN and DOMContentLoaded may have already fired by the time imports resolve)
function attachAnalyzer() {
    if (!window.InterviewArena) {
        window.InterviewArena = {};
    }
    window.InterviewArena.facialAnalyzer = new FacialAnalyzer();
    console.log('[FacialAnalyzer] ✅ Attached to window.InterviewArena.facialAnalyzer');
}

attachAnalyzer();
