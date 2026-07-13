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
const fallbackGateReadoutEl = document.getElementById("fallbackGateReadout");
const parkedAfterReadoutEl = document.getElementById("parkedAfterReadout");
const cooldownInput = document.getElementById("cooldown");
const cooldownValueEl = document.getElementById("cooldownValue");
const leadDistanceInput = document.getElementById("leadDistance");
const leadDistanceValueEl = document.getElementById("leadDistanceValue");
const yellowSoundToggle = document.getElementById("yellowSoundToggle");
const redSoundToggle = document.getElementById("redSoundToggle");
const mapPriorToggle = document.getElementById("mapPriorToggle");
const mapPriorStateEl = document.getElementById("mapPriorState");
const mapCacheReadoutEl = document.getElementById("mapCacheReadout");
const gpsFixReadoutEl = document.getElementById("gpsFixReadout");
const armBtn = document.getElementById("armBtn");
const stopBtn = document.getElementById("stopBtn");
const useGpsBtn = document.getElementById("useGpsBtn");
const mapRefreshBtn = document.getElementById("mapRefreshBtn");
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
  gps: {
    lat: null,
    lon: null,
    heading: null,
    speed: null,
    accuracy: null,
    timestamp: 0,
  },
  isStopped: false,
  isParked: false,
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
  mapPrior: {
    enabled: false,
    status: "off",
    loading: false,
    nearbyCount: 0,
    nearestDistanceM: null,
    confidence: 0,
    signalCount: 0,
    lastFetchAt: 0,
    lastQueryLat: null,
    lastQueryLon: null,
    cacheAgeMs: 0,
    source: "none",
    error: "",
  },
  soundSettings: {
    red: false,
    yellow: false,
  },
};

const APP_VERSION = "v0.7";
const FALLBACK_STATIONARY_SECONDS = 10;
const PARKED_STATIONARY_SECONDS = 420;
const MAP_CACHE_KEY = "signal-chime-map-cache-v1";
const MAP_QUERY_RADIUS_M = 275;
const MAP_REFRESH_DISTANCE_M = 85;
const MAP_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const MAP_LIKELY_CONFIDENCE = 0.75;
const MAP_NEARBY_CONFIDENCE = 0.5;
const MAP_BLOCK_FALLBACK_CONFIDENCE = 0.6;
const MAP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAP_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const SOUND_PRESETS = {
  green: [
    { frequency: 784, duration: 120, gap: 35 },
    { frequency: 988, duration: 140, gap: 0 },
  ],
  yellow: [
    { frequency: 554, duration: 110, gap: 70 },
    { frequency: 554, duration: 110, gap: 0 },
  ],
  red: [
    { frequency: 392, duration: 130, gap: 50 },
    { frequency: 392, duration: 130, gap: 50 },
    { frequency: 330, duration: 150, gap: 0 },
  ],
};

let audioContext = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRadians(lon2 - lon1)) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(toRadians(lon2 - lon1));
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

function angleDifference(a, b) {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
}

function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters)) {
    return "n/a";
  }

  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }

  return `${(meters / 1000).toFixed(1)}km`;
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "n/a";
  }

  if (ms < 60000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`;
  }

  if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  }

  if (ms < 86400000) {
    return `${Math.round(ms / 3600000)}h`;
  }

  return `${Math.round(ms / 86400000)}d`;
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadMapCache() {
  try {
    if (!window.localStorage) {
      return null;
    }

    return safeJsonParse(window.localStorage.getItem(MAP_CACHE_KEY), null);
  } catch {
    return null;
  }
}

function saveMapCache(cache) {
  try {
    if (!window.localStorage) {
      return;
    }

    window.localStorage.setItem(MAP_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    log(`map cache save failed: ${error.message}`);
  }
}

function summarizeMapStatus() {
  const { enabled, status, confidence, nearbyCount, nearestDistanceM, signalCount, source, error } = state.mapPrior;

  if (!enabled) {
    mapPriorStateEl.textContent = "off";
    mapCacheReadoutEl.textContent = "empty";
    return;
  }

  const confidencePct = `${Math.round(confidence * 100)}%`;
  const distanceText = nearestDistanceM == null ? "n/a" : formatDistanceMeters(nearestDistanceM);
  const core = `${status} | ${confidencePct} | ${nearbyCount} near | ${distanceText}`;
  mapPriorStateEl.textContent = error ? `${core} | ${error}` : core;
  const ageText = source === "live" ? "live" : state.mapPrior.cacheAgeMs > 0 ? formatAge(state.mapPrior.cacheAgeMs) : "n/a";
  mapCacheReadoutEl.textContent = signalCount > 0 ? `${signalCount} signals (${source}, ${ageText})` : `0 signals (${source}, ${ageText})`;
}

function summarizeGpsFix() {
  const { lat, lon, speed, heading, accuracy } = state.gps;

  if (lat == null || lon == null) {
    return "unknown";
  }

  const pieces = [];
  if (Number.isFinite(accuracy)) {
    pieces.push(`±${Math.round(accuracy)}m`);
  }
  if (Number.isFinite(speed)) {
    pieces.push(`${Math.round(speed * 3.6)}km/h`);
  }
  if (Number.isFinite(heading)) {
    pieces.push(`${Math.round(normalizeDegrees(heading))}°`);
  }

  return pieces.length ? pieces.join(" | ") : "locked";
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
  stoppedStateEl.textContent = state.isParked ? "parked" : state.isStopped ? "yes" : "no";
  fallbackStateEl.textContent = state.isParked ? "parked" : `armed: ${state.fallbackArmed ? "yes" : "no"}`;
  stationaryTimerEl.textContent = state.isParked ? "parked" : `${stationarySeconds().toFixed(1)}s`;
  leadDistanceReadoutEl.textContent = `${state.leadDistance.toFixed(1)}x`;
  lastAlertEl.textContent = state.lastAlertType;
  cooldownValueEl.textContent = `${cooldownInput.value} ms`;
  leadDistanceValueEl.textContent = `${Number(leadDistanceInput.value).toFixed(1)}x`;
  visionHintEl.textContent = state.visionHint;
  fallbackGateReadoutEl.textContent = `${FALLBACK_STATIONARY_SECONDS}s`;
  parkedAfterReadoutEl.textContent = "7m";
  yellowSoundToggle.checked = state.soundSettings.yellow;
  redSoundToggle.checked = state.soundSettings.red;
  mapPriorToggle.checked = state.mapPrior.enabled;
  gpsFixReadoutEl.textContent = summarizeGpsFix();
  appBadgeStateEl.textContent = state.isParked ? "parked" : `${state.detectorStatus || "idle"}`;
  appBadgeLabelEl.textContent = `Model ${APP_VERSION}`;
  summarizeMapStatus();
}

function refreshParkedState(reason = "timer") {
  const parkedNow = state.isStopped && stationarySeconds() >= PARKED_STATIONARY_SECONDS;
  if (parkedNow === state.isParked) {
    return;
  }

  state.isParked = parkedNow;
  if (parkedNow) {
    state.fallbackArmed = false;
    state.fallbackAlertedThisStop = false;
    state.pendingLeadDeparture = false;
    state.leadBaselineArea = null;
    state.leadBaselineBottom = null;
    setMode(`parked (${reason})`);
    log(`parked mode engaged after ${PARKED_STATIONARY_SECONDS}s stationary`);
  } else {
    setMode("stopped");
    log("parked mode cleared");
  }
  updateUi();
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
    state.isParked = false;
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

async function playRedSound() {
  await ensureAudio();
  await playPattern(SOUND_PRESETS.red);
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
    log(`yellow detected from ${source}`);
    if (state.soundSettings.yellow && !state.isParked) {
      await playYellowSound();
    }
    return;
  }

  if (kind === "red") {
    log(`red detected from ${source}`);
    if (state.soundSettings.red && !state.isParked) {
      await playRedSound();
    }
    return;
  }

  if (kind !== "green") {
    log(`${kind} detected from ${source} (silent)`);
    return;
  }

  log(`green alert from ${source}`, "tone-green");
  if (!state.isParked) {
    await playGreenSound();
  }
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

  if ((nextColor === "green" || nextColor === "yellow" || nextColor === "red") && (previous !== nextColor || state.lightLatchedColor !== nextColor)) {
    state.lightLatchedColor = nextColor;
    triggerAlert(nextColor, source);
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
  const mapBoost = state.mapPrior.enabled ? clamp(state.mapPrior.confidence * 0.08, 0, 0.08) : 0;
  return det.score * 0.47 + centerScore * 0.24 + upperScore * 0.19 + sizeScore * 0.1 + mapBoost;
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
  const mapAllowsFallback =
    !state.mapPrior.enabled || state.mapPrior.signalCount === 0 || state.mapPrior.confidence < MAP_BLOCK_FALLBACK_CONFIDENCE;
  const eligible =
    state.isStopped &&
    !state.isParked &&
    stationarySeconds() >= FALLBACK_STATIONARY_SECONDS &&
    state.light === "none" &&
    !trafficLightVisible &&
    mapAllowsFallback;
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

  if (state.mapPrior.enabled) {
    summary.push(`map: ${Math.round(state.mapPrior.confidence * 100)}%`);
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
  state.useGps = false;
  useGpsBtn.textContent = "Use GPS speed";
  state.gps = {
    lat: null,
    lon: null,
    heading: null,
    speed: null,
    accuracy: null,
    timestamp: 0,
  };
  if (state.mapPrior.enabled) {
    state.mapPrior.status = "waiting for gps";
    state.mapPrior.source = "none";
    state.mapPrior.loading = false;
    state.mapPrior.confidence = 0;
    state.mapPrior.nearbyCount = 0;
    state.mapPrior.nearestDistanceM = null;
    state.mapPrior.signalCount = 0;
    state.mapPrior.error = "";
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
  state.isParked = false;
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
    if (state.mapPrior.enabled) {
      state.mapPrior.status = "no gps";
      state.mapPrior.source = "none";
      state.mapPrior.loading = false;
      state.mapPrior.signalCount = 0;
      state.mapPrior.nearbyCount = 0;
      state.mapPrior.nearestDistanceM = null;
      state.mapPrior.confidence = 0;
      state.mapPrior.error = "";
      updateUi();
    }
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
      const { latitude, longitude, speed, heading, accuracy } = position.coords;
      state.gps.lat = latitude;
      state.gps.lon = longitude;
      state.gps.speed = Number.isFinite(speed) ? speed : null;
      state.gps.heading = Number.isFinite(heading) ? heading : null;
      state.gps.accuracy = Number.isFinite(accuracy) ? accuracy : null;
      state.gps.timestamp = position.timestamp || Date.now();

      if (typeof speed === "number") {
        const stopped = speed <= 0.5;
        setStopped(stopped, "gps");
        if (!stopped) {
          state.leadDistance = 0;
        }
      }

      if (state.mapPrior.enabled) {
        void refreshMapPrior(position, { reason: "gps" });
      }

      updateUi();
    },
    (error) => {
      log(`gps error: ${error.message}`);
      if (state.geoWatchId != null) {
        navigator.geolocation.clearWatch(state.geoWatchId);
        state.geoWatchId = null;
      }
      state.useGps = false;
      useGpsBtn.textContent = "Use GPS speed";
      state.gps = {
        lat: null,
        lon: null,
        heading: null,
        speed: null,
        accuracy: null,
        timestamp: 0,
      };
      if (state.mapPrior.enabled) {
        state.mapPrior.status = "waiting for gps";
        state.mapPrior.source = "none";
        state.mapPrior.loading = false;
        state.mapPrior.signalCount = 0;
        state.mapPrior.nearbyCount = 0;
        state.mapPrior.nearestDistanceM = null;
        state.mapPrior.confidence = 0;
        state.mapPrior.error = "";
      }
      updateUi();
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function buildOverpassQuery(lat, lon, radiusM) {
  return [
    "[out:json][timeout:10];",
    "(",
    `node["highway"="traffic_signals"](around:${Math.round(radiusM)},${lat},${lon});`,
    `node["crossing"="traffic_signals"](around:${Math.round(radiusM)},${lat},${lon});`,
    ");",
    "out body;",
  ].join("");
}

function extractSignalsFromOverpass(payload) {
  if (!payload || !Array.isArray(payload.elements)) {
    return [];
  }

  return payload.elements
    .filter((element) => element.type === "node" && typeof element.lat === "number" && typeof element.lon === "number")
    .map((element) => ({
      id: element.id,
      lat: element.lat,
      lon: element.lon,
      tags: element.tags || {},
    }));
}

function loadMapEntries() {
  const cache = loadMapCache();
  const entries = Array.isArray(cache?.entries) ? cache.entries : [];
  return entries.filter(
    (entry) =>
      entry &&
      typeof entry.fetchedAt === "number" &&
      typeof entry.radius === "number" &&
      entry.center &&
      typeof entry.center.lat === "number" &&
      typeof entry.center.lon === "number" &&
      Array.isArray(entry.signals)
  );
}

function pickCachedMapEntry(lat, lon, allowStale = false) {
  const entries = loadMapEntries()
    .map((entry) => ({
      ...entry,
      cacheAgeMs: Date.now() - entry.fetchedAt,
      distanceM: haversineMeters(lat, lon, entry.center.lat, entry.center.lon),
    }))
    .sort((a, b) => a.distanceM - b.distanceM);

  if (!entries.length) {
    return null;
  }

  const freshEntries = entries.filter((entry) => entry.cacheAgeMs <= MAP_CACHE_TTL_MS);
  const candidates = freshEntries.length ? freshEntries : allowStale ? entries : [];

  if (!candidates.length) {
    return null;
  }

  const best = candidates[0];
  if (best.distanceM <= best.radius + MAP_REFRESH_DISTANCE_M) {
    return best;
  }

  return best.distanceM <= 2 * best.radius ? best : null;
}

function computeMapPrior(position, signals, source, fetchedAt) {
  const coords = position?.coords || {};
  const lat = coords.latitude;
  const lon = coords.longitude;
  const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
  const heading = Number.isFinite(coords.heading) ? coords.heading : null;

  let bestSignal = null;
  let nearbyCount = 0;
  let signalCount = 0;

  for (const signal of signals) {
    if (typeof signal.lat !== "number" || typeof signal.lon !== "number") {
      continue;
    }

    signalCount += 1;
    const distanceM = haversineMeters(lat, lon, signal.lat, signal.lon);
    const distanceScore = clamp(1 - distanceM / 260, 0, 1);
    const bearing = bearingDegrees(lat, lon, signal.lat, signal.lon);
    const headingScore = heading == null ? 0.45 : clamp(1 - angleDifference(heading, bearing) / 120, 0, 1);
    const proximityBonus = distanceM < 90 ? 0.08 : distanceM < 180 ? 0.04 : 0;
    const directionBonus = signal.tags?.["traffic_signals:direction"] ? 0.05 : 0;
    const score = distanceScore * 0.68 + headingScore * 0.22 + proximityBonus + directionBonus;

    if (distanceM <= 180) {
      nearbyCount += 1;
    }

    if (!bestSignal || score > bestSignal.score) {
      bestSignal = {
        score,
        distanceM,
      };
    }
  }

  const accuracyMultiplier = accuracy == null ? 0.9 : clamp(1 - accuracy / 140, 0.35, 1);
  const rawConfidence = bestSignal ? bestSignal.score * accuracyMultiplier : 0;
  const confidence = clamp(rawConfidence, 0, 1);

  let status;
  if (!signalCount) {
    status = "no mapped lights";
  } else if (confidence >= MAP_LIKELY_CONFIDENCE) {
    status = "signal likely ahead";
  } else if (confidence >= MAP_NEARBY_CONFIDENCE) {
    status = "signal nearby";
  } else {
    status = "signal weak";
  }

  return {
    enabled: true,
    status,
    confidence,
    nearbyCount,
    signalCount,
    nearestDistanceM: bestSignal?.distanceM ?? null,
    source,
    cacheAgeMs: fetchedAt ? Date.now() - fetchedAt : 0,
    error: "",
  };
}

function applyMapPriorResult(result, source, fetchedAt, queryLat, queryLon) {
  state.mapPrior.enabled = true;
  state.mapPrior.loading = false;
  state.mapPrior.status = result.status;
  state.mapPrior.confidence = result.confidence;
  state.mapPrior.nearbyCount = result.nearbyCount;
  state.mapPrior.signalCount = result.signalCount;
  state.mapPrior.nearestDistanceM = result.nearestDistanceM;
  state.mapPrior.source = source;
  state.mapPrior.cacheAgeMs = result.cacheAgeMs;
  state.mapPrior.lastFetchAt = fetchedAt || state.mapPrior.lastFetchAt;
  state.mapPrior.lastQueryLat = queryLat ?? state.mapPrior.lastQueryLat;
  state.mapPrior.lastQueryLon = queryLon ?? state.mapPrior.lastQueryLon;
  state.mapPrior.error = result.error || "";
  updateUi();
}

function applyCachedMapPrior(position, reason = "cache") {
  const lat = position?.coords?.latitude;
  const lon = position?.coords?.longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    state.mapPrior.status = "waiting for gps";
    state.mapPrior.source = reason;
    state.mapPrior.error = "";
    state.mapPrior.loading = false;
    updateUi();
    return false;
  }

  const entry = pickCachedMapEntry(lat, lon, true);
  if (!entry) {
    state.mapPrior.status = "no cache";
    state.mapPrior.source = reason;
    state.mapPrior.loading = false;
    state.mapPrior.signalCount = 0;
    state.mapPrior.nearbyCount = 0;
    state.mapPrior.nearestDistanceM = null;
    state.mapPrior.confidence = 0;
    state.mapPrior.cacheAgeMs = 0;
    state.mapPrior.error = "";
    updateUi();
    return false;
  }

  const result = computeMapPrior(position, entry.signals, reason, entry.fetchedAt);
  applyMapPriorResult(result, reason, entry.fetchedAt, entry.center.lat, entry.center.lon);
  return true;
}

function isMapRefreshDue(position) {
  const lat = position?.coords?.latitude;
  const lon = position?.coords?.longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }

  if (!state.mapPrior.lastFetchAt) {
    return true;
  }

  if (Date.now() - state.mapPrior.lastFetchAt >= MAP_REFRESH_INTERVAL_MS) {
    return true;
  }

  if (!Number.isFinite(state.mapPrior.lastQueryLat) || !Number.isFinite(state.mapPrior.lastQueryLon)) {
    return true;
  }

  return haversineMeters(lat, lon, state.mapPrior.lastQueryLat, state.mapPrior.lastQueryLon) >= MAP_REFRESH_DISTANCE_M;
}

async function fetchMapSignals(position, reason = "manual") {
  const lat = position?.coords?.latitude;
  const lon = position?.coords?.longitude;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    state.mapPrior.status = "waiting for gps";
    state.mapPrior.source = reason;
    state.mapPrior.error = "";
    state.mapPrior.loading = false;
    updateUi();
    return;
  }

  if (!navigator.onLine) {
    state.mapPrior.status = "offline";
    state.mapPrior.source = reason;
    state.mapPrior.error = "";
    state.mapPrior.loading = false;
    updateUi();
    applyCachedMapPrior(position, "offline cache");
    return;
  }

  const query = buildOverpassQuery(lat, lon, MAP_QUERY_RADIUS_M);
  state.mapPrior.status = "loading";
  state.mapPrior.loading = true;
  state.mapPrior.source = reason;
  state.mapPrior.error = "";
  updateUi();

  let lastError = null;
  for (const endpoint of MAP_OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const signals = extractSignalsFromOverpass(payload);
      const fetchedAt = Date.now();
      const cache = loadMapCache() || { version: 1, entries: [] };
      const nextEntry = {
        fetchedAt,
        center: { lat, lon },
        radius: MAP_QUERY_RADIUS_M,
        signals,
      };

      cache.version = 1;
      cache.entries = [nextEntry, ...(Array.isArray(cache.entries) ? cache.entries : [])]
        .filter((entry) => entry && typeof entry.fetchedAt === "number")
        .sort((a, b) => b.fetchedAt - a.fetchedAt)
        .slice(0, 8);
      saveMapCache(cache);

      const result = computeMapPrior(position, signals, "live", fetchedAt);
      applyMapPriorResult(result, "live", fetchedAt, lat, lon);
      log(`map prior refreshed (${signals.length} signal${signals.length === 1 ? "" : "s"})`);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  state.mapPrior.status = "fetch failed";
  state.mapPrior.source = reason;
  state.mapPrior.error = lastError ? lastError.message : "unknown";
  state.mapPrior.loading = false;
  updateUi();

  if (!applyCachedMapPrior(position, "cached fallback")) {
    log(`map fetch failed: ${state.mapPrior.error}`);
  } else {
    log(`map fetch failed, using cache: ${state.mapPrior.error}`);
  }
}

async function refreshMapPrior(position, { reason = "manual", force = false } = {}) {
  if (!state.mapPrior.enabled) {
    state.mapPrior.status = "off";
    state.mapPrior.source = "none";
    state.mapPrior.error = "";
    updateUi();
    return;
  }

  if (state.mapPrior.loading && !force) {
    applyCachedMapPrior(position, "cached");
    return;
  }

  if (!force && !isMapRefreshDue(position)) {
    applyCachedMapPrior(position, "cached");
    return;
  }

  await fetchMapSignals(position, reason);
}

function setMapPriorEnabled(nextEnabled, reason = "manual") {
  state.mapPrior.enabled = nextEnabled;
  if (!nextEnabled) {
    state.mapPrior.status = "off";
    state.mapPrior.loading = false;
    state.mapPrior.confidence = 0;
    state.mapPrior.nearbyCount = 0;
    state.mapPrior.signalCount = 0;
    state.mapPrior.nearestDistanceM = null;
    state.mapPrior.source = "none";
    state.mapPrior.error = "";
    updateUi();
    log("map prior disabled");
    return;
  }

  log(`map prior enabled (${reason})`);
  if (state.gps.lat != null && state.gps.lon != null) {
    void refreshMapPrior(
      {
        coords: {
          latitude: state.gps.lat,
          longitude: state.gps.lon,
          accuracy: state.gps.accuracy,
          heading: state.gps.heading,
          speed: state.gps.speed,
        },
      },
      { reason, force: true }
    );
  } else {
    state.mapPrior.status = "waiting for gps";
    state.mapPrior.error = "";
    updateUi();
  }

  if (state.geoWatchId == null) {
    startGpsWatch();
  }
}

function maybeTriggerFallbackFromManualLead() {
  if (state.isParked) {
    log("fallback cue ignored while parked");
    return;
  }

  state.fallbackArmed = true;
  state.pendingLeadDeparture = true;
  if (state.isStopped && !state.isParked && stationarySeconds() >= FALLBACK_STATIONARY_SECONDS && state.light === "none") {
    state.fallbackAlertedThisStop = true;
    triggerAlert("green", "manual lead-car cue");
  } else {
    log(`fallback cue ignored until stopped ${FALLBACK_STATIONARY_SECONDS}s with no light`);
  }
  updateUi();
}

function startLoops() {
  if (state.stateTickId == null) {
    state.stateTickId = setInterval(() => {
      refreshParkedState("timer");
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
mapRefreshBtn.addEventListener("click", () => {
  if (!state.mapPrior.enabled) {
    setMapPriorEnabled(true, "manual refresh");
    return;
  }
  if (state.gps.lat != null && state.gps.lon != null) {
    void refreshMapPrior(
      {
        coords: {
          latitude: state.gps.lat,
          longitude: state.gps.lon,
          accuracy: state.gps.accuracy,
          heading: state.gps.heading,
          speed: state.gps.speed,
        },
      },
      { reason: "manual", force: true }
    );
  } else {
    log("map refresh waiting for GPS fix");
    state.mapPrior.status = "waiting for gps";
    updateUi();
  }
});
leadBtn.addEventListener("click", () => {
  maybeTriggerFallbackFromManualLead();
});
stopSimBtn.addEventListener("click", () => {
  setStopped(!state.isStopped, "manual toggle");
});
yellowSoundToggle.addEventListener("change", () => {
  state.soundSettings.yellow = yellowSoundToggle.checked;
  updateUi();
  log(`yellow sound ${state.soundSettings.yellow ? "enabled" : "disabled"}`);
});
redSoundToggle.addEventListener("change", () => {
  state.soundSettings.red = redSoundToggle.checked;
  updateUi();
  log(`red sound ${state.soundSettings.red ? "enabled" : "disabled"}`);
});
mapPriorToggle.addEventListener("change", () => {
  setMapPriorEnabled(mapPriorToggle.checked, "toggle");
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

window.addEventListener("online", () => {
  if (state.mapPrior.enabled && state.gps.lat != null && state.gps.lon != null) {
    void refreshMapPrior(
      {
        coords: {
          latitude: state.gps.lat,
          longitude: state.gps.lon,
          accuracy: state.gps.accuracy,
          heading: state.gps.heading,
          speed: state.gps.speed,
        },
      },
      { reason: "online", force: true }
    );
  }
});

window.addEventListener("offline", () => {
  if (state.mapPrior.enabled) {
    state.mapPrior.status = "offline";
    state.mapPrior.source = "offline";
    updateUi();
  }
});

setMode("waiting");
setStopped(false, "initial");
setObservedLight("none", 0, "init");
updateUi();
log("ready for camera and sound tests");
refreshParkedState("initial");
summarizeMapStatus();
void registerServiceWorker();
