const video = document.getElementById("video");
const analysisCanvas = document.getElementById("analysis");
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
const logEl = document.getElementById("log");
const cameraPill = document.getElementById("cameraPill");
const audioPill = document.getElementById("audioPill");
const lightStateEl = document.getElementById("lightState");
const confidenceStateEl = document.getElementById("confidenceState");
const stoppedStateEl = document.getElementById("stoppedState");
const fallbackStateEl = document.getElementById("fallbackState");
const stationaryTimerEl = document.getElementById("stationaryTimer");
const leadDistanceReadoutEl = document.getElementById("leadDistanceReadout");
const lastAlertEl = document.getElementById("lastAlert");
const modeStateEl = document.getElementById("modeState");
const visionHintEl = document.getElementById("visionHint");
const appBadgeStateEl = document.getElementById("appBadgeState");
const appBadgeLabelEl = document.querySelector(".app-badge__label");
const cooldownInput = document.getElementById("cooldown");
const cooldownValueEl = document.getElementById("cooldownValue");
const leadDistanceInput = document.getElementById("leadDistance");
const leadDistanceValueEl = document.getElementById("leadDistanceValue");
const armBtn = document.getElementById("armBtn");
const stopBtn = document.getElementById("stopBtn");
const useGpsBtn = document.getElementById("useGpsBtn");
const leadBtn = document.getElementById("leadBtn");
const stopSimBtn = document.getElementById("stopSimBtn");

const state = {
  running: false,
  audioReady: false,
  detectorReady: false,
  detectorLoading: false,
  detector: null,
  stream: null,
  geoWatchId: null,
  stateTickId: null,
  visionTickId: null,
  frameBusy: false,
  useGps: false,
  isStopped: false,
  stationarySince: null,
  lastAlertAt: 0,
  lastAlertType: "none",
  light: "none",
  lightConfidence: 0,
  lightLossFrames: 0,
  lightLatchedColor: "none",
  fallbackArmed: false,
  fallbackAlertedThisStop: false,
  leadDistance: 0,
  leadBaselineArea: null,
  leadBaselineBottom: null,
  leadLastArea: null,
  leadLastBottom: null,
  pendingLeadDeparture: false,
  detectorStatus: "idle",
  visionHint: "idle",
};

const APP_VERSION = "v0.3";

const SOUND_PRESETS = {
  green: [
    { frequency: 784, duration: 120, gap: 35 },
    { frequency: 988, duration: 140, gap: 0 },
  ],
  yellow: [
    { frequency: 554, duration: 110, gap: 70 },
    { frequency: 554, duration: 110, gap: 0 },
  ],
};

let audioContext = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function log(message, tone = "tone-muted") {
  const row = document.createElement("div");
  row.className = `log-entry ${tone}`;
  row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(row);
}

function setMode(text) {
  modeStateEl.textContent = text;
}

function stationarySeconds() {
  if (!state.isStopped || state.stationarySince == null) {
    return 0;
  }
  return (Date.now() - state.stationarySince) / 1000;
}

function updateUi() {
  cameraPill.textContent = state.running ? "camera live" : "idle";
  audioPill.textContent = state.audioReady ? "audio armed" : "audio locked";
  lightStateEl.textContent = state.light;
  confidenceStateEl.textContent = `${Math.round(state.lightConfidence * 100)}%`;
  stoppedStateEl.textContent = state.isStopped ? "yes" : "no";
  fallbackStateEl.textContent = `armed: ${state.fallbackArmed ? "yes" : "no"}`;
  stationaryTimerEl.textContent = `${stationarySeconds().toFixed(1)}s`;
  leadDistanceReadoutEl.textContent = `${state.leadDistance.toFixed(1)}x`;
  lastAlertEl.textContent = state.lastAlertType;
  cooldownValueEl.textContent = `${cooldownInput.value} ms`;
  leadDistanceValueEl.textContent = `${Number(leadDistanceInput.value).toFixed(1)}x`;
  visionHintEl.textContent = state.visionHint;
  appBadgeStateEl.textContent = `${state.detectorStatus || "idle"}`;
  appBadgeLabelEl.textContent = `Model ${APP_VERSION}`;
}

function setStopped(nextStopped, reason = "manual") {
  state.isStopped = nextStopped;
  if (nextStopped) {
    if (state.stationarySince == null) {
      state.stationarySince = Date.now();
    }
  } else {
    state.stationarySince = null;
    state.fallbackArmed = false;
    state.fallbackAlertedThisStop = false;
    state.leadBaselineArea = null;
    state.leadBaselineBottom = null;
    state.pendingLeadDeparture = false;
  }

  setMode(nextStopped ? `stopped (${reason})` : "moving");
  updateUi();
}

async function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state !== "running") {
    await audioContext.resume();
  }

  state.audioReady = true;
  updateUi();
}

function playTone(frequency, duration, gainValue = 0.08) {
  if (!audioContext) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = gainValue;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration / 1000);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      resolve();
    };
  });
}

async function playPattern(pattern) {
  for (const step of pattern) {
    await playTone(step.frequency, step.duration);
    if (step.gap) {
      await new Promise((resolve) => setTimeout(resolve, step.gap));
    }
  }
}

async function playGreenSound() {
  await ensureAudio();
  await playPattern(SOUND_PRESETS.green);
}

async function playYellowSound() {
  await ensureAudio();
  await playPattern(SOUND_PRESETS.yellow);
}

function shouldCooldownBlock() {
  return Date.now() - state.lastAlertAt < Number(cooldownInput.value);
}

async function triggerAlert(kind, source) {
  if (shouldCooldownBlock()) {
    log(`${kind} alert blocked by cooldown (${source})`);
    return;
  }

  state.lastAlertAt = Date.now();
  state.lastAlertType = kind;
  updateUi();

  if (kind === "yellow") {
    log(`yellow alert from ${source}`, "tone-yellow");
    await playYellowSound();
    return;
  }

  if (kind !== "green") {
    log(`${kind} detected from ${source} (silent)`);
    return;
  }

  log(`green alert from ${source}`, "tone-green");
  await playGreenSound();
}

function setObservedLight(nextColor, confidence, source) {
  const previous = state.light;
  state.light = nextColor;
  state.lightConfidence = confidence;
  updateUi();

  if (nextColor === "none") {
    state.lightLossFrames = 0;
    if (previous !== "none") {
      state.lightLatchedColor = "none";
    }
    return;
  }

  if ((nextColor === "green" || nextColor === "yellow") && (previous !== nextColor || state.lightLatchedColor !== nextColor)) {
    state.lightLatchedColor = nextColor;
    triggerAlert(nextColor, source);
  } else if (nextColor === "red" && (previous !== "red" || state.lightLatchedColor !== "red")) {
    state.lightLatchedColor = "red";
    log(`red detected from ${source} (silent)`);
  }
}

function rgbToHue(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue;
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }

  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }

  return hue;
}

function classifyTrafficLightColor(bbox) {
  const [rawX, rawY, rawW, rawH] = bbox;
  const padX = rawW * 0.12;
  const padY = rawH * 0.12;
  const x = Math.max(0, Math.floor(rawX + padX));
  const y = Math.max(0, Math.floor(rawY + padY));
  const w = Math.max(1, Math.floor(rawW - padX * 2));
  const h = Math.max(1, Math.floor(rawH - padY * 2));
  const safeW = Math.min(w, analysisCanvas.width - x);
  const safeH = Math.min(h, analysisCanvas.height - y);

  if (safeW <= 1 || safeH <= 1) {
    return { color: "none", confidence: 0 };
  }

  const image = analysisCtx.getImageData(x, y, safeW, safeH).data;
  let redWeight = 0;
  let yellowWeight = 0;
  let greenWeight = 0;
  let sampled = 0;

  const step = 4;
  for (let offset = 0; offset < image.length; offset += step * 4) {
    const r = image[offset];
    const g = image[offset + 1];
    const b = image[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 70) {
      continue;
    }

    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.25) {
      continue;
    }

    const hue = rgbToHue(r, g, b);
    const weight = (max / 255) * saturation;
    sampled += weight;

    if (hue < 28 || hue >= 340) {
      redWeight += weight;
    } else if (hue >= 28 && hue < 85) {
      yellowWeight += weight;
    } else if (hue >= 85 && hue <= 170) {
      greenWeight += weight;
    }
  }

  if (sampled < 0.2) {
    return { color: "none", confidence: 0 };
  }

  const scores = [
    { color: "red", score: redWeight },
    { color: "yellow", score: yellowWeight },
    { color: "green", score: greenWeight },
  ].sort((a, b) => b.score - a.score);

  const winner = scores[0];
  const runnerUp = scores[1];
  const confidence = winner.score / (sampled || 1);

  if (winner.score < 0.15 || confidence < 0.32 || winner.score <= runnerUp.score * 1.1) {
    return { color: "none", confidence };
  }

  return { color: winner.color, confidence };
}

function scoreTrafficLightCandidate(det) {
  const [x, y, w, h] = det.bbox;
  const cx = (x + w / 2) / analysisCanvas.width;
  const cy = (y + h / 2) / analysisCanvas.height;
  const centerDistance = Math.hypot(cx - 0.5, cy - 0.38);
  const centerScore = clamp(1 - centerDistance / 0.75, 0, 1);
  const upperScore = clamp(1 - cy / 0.95, 0, 1);
  const sizeScore = clamp(Math.sqrt((w * h) / (analysisCanvas.width * analysisCanvas.height)) * 4, 0, 1);
  return det.score * 0.45 + centerScore * 0.25 + upperScore * 0.2 + sizeScore * 0.1;
}

function scoreLeadCarCandidate(det) {
  const [x, y, w, h] = det.bbox;
  const cx = (x + w / 2) / analysisCanvas.width;
  const cy = (y + h / 2) / analysisCanvas.height;
  const centerDistance = Math.hypot(cx - 0.5, cy - 0.68);
  const centerScore = clamp(1 - centerDistance / 0.8, 0, 1);
  const lowerScore = clamp(cy / 1.05, 0, 1);
  const sizeScore = clamp(Math.sqrt((w * h) / (analysisCanvas.width * analysisCanvas.height)) * 3.2, 0, 1);
  return det.score * 0.4 + centerScore * 0.25 + lowerScore * 0.25 + sizeScore * 0.1;
}

function selectBestDetection(detections, scorer) {
  return detections
    .map((det) => ({ det, score: scorer(det) }))
    .sort((a, b) => b.score - a.score)[0]?.det || null;
}

function updateLeadTracking(leadDetection, trafficLightVisible) {
  const eligible =
    state.isStopped && stationarySeconds() >= 5 && state.light === "none" && !trafficLightVisible;
  state.fallbackArmed = eligible;

  if (!eligible) {
    state.leadBaselineArea = null;
    state.leadBaselineBottom = null;
    state.pendingLeadDeparture = false;
    state.fallbackAlertedThisStop = false;
    return;
  }

  if (!leadDetection) {
    state.pendingLeadDeparture = false;
    return;
  }

  const [x, y, w, h] = leadDetection.bbox;
  const area = w * h;
  const bottom = y + h;
  state.leadDistance = area > 0 ? clamp(9000 / Math.sqrt(area), 0.5, 9.9) : 0;

  if (state.leadBaselineArea == null) {
    state.leadBaselineArea = area;
    state.leadBaselineBottom = bottom;
    state.pendingLeadDeparture = false;
    return;
  }

  const areaRatio = area / state.leadBaselineArea;
  const movedUp = bottom < state.leadBaselineBottom - 10;
  const shrankEnough = areaRatio < Number(leadDistanceInput.value) / 2.2;
  state.pendingLeadDeparture = movedUp && shrankEnough;

  if (state.pendingLeadDeparture && !state.fallbackAlertedThisStop) {
    state.fallbackAlertedThisStop = true;
    triggerAlert("green", "lead-car fallback");
  }
}

function updateVisionStatus(detections, selectedLight, leadDetection, colorResult) {
  const summary = [];
  summary.push(`objects: ${detections.length}`);

  if (selectedLight) {
    summary.push(`light: ${selectedLight.score.toFixed(2)} raw`);
  }

  if (leadDetection) {
    summary.push(`lead: ${leadDetection.score.toFixed(2)} raw`);
  }

  if (colorResult?.color && colorResult.color !== "none") {
    summary.push(`color: ${colorResult.color}`);
  }

  state.visionHint = summary.join(" | ");
  setMode(summary.join(" | "));
  updateUi();
}

async function processVisionFrame() {
  if (!state.running || state.frameBusy || !state.detectorReady || !state.detector) {
    return;
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  state.frameBusy = true;

  try {
    analysisCtx.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const detections = await state.detector.detect(analysisCanvas, 20, 0.35);
    const lightCandidates = detections.filter((det) => det.class === "traffic light");
    const carCandidates = detections.filter((det) => det.class === "car");

    const selectedLight = selectBestDetection(lightCandidates, scoreTrafficLightCandidate);
    const leadDetection = selectBestDetection(carCandidates, scoreLeadCarCandidate);

    let colorResult = { color: "none", confidence: 0 };
    if (selectedLight) {
      colorResult = classifyTrafficLightColor(selectedLight.bbox);
    }

    if (selectedLight && colorResult.color !== "none") {
      state.lightLossFrames = 0;
      state.leadBaselineArea = null;
      state.leadBaselineBottom = null;
      state.fallbackArmed = false;
      state.fallbackAlertedThisStop = false;
      state.pendingLeadDeparture = false;
      setObservedLight(colorResult.color, colorResult.confidence * selectedLight.score, "vision");
    } else {
      state.lightLossFrames += 1;
      if (state.lightLossFrames >= 3) {
        setObservedLight("none", 0, "vision");
      }
      if (state.light !== "green" && state.light !== "yellow") {
        updateLeadTracking(leadDetection, Boolean(selectedLight));
      }
    }

    updateVisionStatus(detections, selectedLight, leadDetection, colorResult);
  } catch (error) {
    log(`vision error: ${error.message}`);
    state.detectorStatus = "error";
    setMode("vision error");
  } finally {
    state.frameBusy = false;
  }
}

async function loadDetector() {
  if (state.detector) {
    return state.detector;
  }

  if (state.detectorLoading) {
    return state.detector;
  }

  state.detectorLoading = true;
  state.detectorStatus = "loading";
  setMode("loading vision model");
  log("loading local traffic-light detector");

  try {
    await tf.ready();
    try {
      await tf.setBackend("webgl");
      await tf.ready();
    } catch {
      await tf.setBackend("cpu");
      await tf.ready();
    }

    log(`tfjs backend: ${tf.getBackend()}`);
    state.detector = await cocoSsd.load({
      base: "lite_mobilenet_v2",
      modelUrl: "./models/coco-ssd/model.json",
    });
    state.detectorReady = true;
    state.detectorStatus = "ready";
    setMode("vision ready");
    log("vision model loaded", "tone-green");
    return state.detector;
  } catch (error) {
    state.detectorStatus = "error";
    setMode("model load failed");
    log(`vision model failed: ${error.message}`);
    state.detectorLoading = false;
    throw error;
  } finally {
    state.detectorLoading = false;
  }
}

function setVideoCanvasSize() {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const targetWidth = Math.min(640, sourceWidth);
  const targetHeight = Math.max(1, Math.round((targetWidth * sourceHeight) / sourceWidth));
  analysisCanvas.width = targetWidth;
  analysisCanvas.height = targetHeight;
}

async function startCamera() {
  if (state.running) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.videoWidth > 0) {
        resolve();
        return;
      }

      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        resolve();
      };
      video.addEventListener("loadedmetadata", onReady);
    });

    setVideoCanvasSize();
    state.running = true;
    setMode("camera active");
    log("camera started");
    startLoops();
    updateUi();
    await loadDetector();
  } catch (error) {
    setMode("camera error");
    log(`camera failed: ${error.message}`);
  }
}

function stopCamera() {
  state.running = false;

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  if (state.geoWatchId != null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }

  if (state.stateTickId != null) {
    clearInterval(state.stateTickId);
    state.stateTickId = null;
  }

  if (state.visionTickId != null) {
    clearInterval(state.visionTickId);
    state.visionTickId = null;
  }

  state.stationarySince = null;
  state.fallbackArmed = false;
  state.fallbackAlertedThisStop = false;
  state.leadBaselineArea = null;
  state.leadBaselineBottom = null;
  state.pendingLeadDeparture = false;
  setMode("stopped");
  log("system stopped");
  updateUi();
}

function startGpsWatch() {
  if (!navigator.geolocation) {
    log("geolocation unavailable");
    return;
  }

  if (state.geoWatchId != null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
    state.useGps = false;
    useGpsBtn.textContent = "Use GPS speed";
    log("gps watch stopped");
    return;
  }

  state.useGps = true;
  useGpsBtn.textContent = "Stop GPS speed";
  log("gps watch started");

  state.geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const speed = position.coords.speed;
      if (typeof speed === "number") {
        const stopped = speed <= 0.5;
        setStopped(stopped, "gps");
        if (!stopped) {
          state.leadDistance = 0;
        }
        updateUi();
      }
    },
    (error) => {
      log(`gps error: ${error.message}`);
      if (state.geoWatchId != null) {
        navigator.geolocation.clearWatch(state.geoWatchId);
        state.geoWatchId = null;
      }
      state.useGps = false;
      useGpsBtn.textContent = "Use GPS speed";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function maybeTriggerFallbackFromManualLead() {
  state.fallbackArmed = true;
  state.pendingLeadDeparture = true;
  if (state.isStopped && stationarySeconds() >= 5 && state.light === "none") {
    state.fallbackAlertedThisStop = true;
    triggerAlert("green", "manual lead-car cue");
  } else {
    log("fallback cue ignored until stopped 5s with no light");
  }
  updateUi();
}

function startLoops() {
  if (state.stateTickId == null) {
    state.stateTickId = setInterval(() => {
      updateUi();
    }, 200);
  }

  if (state.visionTickId == null) {
    state.visionTickId = setInterval(() => {
      void processVisionFrame();
    }, 700);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
    log("offline cache ready");
  } catch (error) {
    log(`service worker unavailable: ${error.message}`);
  }
}

armBtn.addEventListener("click", async () => {
  await ensureAudio();
  await startCamera();
  log("audio armed");
});

stopBtn.addEventListener("click", stopCamera);
useGpsBtn.addEventListener("click", startGpsWatch);
leadBtn.addEventListener("click", () => {
  maybeTriggerFallbackFromManualLead();
});
stopSimBtn.addEventListener("click", () => {
  setStopped(!state.isStopped, "manual toggle");
});

cooldownInput.addEventListener("input", updateUi);
leadDistanceInput.addEventListener("input", updateUi);

document.querySelectorAll("[data-light]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextColor = button.dataset.light;
    const confidence = nextColor === "none" ? 0 : 0.96;
    setObservedLight(nextColor, confidence, "manual test");
    if (nextColor === "green") {
      state.fallbackAlertedThisStop = true;
    } else if (nextColor === "none") {
      state.fallbackArmed = false;
      state.leadBaselineArea = null;
      state.leadBaselineBottom = null;
      state.pendingLeadDeparture = false;
    }
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    log("page hidden");
  }
});

  setMode("waiting");
  setStopped(false, "initial");
  setObservedLight("none", 0, "init");
  updateUi();
  log("ready for camera and sound tests");
void registerServiceWorker();
