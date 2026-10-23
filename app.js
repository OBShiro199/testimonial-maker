// Testimonial Studio: sign in, frame yourself, record with a teleprompter, export.

// Client-side gate only. Anyone who can read the page source can see it.
const PASSWORD = "rosewell";
const SESSION_KEY = "ts-signed-in";
const SCRIPT_KEY = "ts-script";
const PREFS_KEY = "ts-prefs-v2";

const SAMPLE_SCRIPT = `Hi, I'm [your name], and I'm [your role] at [company].

Before we started working together, we were struggling with [the problem]. It was costing us time, and honestly, a lot of stress.

What stood out straight away was how easy everything felt. The team understood exactly what we needed.

Since then, we've seen [a specific result]. That's made a real difference to how we work every day.

If you're thinking about it, I'd say just go for it. I'm really glad we did.`;

// Oval guide geometry, as fractions of the stage height.
const OVAL = { cy: 0.46, ry: 0.32, aspect: 0.76 };
const SIZES = [20, 24, 32, 48];
const WPM = { min: 60, max: 240, step: 10 };

const $ = (id) => document.getElementById(id);
const els = {
  loginScreen: $("screen-login"), studioScreen: $("screen-studio"),
  loginForm: $("login-form"), password: $("password"), loginError: $("login-error"),
  logout: $("logout"),
  stage: $("stage"), preview: $("preview"), playback: $("playback"), guide: $("guide"),
  stageEmpty: $("stage-empty"), enableCam: $("enable-cam"), camError: $("cam-error"),
  pillCentre: $("pill-centre"), pillStill: $("pill-still"), hint: $("hint"), countdown: $("countdown"),
  record: $("record"), recordLabel: $("record-label"), pauseRec: $("pause-rec"),
  groupLive: $("group-live"), groupReview: $("group-review"),
  retake: $("retake"), exportBtn: $("export"), exportLabel: $("export-label"),
  live: $("live"), liveLabel: $("live-label"), recTime: $("rec-time"),
  prompterWindow: $("prompter-window"), prompterText: $("prompter-text"),
  progress: $("progress"), progressFill: $("progress-fill"), timeLeft: $("time-left"),
  prRestart: $("pr-restart"), prPrev: $("pr-prev"), prPlay: $("pr-play"), prNext: $("pr-next"),
  speedDown: $("speed-down"), speedUp: $("speed-up"), speedOut: $("speed-out"), sizeSeg: $("size-seg"),
  editScript: $("edit-script"), settingsBtn: $("settings-btn"), settingsMenu: $("settings-menu"),
  shortcutsBtn: $("shortcuts-btn"), shortcutsDialog: $("shortcuts-dialog"),
  scriptDialog: $("script-dialog"), scriptForm: $("script-form"), scriptInput: $("script-input"), scriptStats: $("script-stats"),
  toasts: $("toasts"),
};

const store = {
  get(key, storage = localStorage) { try { return storage.getItem(key); } catch { return null; } },
  set(key, value, storage = localStorage) { try { storage.setItem(key, value); } catch {} },
  remove(key, storage = localStorage) { try { storage.removeItem(key); } catch {} },
};

const prefs = {
  wpm: 140, size: 32,
  mirror: true, countdown: true, autoplay: true, rewind: true, guide: true,
};
try { Object.assign(prefs, JSON.parse(store.get(PREFS_KEY) || "{}")); } catch {}
const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

const state = {
  stream: null,
  recorder: null,
  chunks: [],
  blob: null,
  blobUrl: null,
  phase: "off", // off | frame | countdown | recording | paused | review
  elapsed: 0,         // recorded seconds before the current run
  runStart: 0,        // performance.now() when the current run began
  canvasDraw: null,   // stops the mirrored canvas loop
  // teleprompter
  playing: false,
  scrollY: 0,
  maxScroll: 0,
  wordsPerPx: 0,
  lastTick: 0,
  // framing
  faceDetector: null,
  lastFace: null,
  centred: null,
  still: false,
  motion: 0,
};

/* ---------------- Utilities ---------------- */

function formatTime(s, pad = true) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${pad ? String(m).padStart(2, "0") : m}:${String(r).padStart(2, "0")}`;
}
const extFor = (type) => (type.includes("mp4") ? "mp4" : "webm");
const countWords = (text) => (text.match(/\S+/g) || []).length;

function toast(message) {
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: message });
  els.toasts.append(el);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); }, 4000);
}

// Keep focus off toolbar buttons on mouse click, so Space stays bound to recording.
document.querySelectorAll(".prompter-bar button, .actionbar button").forEach((b) =>
  b.addEventListener("mousedown", (e) => e.preventDefault()));

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
    els.password.removeAttribute("aria-invalid");
    enterStudio();
  } else {
    els.loginError.textContent = els.password.value ? "That password is not right. Check it and try again." : "Enter the password to continue.";
    els.password.setAttribute("aria-invalid", "true");
    els.password.select();
  }
});
els.password.addEventListener("input", () => els.password.removeAttribute("aria-invalid"));

els.logout.addEventListener("click", () => {
  store.remove(SESSION_KEY, sessionStorage);
  resetToFrame();
  stopCamera();
  els.password.value = "";
  showScreen("login");
  els.password.focus();
});

function enterStudio() {
  showScreen("studio");
  applyPrefs();
  layoutGuide();
  renderScript();
  setLive();
  navigator.permissions?.query({ name: "camera" })
    .then((p) => { if (p.state === "granted") startCamera(); })
    .catch(() => {});
}

/* ---------------- Camera ---------------- */

async function startCamera() {
  els.camError.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    els.camError.textContent = "This browser cannot use a camera. Open the page in the latest Chrome, Safari or Edge.";
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
      : `Could not start the camera (${err.name || "unknown error"}). Check that no other app is using it.`;
    return;
  }
  els.preview.srcObject = state.stream;
  await els.preview.play().catch(() => {});
  els.stageEmpty.hidden = true;
  els.record.disabled = false;
  state.phase = "frame";
  setLive();
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
  state.phase = "off";
  setLive();
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
  if (state.faceDetector !== null) return;
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

// Maps a point in the camera's own (unmirrored) pixels to stage pixels,
// accounting for object-fit: cover cropping. Centring is symmetric, so
// the mirror doesn't matter here.
function videoToStage(x, y) {
  const vw = els.preview.videoWidth, vh = els.preview.videoHeight;
  const { width: sw, height: sh } = els.stage.getBoundingClientRect();
  const scale = Math.max(sw / vw, sh / vh);
  return { x: x * scale + (sw - vw * scale) / 2, y: y * scale + (sh - vh * scale) / 2, scale, sw, sh };
}

const motionCanvas = document.createElement("canvas");
motionCanvas.width = 64; motionCanvas.height = 36;
const motionCtx = motionCanvas.getContext("2d", { willReadFrequently: true });
let prevFrame = null;
let lastAnalyse = 0;
let lastVideoTime = -1;
let readySince = 0;

function analyseLoop(now) {
  if (!state.stream) return;
  requestAnimationFrame(analyseLoop);
  if (state.phase !== "frame" || now - lastAnalyse < 80 || els.preview.readyState < 2) return;
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

  let hint = "Centre your face inside the oval and sit comfortably still.";
  if (state.faceDetector && els.preview.currentTime !== lastVideoTime) {
    lastVideoTime = els.preview.currentTime;
    try { state.lastFace = state.faceDetector.detectForVideo(els.preview, now).detections[0]?.boundingBox ?? null; } catch {}
  }
  const face = state.lastFace;

  if (state.faceDetector) {
    if (!face) {
      state.centred = false;
      hint = "We cannot see your face yet. Check your lighting and look at the camera.";
    } else {
      // The face box covers roughly brow to chin, so shift up a little for the head centre.
      const c = videoToStage(face.originX + face.width / 2, face.originY + face.height * 0.42);
      const ovalRy = c.sh * OVAL.ry;
      const dx = (c.x - c.sw / 2) / ovalRy, dy = (c.y - c.sh * OVAL.cy) / ovalRy;
      const size = (face.height * c.scale) / (ovalRy * 2);
      // In the camera's own image, your left side appears on the right.
      if (size < 0.38) hint = "Move a little closer to the camera.";
      else if (size > 0.85) hint = "Lean back a little. You are slightly too close.";
      else if (dx > 0.22) hint = "Move a little to your right.";
      else if (dx < -0.22) hint = "Move a little to your left.";
      else if (dy > 0.25) hint = "Raise the camera or sit up a little.";
      else if (dy < -0.25) hint = "Lower the camera or sit down a little.";
      state.centred = size >= 0.38 && size <= 0.85 && Math.abs(dx) <= 0.22 && Math.abs(dy) <= 0.25;
    }
  } else {
    state.centred = null; // unknown without a detector
  }

  if (state.centred && !state.still) hint = "Good framing. Now try to sit still.";
  if (state.centred && state.still) hint = "You are centred and steady. Ready to record.";
  if (state.centred === null && state.still) hint = "Looking steady. Line your face up with the oval, then record.";

  const centreOk = state.centred === true;
  els.pillCentre.classList.toggle("ok", centreOk);
  els.pillCentre.classList.toggle("off", state.centred === null);
  els.pillCentre.lastElementChild.textContent =
    state.centred === null ? (state.faceDetector === null ? "Finding you" : "Line up with the oval")
    : centreOk ? "Centred" : "Not centred";
  els.pillStill.classList.toggle("ok", state.still);
  els.pillStill.lastElementChild.textContent = state.still ? "Steady" : "Hold still";

  const ready = state.still && state.centred !== false;
  if (ready) readySince ||= now; else readySince = 0;
  els.stage.classList.toggle("aligned", centreOk && state.still);
  els.hint.textContent = hint;
  els.hint.classList.toggle("good", centreOk && state.still);
}

/* ---------------- Teleprompter ---------------- */

const getScript = () => store.get(SCRIPT_KEY) || SAMPLE_SCRIPT;
const paragraphs = () => [...els.prompterText.querySelectorAll("p:not(.end)")];
const lineOffset = () => parseFloat(getComputedStyle(els.prompterWindow).getPropertyValue("--line")) || 72;

function renderScript() {
  const parts = getScript().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  els.prompterText.replaceChildren(
    ...parts.map((text) => Object.assign(document.createElement("p"), { textContent: text })),
    Object.assign(document.createElement("p"), { className: "end", textContent: "End of script" }),
  );
  measureScript();
  setScroll(0);
}

// Measures how far the text travels and how many words that covers,
// so speed can be set in words per minute regardless of text size.
function measureScript() {
  const ps = paragraphs();
  const end = els.prompterText.querySelector(".end");
  if (!ps.length || !end) return;
  const line = lineOffset();
  state.maxScroll = Math.max(0, end.offsetTop - line);
  const travel = Math.max(1, end.offsetTop - ps[0].offsetTop);
  state.wordsPerPx = countWords(getScript()) / travel;
  const lh = parseFloat(getComputedStyle(ps[0]).lineHeight) || prefs.size * 1.3;
  state.lineHeight = lh;
  els.prompterWindow.style.setProperty("--mark-top", `${line + lh / 2 - 5}px`);
}

function setScroll(y) {
  state.scrollY = Math.min(Math.max(0, y), state.maxScroll);
  els.prompterText.style.transform = `translateY(${-state.scrollY}px)`;

  // Highlight the paragraph on the reading line.
  const at = state.scrollY + lineOffset() + (state.lineHeight || 0) / 2;
  for (const p of paragraphs()) {
    const top = p.offsetTop, bottom = top + p.offsetHeight;
    p.classList.toggle("current", at >= top && at < bottom);
    p.classList.toggle("past", at >= bottom);
  }

  const pct = state.maxScroll ? state.scrollY / state.maxScroll : 0;
  els.progressFill.style.transform = `scaleX(${pct})`;
  els.progress.setAttribute("aria-valuenow", Math.round(pct * 100));
  const secsLeft = ((state.maxScroll - state.scrollY) * state.wordsPerPx / prefs.wpm) * 60;
  els.timeLeft.textContent = `${formatTime(secsLeft, false)} left`;

  const finished = state.scrollY >= state.maxScroll;
  if (finished && state.playing) setPlaying(false);
  return finished;
}

function setPlaying(on) {
  if (on && state.scrollY >= state.maxScroll) setScroll(0);
  state.playing = on;
  els.prPlay.classList.toggle("is-on", on);
  els.prPlay.querySelector("use").setAttribute("href", on ? "#i-pause" : "#i-play");
  els.prPlay.lastElementChild.textContent = on ? "Pause" : "Play";
  if (on) { state.lastTick = performance.now(); requestAnimationFrame(prompterLoop); }
}

function prompterLoop(now) {
  if (!state.playing) return;
  const dt = Math.min(0.1, (now - state.lastTick) / 1000);
  state.lastTick = now;
  const pxPerSec = state.wordsPerPx ? prefs.wpm / 60 / state.wordsPerPx : 40;
  setScroll(state.scrollY + pxPerSec * dt);
  requestAnimationFrame(prompterLoop);
}

function jumpParagraph(dir) {
  const line = lineOffset();
  const tops = paragraphs().map((p) => p.offsetTop - line);
  const target = dir > 0
    ? tops.find((t) => t > state.scrollY + 2) ?? state.maxScroll
    : [...tops].reverse().find((t) => t < state.scrollY - 2) ?? 0;
  setScroll(target);
}

function restartScript() { setScroll(0); }

function setWpm(wpm) {
  prefs.wpm = Math.min(WPM.max, Math.max(WPM.min, wpm));
  els.speedOut.textContent = `${prefs.wpm} wpm`;
  els.speedDown.disabled = prefs.wpm <= WPM.min;
  els.speedUp.disabled = prefs.wpm >= WPM.max;
  savePrefs();
  setScroll(state.scrollY);
}

function setSize(size) {
  // Keep the reading position on the same text when the size changes.
  const pct = state.maxScroll ? state.scrollY / state.maxScroll : 0;
  prefs.size = size;
  els.prompterText.style.setProperty("--prompter-size", `${size}px`);
  els.sizeSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.size) === size)));
  savePrefs();
  measureScript();
  setScroll(pct * state.maxScroll);
}

els.prPlay.addEventListener("click", () => setPlaying(!state.playing));
els.prRestart.addEventListener("click", restartScript);
els.prPrev.addEventListener("click", () => jumpParagraph(-1));
els.prNext.addEventListener("click", () => jumpParagraph(1));
els.speedDown.addEventListener("click", () => setWpm(prefs.wpm - WPM.step));
els.speedUp.addEventListener("click", () => setWpm(prefs.wpm + WPM.step));
els.sizeSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSize(Number(b.dataset.size)); });

// Scroll by hand with the wheel or a drag; a click without dragging jumps to that paragraph.
els.prompterWindow.addEventListener("wheel", (e) => { e.preventDefault(); setScroll(state.scrollY + e.deltaY * 0.6); }, { passive: false });
let drag = null;
els.prompterWindow.addEventListener("pointerdown", (e) => {
  drag = { y: e.clientY, moved: 0 };
  els.prompterWindow.setPointerCapture(e.pointerId);
});
els.prompterWindow.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  drag.moved += Math.abs(dy);
  drag.y = e.clientY;
  setScroll(state.scrollY - dy);
});
els.prompterWindow.addEventListener("pointerup", (e) => {
  if (drag && drag.moved < 4) {
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches?.(".prompter-text p:not(.end)"));
    if (hit) setScroll(hit.offsetTop - lineOffset());
  }
  drag = null;
});
new ResizeObserver(() => { const pct = state.maxScroll ? state.scrollY / state.maxScroll : 0; measureScript(); setScroll(pct * state.maxScroll); }).observe(els.prompterWindow);

/* ---------------- Settings ---------------- */

function applyPrefs() {
  setWpm(prefs.wpm);
  if (!SIZES.includes(prefs.size)) prefs.size = 32;
  setSize(prefs.size);
  els.stage.classList.toggle("mirror", prefs.mirror);
  els.stage.classList.toggle("no-guide", !prefs.guide);
  els.settingsMenu.querySelectorAll("[data-setting]").forEach((b) =>
    b.setAttribute("aria-checked", String(Boolean(prefs[b.dataset.setting]))));
}

let menuFromKeyboard = false;
function openMenu(fromKeyboard) {
  menuFromKeyboard = fromKeyboard;
  const r = els.settingsBtn.getBoundingClientRect();
  els.settingsMenu.hidden = false;
  els.settingsMenu.style.top = `${r.bottom + 4}px`;
  els.settingsMenu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  els.settingsBtn.setAttribute("aria-expanded", "true");
  els.settingsMenu.querySelector("button").focus({ preventScroll: true });
}
function closeMenu() {
  if (els.settingsMenu.hidden) return;
  els.settingsMenu.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
  // Only hand focus back for keyboard users, so Space keeps controlling the recording.
  if (menuFromKeyboard) els.settingsBtn.focus();
  else document.activeElement?.blur();
}
els.settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); els.settingsMenu.hidden ? openMenu(e.detail === 0) : closeMenu(); });
els.settingsMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  const b = e.target.closest("[data-setting]");
  if (!b) return;
  const key = b.dataset.setting;
  if (key === "mirror" && (state.phase === "recording" || state.phase === "paused")) return;
  prefs[key] = !prefs[key];
  savePrefs();
  applyPrefs();
});
els.settingsMenu.addEventListener("keydown", (e) => {
  const items = [...els.settingsMenu.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(); }
});
document.addEventListener("click", closeMenu);
addEventListener("resize", closeMenu);

els.shortcutsBtn.addEventListener("click", () => els.shortcutsDialog.showModal());

/* ---------------- Script editor ---------------- */

function updateScriptStats() {
  const words = countWords(els.scriptInput.value);
  els.scriptStats.textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · about ${formatTime((words / prefs.wpm) * 60, false)} at ${prefs.wpm} wpm`;
}
els.editScript.addEventListener("click", () => {
  setPlaying(false);
  els.scriptInput.value = getScript();
  updateScriptStats();
  els.scriptDialog.showModal();
  els.scriptInput.focus();
});
els.scriptInput.addEventListener("input", updateScriptStats);
els.scriptForm.addEventListener("submit", (e) => {
  const action = e.submitter?.value;
  if (action === "reset") { e.preventDefault(); els.scriptInput.value = SAMPLE_SCRIPT; updateScriptStats(); return; }
  if (action === "save") {
    store.set(SCRIPT_KEY, els.scriptInput.value.trim() || SAMPLE_SCRIPT);
    renderScript();
    toast("Script saved");
  }
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

// With mirroring on, frames are drawn flipped onto a canvas and that is
// what gets recorded, so playback and export match the preview exactly.
function recordingStream() {
  if (!prefs.mirror) return state.stream;
  const v = els.preview;
  const canvas = document.createElement("canvas");
  canvas.width = v.videoWidth || 1280;
  canvas.height = v.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  let active = true;
  const schedule = v.requestVideoFrameCallback ? (fn) => v.requestVideoFrameCallback(fn) : (fn) => requestAnimationFrame(fn);
  const draw = () => {
    if (!active) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    schedule(draw);
  };
  draw();
  state.canvasDraw = () => { active = false; };
  const settings = state.stream.getVideoTracks()[0]?.getSettings() || {};
  const out = canvas.captureStream(settings.frameRate || 30);
  return new MediaStream([...out.getVideoTracks(), ...state.stream.getAudioTracks()]);
}

function setStep(step) {
  const order = ["frame", "record", "export"];
  document.querySelectorAll(".steps li").forEach((li) => {
    const i = order.indexOf(li.dataset.step), cur = order.indexOf(step);
    li.classList.toggle("current", i === cur);
    li.classList.toggle("done", i < cur);
  });
}

function recordedSeconds() {
  return state.elapsed + (state.phase === "recording" ? (performance.now() - state.runStart) / 1000 : 0);
}

function setLive() {
  const labels = {
    off: "Camera off", frame: "Ready", countdown: "Get ready",
    recording: "Recording", paused: "Paused", review: "Take ready",
  };
  els.live.className = `live ${state.phase === "review" ? "done" : state.phase}`;
  els.liveLabel.textContent = labels[state.phase];

  const live = state.phase !== "review";
  els.groupLive.classList.toggle("off", !live);
  els.groupReview.classList.toggle("off", live);
  els.groupLive.inert = !live;
  els.groupReview.inert = live;

  const rolling = state.phase === "recording" || state.phase === "paused";
  els.record.classList.toggle("is-recording", rolling);
  els.recordLabel.textContent = rolling ? "Stop recording" : state.phase === "countdown" ? "Cancel" : "Start recording";
  els.record.disabled = state.phase === "off";
  els.pauseRec.classList.toggle("off", !rolling);
  els.pauseRec.inert = !rolling;
  els.pauseRec.querySelector("use").setAttribute("href", state.phase === "paused" ? "#i-play" : "#i-pause");
  els.pauseRec.lastElementChild.textContent = state.phase === "paused" ? "Resume" : "Pause";

  els.stage.classList.toggle("recording", rolling || state.phase === "countdown");
  els.settingsMenu.querySelector('[data-setting="mirror"]').disabled = rolling;
}

let countdownToken = 0;
async function startTake() {
  if (!state.stream || state.phase !== "frame") return;
  if (!window.MediaRecorder) { els.hint.textContent = "This browser cannot record video. Open the page in the latest Chrome, Safari or Edge."; return; }
  setPlaying(false);
  if (prefs.rewind) restartScript();
  setStep("record");

  if (prefs.countdown) {
    const token = ++countdownToken;
    state.phase = "countdown";
    setLive();
    els.hint.textContent = "Get ready. Your first line is on the reading line.";
    els.countdown.hidden = false;
    for (const n of [3, 2, 1]) {
      els.countdown.replaceChildren(Object.assign(document.createElement("span"), { textContent: n }));
      await new Promise((r) => setTimeout(r, 1000));
      if (token !== countdownToken) return;
    }
    els.countdown.hidden = true;
  }
  startRecording();
}

function cancelCountdown() {
  countdownToken++;
  els.countdown.hidden = true;
  state.phase = "frame";
  setStep("frame");
  setLive();
}

function startRecording() {
  const mimeType = pickMimeType();
  const stream = recordingStream();
  state.chunks = [];
  const options = { videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000, ...(mimeType && { mimeType }) };
  try { state.recorder = new MediaRecorder(stream, options); }
  catch { state.recorder = new MediaRecorder(stream); }
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = finishRecording;
  state.recorder.start(1000);

  state.phase = "recording";
  state.elapsed = 0;
  state.runStart = performance.now();
  els.hint.textContent = "";
  els.hint.classList.remove("good");
  setLive();
  if (prefs.autoplay) setPlaying(true);
  requestAnimationFrame(timerLoop);
}

function timerLoop() {
  if (state.phase !== "recording" && state.phase !== "paused") return;
  els.recTime.textContent = formatTime(recordedSeconds());
  requestAnimationFrame(timerLoop);
}

function togglePauseRecording() {
  if (state.phase === "recording") {
    state.recorder.pause();
    state.elapsed = recordedSeconds();
    state.phase = "paused";
    state.resumePrompter = state.playing;
    setPlaying(false);
    els.hint.textContent = "Recording paused. Resume when you're ready.";
  } else if (state.phase === "paused") {
    state.recorder.resume();
    state.runStart = performance.now();
    state.phase = "recording";
    if (state.resumePrompter) setPlaying(true);
    els.hint.textContent = "";
  }
  setLive();
}

function stopRecording() {
  if (state.phase !== "recording" && state.phase !== "paused") return;
  state.elapsed = recordedSeconds();
  state.phase = "review";
  setPlaying(false);
  state.recorder.stop();
}

function finishRecording() {
  state.canvasDraw?.();
  state.canvasDraw = null;
  const type = state.recorder.mimeType || "video/webm";
  state.blob = new Blob(state.chunks, { type });
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = URL.createObjectURL(state.blob);

  els.preview.hidden = true;
  els.guide.style.display = "none";
  els.stage.classList.remove("aligned");
  els.stage.querySelector(".stage-status").hidden = true;
  els.playback.src = state.blobUrl;
  els.playback.hidden = false;
  els.recTime.textContent = formatTime(state.elapsed);
  els.exportLabel.textContent = `Export video (${extFor(type).toUpperCase()})`;
  els.hint.textContent = `${formatTime(state.elapsed, false)} recorded · ${(state.blob.size / 1e6).toFixed(1)} MB. Play it back, then export or retake.`;
  setStep("export");
  setLive();
}

function resetToFrame() {
  countdownToken++;
  if (state.recorder && state.recorder.state !== "inactive") { state.recorder.onstop = null; state.recorder.stop(); }
  state.canvasDraw?.();
  state.canvasDraw = null;
  setPlaying(false);
  state.phase = state.stream ? "frame" : "off";
  els.countdown.hidden = true;
  els.playback.pause();
  els.playback.removeAttribute("src");
  els.playback.hidden = true;
  els.preview.hidden = false;
  els.guide.style.display = "";
  els.stage.querySelector(".stage-status").hidden = false;
  els.recTime.textContent = "00:00";
  els.hint.textContent = "Centre your face inside the oval and sit comfortably still.";
  setStep("frame");
  setLive();
}

els.record.addEventListener("click", () => {
  if (state.phase === "frame") startTake();
  else if (state.phase === "countdown") cancelCountdown();
  else stopRecording();
});
els.pauseRec.addEventListener("click", togglePauseRecording);
els.retake.addEventListener("click", resetToFrame);

els.exportBtn.addEventListener("click", () => {
  if (!state.blob) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const a = Object.assign(document.createElement("a"), {
    href: state.blobUrl,
    download: `testimonial-${stamp}.${extFor(state.blob.type)}`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  toast("Video exported");
});

/* ---------------- Keyboard ---------------- */

document.addEventListener("keydown", (e) => {
  if (!els.studioScreen.classList.contains("active")) return;
  if (els.scriptDialog.open || els.shortcutsDialog.open || !els.settingsMenu.hidden) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea, video")) return;
  // Let Space press a button that has keyboard focus.
  if (e.key === " " && e.target.closest("button") && e.target !== els.record) return;

  const actions = {
    " ": () => els.record.disabled || els.record.click(),
    p: () => setPlaying(!state.playing),
    k: () => setPlaying(!state.playing),
    Home: restartScript,
    "0": restartScript,
    ArrowLeft: () => jumpParagraph(-1),
    ArrowRight: () => jumpParagraph(1),
    ArrowUp: () => setWpm(prefs.wpm + WPM.step),
    ArrowDown: () => setWpm(prefs.wpm - WPM.step),
    "[": () => setSize(SIZES[Math.max(0, SIZES.indexOf(prefs.size) - 1)]),
    "]": () => setSize(SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(prefs.size) + 1)]),
    m: togglePauseRecording,
    "?": () => els.shortcutsDialog.showModal(),
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? actions[e.key];
  if (action) { e.preventDefault(); action(); }
});

/* ---------------- Boot ---------------- */

applyPrefs();
if (store.get(SESSION_KEY, sessionStorage) === "1") enterStudio();
else showScreen("login");
