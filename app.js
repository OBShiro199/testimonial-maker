// Testimonial Studio: sign in, frame yourself, record with a teleprompter, export.

// Client-side gate only. Anyone who can read the page source can see it.
const PASSWORD = "rosewell";
const SESSION_KEY = "ts-signed-in";
const SCRIPT_KEY = "ts-script";
const PREFS_KEY = "ts-prefs";

const SAMPLE_SCRIPT = `Hi, I'm [your name], and I'm [your role] at [company].

Before we started working together, we were struggling with [the problem]. It was costing us time, and honestly, a lot of stress.

What stood out straight away was how easy everything felt. The team understood exactly what we needed.

Since then, we've seen [a specific result]. That's made a real difference to how we work every day.

If you're thinking about it, I'd say just go for it. I'm really glad we did.`;

// Oval guide geometry, as fractions of the stage height.
const OVAL = { cy: 0.46, ry: 0.32, aspect: 0.76 };

const $ = (id) => document.getElementById(id);
const els = {
  loginScreen: $("screen-login"), studioScreen: $("screen-studio"),
  loginForm: $("login-form"), password: $("password"), loginError: $("login-error"),
  logout: $("logout"),
  stage: $("stage"), preview: $("preview"), playback: $("playback"), guide: $("guide"),
  stageEmpty: $("stage-empty"), enableCam: $("enable-cam"), camError: $("cam-error"),
  pillCentre: $("pill-centre"), pillStill: $("pill-still"), hint: $("hint"),
  record: $("record"), recLabel: $("rec-label"), recBadge: $("rec-badge"), recTime: $("rec-time"),
  countdown: $("countdown"),
  controlsLive: $("controls-live"), controlsReview: $("controls-review"),
  retake: $("retake"), exportBtn: $("export"), exportMeta: $("export-meta"),
  prompterWindow: $("prompter-window"), prompterText: $("prompter-text"),
  speed: $("speed"), size: $("size"), editScript: $("edit-script"),
  scriptDialog: $("script-dialog"), scriptForm: $("script-form"), scriptInput: $("script-input"),
};

const store = {
  get(key, storage = localStorage) { try { return storage.getItem(key); } catch { return null; } },
  set(key, value, storage = localStorage) { try { storage.setItem(key, value); } catch {} },
  remove(key, storage = localStorage) { try { storage.removeItem(key); } catch {} },
};

const state = {
  stream: null,
  recorder: null,
  chunks: [],
  blob: null,
  blobUrl: null,
  mimeType: "",
  phase: "frame", // frame | countdown | recording | review
  recStart: 0,
  scrollY: 0,
  lastTick: 0,
  faceDetector: null,
  centred: false,
  still: false,
  motion: 0,
};

/* ---------------- Sign in ---------------- */

function showScreen(name) {
  els.loginScreen.classList.toggle("active", name === "login");
  els.studioScreen.classList.toggle("active", name === "studio");
}

els.loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (els.password.value.trim().toLowerCase() === PASSWORD) {
    store.set(SESSION_KEY, "1", sessionStorage);
    els.loginError.textContent = "";
    enterStudio();
  } else {
    els.loginError.textContent = "That password isn't right. Try again.";
    els.loginForm.classList.remove("shake");
    void els.loginForm.offsetWidth;
    els.loginForm.classList.add("shake");
    els.password.select();
  }
});

els.logout.addEventListener("click", () => {
  store.remove(SESSION_KEY, sessionStorage);
  stopCamera();
  resetToFrame();
  els.password.value = "";
  showScreen("login");
  els.password.focus();
});

function enterStudio() {
  showScreen("studio");
  layoutGuide();
  renderScript();
  // If the camera permission is already granted, skip the button.
  navigator.permissions?.query({ name: "camera" })
    .then((p) => { if (p.state === "granted") startCamera(); })
    .catch(() => {});
}

/* ---------------- Camera ---------------- */

async function startCamera() {
  els.camError.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    els.camError.textContent = "This browser can't access a camera. Try the latest Chrome, Safari or Edge.";
    return;
  }
  els.enableCam.disabled = true;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    els.enableCam.disabled = false;
    els.camError.textContent = err.name === "NotAllowedError"
      ? "Camera access was blocked. Allow it in your browser's site settings, then try again."
      : `Couldn't start the camera (${err.name || "error"}).`;
    return;
  }
  els.preview.srcObject = state.stream;
  await els.preview.play().catch(() => {});
  els.stageEmpty.hidden = true;
  els.record.disabled = false;
  loadFaceDetector();
  requestAnimationFrame(analyseLoop);
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  els.preview.srcObject = null;
  els.stageEmpty.hidden = false;
  els.enableCam.disabled = false;
  els.record.disabled = true;
}

els.enableCam.addEventListener("click", startCamera);

/* ---------------- Framing guide ---------------- */

function layoutGuide() {
  const { width: w, height: h } = els.stage.getBoundingClientRect();
  if (!w || !h) return;
  const ry = h * OVAL.ry;
  const rx = Math.min(ry * OVAL.aspect, w * 0.42);
  els.guide.setAttribute("viewBox", `0 0 ${w} ${h}`);
  els.guide.querySelectorAll("rect").forEach((r) => { r.setAttribute("width", w); r.setAttribute("height", h); });
  els.guide.querySelectorAll("ellipse").forEach((e) => {
    e.setAttribute("cx", w / 2); e.setAttribute("cy", h * OVAL.cy);
    e.setAttribute("rx", rx); e.setAttribute("ry", ry);
  });
}
new ResizeObserver(layoutGuide).observe(els.stage);

// Face detection is a progressive enhancement: if MediaPipe can't load,
// the oval guide and stillness meter still work.
async function loadFaceDetector() {
  if (state.faceDetector) return;
  try {
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
    const vision = await import(`${base}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
    state.faceDetector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
  } catch (err) {
    console.warn("Face detection unavailable, using the guide only.", err);
    state.faceDetector = false;
  }
}

// Maps a point in the video's pixel space to the stage's display space,
// accounting for object-fit: cover cropping and the mirrored preview.
function videoToStage(x, y) {
  const vw = els.preview.videoWidth, vh = els.preview.videoHeight;
  const { width: sw, height: sh } = els.stage.getBoundingClientRect();
  const scale = Math.max(sw / vw, sh / vh);
  const ox = (sw - vw * scale) / 2, oy = (sh - vh * scale) / 2;
  return { x: sw - (x * scale + ox), y: y * scale + oy, scale, sw, sh };
}

const motionCanvas = document.createElement("canvas");
motionCanvas.width = 64; motionCanvas.height = 36;
const motionCtx = motionCanvas.getContext("2d", { willReadFrequently: true });
let prevFrame = null;
let lastAnalyse = 0;
let lastVideoTime = -1;
let centredSince = 0;

function analyseLoop(now) {
  if (!state.stream) return;
  requestAnimationFrame(analyseLoop);
  if (now - lastAnalyse < 80 || els.preview.readyState < 2) return;
  lastAnalyse = now;

  // Stillness: mean luminance change between tiny downscaled frames.
  motionCtx.drawImage(els.preview, 0, 0, 64, 36);
  const data = motionCtx.getImageData(0, 0, 64, 36).data;
  const lum = new Float32Array(64 * 36);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  if (prevFrame) {
    let diff = 0;
    for (let j = 0; j < lum.length; j++) diff += Math.abs(lum[j] - prevFrame[j]);
    state.motion = state.motion * 0.7 + (diff / lum.length) * 0.3;
  }
  prevFrame = lum;
  state.still = state.motion < 4;

  // Centring: compare the detected face with the oval.
  let hint = "Centre your face inside the oval and sit comfortably still.";
  let face = null;
  if (state.faceDetector && els.preview.currentTime !== lastVideoTime) {
    lastVideoTime = els.preview.currentTime;
    try { face = state.faceDetector.detectForVideo(els.preview, now).detections[0]?.boundingBox ?? null; } catch {}
    state.lastFace = face;
  } else {
    face = state.lastFace ?? null;
  }

  if (state.faceDetector) {
    if (!face) {
      state.centred = false;
      hint = "We can't see your face yet. Check your lighting and look at the camera.";
    } else {
      // The face box covers roughly brow to chin, so shift up a little for the head centre.
      const c = videoToStage(face.originX + face.width / 2, face.originY + face.height * 0.42);
      const faceH = face.height * c.scale;
      const ovalCx = c.sw / 2, ovalCy = c.sh * OVAL.cy, ovalRy = c.sh * OVAL.ry;
      const dx = (c.x - ovalCx) / ovalRy, dy = (c.y - ovalCy) / ovalRy;
      const size = faceH / (ovalRy * 2);
      if (size < 0.38) hint = "Move a little closer to the camera.";
      else if (size > 0.85) hint = "Lean back a touch, you're a little close.";
      else if (dx > 0.22) hint = "Move a little to your right.";
      else if (dx < -0.22) hint = "Move a little to your left.";
      else if (dy > 0.25) hint = "Raise the camera or sit up a little.";
      else if (dy < -0.25) hint = "Lower the camera or sit down a little.";
      state.centred = size >= 0.38 && size <= 0.85 && Math.abs(dx) <= 0.22 && Math.abs(dy) <= 0.25;
    }
  } else {
    state.centred = null; // unknown without a detector
  }

  if (state.centred && !state.still) hint = "Great framing. Now try to sit still.";
  if (state.centred && state.still) hint = "Perfect. You're ready to record.";
  if (state.centred === null && state.still) hint = "Looking steady. Line your face up with the oval, then record.";

  updateFramingUI(hint);
}

function updateFramingUI(hint) {
  if (state.phase !== "frame") return;
  const centreOk = state.centred === true;
  els.pillCentre.classList.toggle("ok", centreOk);
  els.pillCentre.classList.toggle("off", state.centred === null);
  els.pillCentre.querySelector("b").textContent =
    state.centred === null ? (state.faceDetector === null ? "Finding you…" : "Line up with the oval")
    : centreOk ? "Centred" : "Not centred";
  els.pillStill.classList.toggle("ok", state.still);
  els.pillStill.querySelector("b").textContent = state.still ? "Nice and still" : "Hold still";

  const ready = state.still && state.centred !== false;
  if (ready) centredSince ||= performance.now(); else centredSince = 0;
  els.stage.classList.toggle("aligned", centreOk && state.still);
  els.record.classList.toggle("ready", ready && performance.now() - centredSince > 600);
  els.hint.textContent = hint;
  els.hint.classList.toggle("good", centreOk && state.still);
}

/* ---------------- Teleprompter ---------------- */

function getScript() { return store.get(SCRIPT_KEY) || SAMPLE_SCRIPT; }

function renderScript() {
  const paragraphs = getScript().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  els.prompterText.replaceChildren(
    ...paragraphs.map((p) => Object.assign(document.createElement("p"), { textContent: p })),
    Object.assign(document.createElement("p"), { className: "end", textContent: "· End of script ·" }),
  );
  setScroll(0);
}

function setScroll(y) {
  const max = Math.max(0, els.prompterText.scrollHeight - 200);
  state.scrollY = Math.min(Math.max(0, y), max);
  els.prompterText.style.transform = `translateY(${-state.scrollY}px)`;
  return state.scrollY >= max;
}

function prompterLoop(now) {
  if (state.phase !== "recording") return;
  const dt = (now - state.lastTick) / 1000;
  state.lastTick = now;
  const finished = setScroll(state.scrollY + Number(els.speed.value) * dt);
  els.recTime.textContent = formatTime((now - state.recStart) / 1000);
  els.recLabel.textContent = finished ? "Script finished. Stop when you're ready." : "Recording. Press to stop";
  requestAnimationFrame(prompterLoop);
}

// Scroll the prompter by hand (wheel or drag) before or during a take.
els.prompterWindow.addEventListener("wheel", (e) => { e.preventDefault(); setScroll(state.scrollY + e.deltaY * 0.6); }, { passive: false });
let dragY = null;
els.prompterWindow.addEventListener("pointerdown", (e) => { dragY = e.clientY; els.prompterWindow.setPointerCapture(e.pointerId); });
els.prompterWindow.addEventListener("pointermove", (e) => { if (dragY !== null) { setScroll(state.scrollY - (e.clientY - dragY)); dragY = e.clientY; } });
els.prompterWindow.addEventListener("pointerup", () => { dragY = null; });

function applyPrefs() {
  els.prompterText.style.setProperty("--prompter-size", `${els.size.value}px`);
  store.set(PREFS_KEY, JSON.stringify({ speed: els.speed.value, size: els.size.value }));
}
try {
  const prefs = JSON.parse(store.get(PREFS_KEY) || "{}");
  if (prefs.speed) els.speed.value = prefs.speed;
  if (prefs.size) els.size.value = prefs.size;
} catch {}
els.speed.addEventListener("input", applyPrefs);
els.size.addEventListener("input", applyPrefs);
applyPrefs();

els.editScript.addEventListener("click", () => {
  els.scriptInput.value = getScript();
  els.scriptDialog.showModal();
  els.scriptInput.focus();
});
els.scriptForm.addEventListener("submit", (e) => {
  const action = e.submitter?.value;
  if (action === "save") store.set(SCRIPT_KEY, els.scriptInput.value.trim() || SAMPLE_SCRIPT);
  if (action === "reset") { e.preventDefault(); els.scriptInput.value = SAMPLE_SCRIPT; return; }
  renderScript();
});

/* ---------------- Recording ---------------- */

function pickMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

function setStep(step) {
  const order = ["frame", "record", "export"];
  document.querySelectorAll(".steps li").forEach((li) => {
    const i = order.indexOf(li.dataset.step), cur = order.indexOf(step);
    li.classList.toggle("current", i === cur);
    li.classList.toggle("done", i < cur);
  });
}

async function startCountdown() {
  if (!state.stream || state.phase !== "frame") return;
  if (!window.MediaRecorder) { els.hint.textContent = "This browser can't record video. Try the latest Chrome, Safari or Edge."; return; }
  state.phase = "countdown";
  els.record.disabled = true;
  els.record.classList.remove("ready");
  els.stage.classList.add("recording");
  els.studioScreen.classList.add("recording");
  setScroll(0);
  setStep("record");
  els.hint.textContent = "Get ready. Read from the top of the teleprompter.";
  els.countdown.hidden = false;
  for (const n of [3, 2, 1]) {
    if (state.phase !== "countdown") return;
    els.countdown.replaceChildren(Object.assign(document.createElement("span"), { textContent: n }));
    await new Promise((r) => setTimeout(r, 1000));
  }
  els.countdown.hidden = true;
  if (state.phase === "countdown") startRecording();
}

function startRecording() {
  state.mimeType = pickMimeType();
  state.chunks = [];
  try {
    state.recorder = new MediaRecorder(state.stream, {
      ...(state.mimeType && { mimeType: state.mimeType }),
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000,
    });
  } catch {
    state.recorder = new MediaRecorder(state.stream);
  }
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = finishRecording;
  state.recorder.start(1000);

  state.phase = "recording";
  state.recStart = state.lastTick = performance.now();
  els.record.disabled = false;
  els.record.classList.add("is-recording");
  els.record.setAttribute("aria-label", "Stop recording");
  els.recBadge.hidden = false;
  els.hint.textContent = "";
  requestAnimationFrame(prompterLoop);
}

function stopRecording() {
  if (state.phase !== "recording") return;
  state.phase = "review";
  state.recorder.stop();
}

function finishRecording() {
  const type = state.recorder.mimeType || state.mimeType || "video/webm";
  state.blob = new Blob(state.chunks, { type });
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = URL.createObjectURL(state.blob);

  els.record.classList.remove("is-recording");
  els.recBadge.hidden = true;
  els.preview.hidden = true;
  els.guide.style.display = "none";
  els.playback.src = state.blobUrl;
  els.playback.hidden = false;
  els.controlsLive.hidden = true;
  els.controlsReview.hidden = false;
  els.hint.textContent = "Take a look. Happy with it? Export it, or retake.";
  els.hint.classList.remove("good");
  const secs = (performance.now() - state.recStart) / 1000;
  els.exportMeta.textContent = `${formatTime(secs)} · ${(state.blob.size / 1e6).toFixed(1)} MB · ${extFor(type).toUpperCase()}`;
  setStep("export");
}

function resetToFrame() {
  if (state.recorder?.state === "recording") { state.recorder.onstop = null; state.recorder.stop(); }
  state.phase = "frame";
  els.countdown.hidden = true;
  els.playback.pause();
  els.playback.removeAttribute("src");
  els.playback.hidden = true;
  els.preview.hidden = false;
  els.guide.style.display = "";
  els.stage.classList.remove("recording");
  els.studioScreen.classList.remove("recording");
  els.record.classList.remove("is-recording");
  els.record.disabled = !state.stream;
  els.record.setAttribute("aria-label", "Start recording");
  els.recBadge.hidden = true;
  els.recLabel.innerHTML = "Press to record <kbd>Space</kbd>";
  els.controlsLive.hidden = false;
  els.controlsReview.hidden = true;
  setScroll(0);
  setStep("frame");
}

els.record.addEventListener("click", () => {
  if (state.phase === "frame") startCountdown();
  else if (state.phase === "recording") stopRecording();
});
els.retake.addEventListener("click", resetToFrame);

els.exportBtn.addEventListener("click", () => {
  if (!state.blob) return;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const a = Object.assign(document.createElement("a"), {
    href: state.blobUrl,
    download: `testimonial-${stamp}.${extFor(state.blob.type)}`,
  });
  document.body.append(a);
  a.click();
  a.remove();
});

document.addEventListener("keydown", (e) => {
  if (!els.studioScreen.classList.contains("active") || els.scriptDialog.open) return;
  if (e.target.closest("input, textarea, button")) return;
  if (e.code === "Space") { e.preventDefault(); els.record.click(); }
  if (e.code === "ArrowUp" || e.code === "ArrowDown") {
    e.preventDefault();
    els.speed.value = Number(els.speed.value) + (e.code === "ArrowUp" ? 4 : -4);
    applyPrefs();
  }
});

function extFor(type) { return type.includes("mp4") ? "mp4" : "webm"; }
function formatTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/* ---------------- Boot ---------------- */

if (store.get(SESSION_KEY, sessionStorage) === "1") enterStudio();
else showScreen("login");
