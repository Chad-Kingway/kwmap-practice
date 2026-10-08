import { accessKey, accessToken } from "../config.js";
import { loadSdk } from "../sdk.js";
import { validateEndpoints, parseCoordinate, validCoordinate } from "./proj01-route.js";
import { modelRotationFromBearing } from "./proj01-heading.js";
import { mountRequestList } from "./proj01-requests.js";
import { generateRandomEndpoints } from "./proj01-random-request.js";
import { mountRequestMap } from "./proj01-request-map.js";
import { createTransport } from "./proj01-transport.js";
import { createModelSettings } from "./proj01-model-settings.js";
import { mountPoiToggle } from "./proj01-map-display.js";
import { createSimulationClock } from "./proj01-clock.js";
import { createPlayback } from "./proj01-playback.js";
import { createFollowCamera } from "./proj01-camera.js";
import "./proj01.css";

const MODEL_URL = "/models/car/scene.gltf";
// 請不要改INITIAL_ROTATION
const INITIAL_ROTATION = { x: 90, y: 180, z: 0 };
const MODEL_INITIAL_SCALE = 10;
const FOLLOW_CAMERA = { pitch: 65, zoom: 18 };
const DEFAULT_ORIGIN = [121.561, 25.0334];
const RANDOM_REQUEST_OPTIONS = {
  range: { minLng: 121.5102, maxLng: 121.5693, minLat: 25.03068, maxLat: 25.06026 },
  minDistanceMeters: 200, maxAttempts: 20,
};
const FOLLOW_DRAG_THRESHOLD = 5;
let disposePanelWheel;
let disposeMapDrag;
let disposeMapPick;
let disposeRequests;
let disposeTransport;
let disposePlayback;
let disposeRequestMap;
let disposeMapDisplay;
let requestMapVersion = 0;
let disposePage;

async function checkModelAssets() {
  const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`缺少模型素材：${MODEL_URL}。請將 scene.gltf、scene.bin 與所需貼圖依原相對路徑放入 public/models/car/。`);
  }
  let gltf;
  try {
    gltf = await response.json();
    if (gltf.asset?.version !== "2.0") throw new Error();
  } catch {
    throw new Error(`模型格式無效：${MODEL_URL}，請提供有效的 glTF 2.0 素材。`);
  }
  const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])]
    .map(({ uri }) => uri).filter((uri) => uri && !uri.startsWith("data:"));
  await Promise.all([...new Set(uris)].map(async (uri) => {
    const url = new URL(uri, new URL(MODEL_URL, window.location.origin));
    const asset = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (!asset.ok || asset.headers.get("content-type")?.includes("text/html")) {
      throw new Error(`模型相依素材不存在：${url.pathname}。請保留原始目錄結構與檔名。`);
    }
  }));
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export async function init() {
  // 每次初始化先清除上一個面板與地圖的監聽；完整頁面切換則由瀏覽器釋放。
  disposePage?.();
  disposeTransport?.();
  disposePlayback?.();
  disposePanelWheel?.();
  disposeMapDrag?.();
  disposeMapPick?.();
  disposeMapDisplay?.();
  const requestMapRun = ++requestMapVersion;
  disposeRequestMap?.();
  disposeRequests?.();
  document.title = "proj01：3D 模型與路徑實驗室";
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="proj01-layout">
    <aside id="proj01-panel" class="proj01-panel" aria-label="模型與路徑控制面板">
      <a href="/">← 返回首頁</a>
      <h1>proj01：3D 模型與路徑實驗室</h1>
      <p id="proj01-status" role="status" aria-live="polite">正在檢查模型素材…</p>
      <p id="proj01-error" role="alert" hidden></p>
      <details class="proj01-global-settings" open>
        <summary class="proj01-global-summary">全域設定</summary>
        <div class="proj01-global-controls">
          <div class="proj01-global-row">
            <label for="proj01-scale">模型比例</label>
            <input id="proj01-scale" type="number" min="0.1" max="1000" step="0.1" value="${MODEL_INITIAL_SCALE}" disabled>
            <button id="proj01-apply-scale" type="button" disabled>套用</button>
          </div>
          <div class="proj01-global-row">
            <label for="proj01-speed">模擬速度</label>
            <input id="proj01-speed" type="range" min="1" max="300" step="1" value="60" disabled>
            <output id="proj01-speed-value" for="proj01-speed" class="proj01-unit">60×</output>
          </div>
        </div>
      </details>
      <fieldset class="proj01-requests">
        <legend>需求管理</legend>
        <section class="proj01-manual-request" aria-label="手動新增需求">
          <div class="proj01-draft-actions">
            <button id="proj01-select-origin" type="button" aria-pressed="false" disabled>選取起點</button>
            <button id="proj01-select-destination" type="button" aria-pressed="false" disabled>選取終點</button>
            <button id="proj01-toggle-coordinates" type="button" aria-expanded="false" aria-controls="proj01-coordinate-inputs">輸入座標</button>
          </div>
          <div id="proj01-coordinate-preview" class="proj01-coordinate-preview">
            <p>起點：<span id="proj01-origin-preview">未設定</span></p>
            <p>終點：<span id="proj01-destination-preview">未設定</span></p>
          </div>
          <div id="proj01-coordinate-inputs" hidden>
            <label for="proj01-origin">起點</label>
            <input id="proj01-origin" type="text" placeholder="lng, lat">
            <label for="proj01-destination">終點</label>
            <input id="proj01-destination" type="text" placeholder="lng, lat">
          </div>
          <button id="proj01-add-request" type="button">新增需求</button>
        </section>
        <button id="proj01-random-request" type="button">隨機需求</button>
        <div id="proj01-request-list"></div>
      </fieldset>
      <details class="proj01-vehicle" open>
        <summary class="proj01-vehicle-summary"><span>車輛 01</span><button id="proj01-locate" type="button" aria-label="定位車輛 01" disabled>定位</button></summary>
        <fieldset id="proj01-vehicle-controls" class="proj01-vehicle-controls" disabled>
          <legend class="proj01-visually-hidden">車輛 01 設定</legend>
          <p id="proj01-vehicle-status" role="status" aria-live="polite">尚未就緒</p>
          <button id="proj01-transport" type="button">接送此需求</button>
          <button id="proj01-auto-transport" type="button" title="依車輛與需求起點的直線距離選擇">自動接送一筆</button>
          <section class="proj01-vehicle-section">
              <button id="proj01-follow" type="button">鏡頭跟隨模型</button>
          </section>
        </fieldset>
      </details>
    </aside>
    <div class="proj01-map-region">
      <div id="map" aria-label="3D 地圖"></div>
      <div class="proj01-map-tools">
        <button id="proj01-poi-toggle" class="proj01-map-tool" type="button" title="隱藏地點圖標" aria-label="隱藏地點圖標" aria-pressed="false" disabled>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
            <circle cx="12" cy="10" r="2.5" />
            <path class="proj01-poi-hidden-mark" d="m3 3 18 18" />
          </svg>
        </button>
      </div>
    </div>
    </div>
  `;
  const panel = document.getElementById("proj01-panel");
  const requestList = mountRequestList(document.getElementById("proj01-request-list"));
  disposeRequests = requestList.dispose;
  // 面板保留原生捲動，不讓滾輪影響地圖。
  const stopPanelWheel = (event) => event.stopPropagation();
  panel.addEventListener("wheel", stopPanelWheel, { passive: true });
  disposePanelWheel = () => panel.removeEventListener("wheel", stopPanelWheel);
  const ui = Object.fromEntries(["status", "error", "vehicle-status", "transport", "auto-transport", "vehicle-controls", "scale", "apply-scale", "speed", "speed-value", "follow", "locate", "origin", "destination", "add-request", "select-origin", "select-destination", "toggle-coordinates", "coordinate-inputs", "coordinate-preview", "origin-preview", "destination-preview"]
    .map((name) => [name, document.getElementById(`proj01-${name}`)]));
  const syncDraft = () => {
    for (const endpoint of ["origin", "destination"]) ui[`${endpoint}-preview`].textContent = ui[endpoint].value || "未設定";
  };
  let coordinatesExpanded = false;
  const setCoordinatesExpanded = (expanded) => {
    // 隱藏輸入區前將內部焦點移回切換鈕，原始草稿不作解析或修正。
    if (!expanded && ui["coordinate-inputs"].contains(document.activeElement)) ui["toggle-coordinates"].focus();
    coordinatesExpanded = expanded;
    ui["coordinate-inputs"].hidden = !expanded;
    ui["coordinate-preview"].hidden = expanded;
    ui["toggle-coordinates"].setAttribute("aria-expanded", String(expanded));
    ui["toggle-coordinates"].textContent = expanded ? "收合座標" : "輸入座標";
    syncDraft();
  };
  setCoordinatesExpanded(false);
  ui["toggle-coordinates"].addEventListener("click", () => setCoordinatesExpanded(!coordinatesExpanded));
  let map;
  const modelSettings = createModelSettings({ initialScale: MODEL_INITIAL_SCALE, redraw: () => map.redraw() });
  const simulationSettings = { speedMultiplier: 60 };
  const syncSpeed = () => {
    ui["speed-value"].textContent = `${simulationSettings.speedMultiplier}×`;
    ui.speed.setAttribute("aria-valuetext", `${simulationSettings.speedMultiplier} 倍`);
  };
  ui.speed.value = String(simulationSettings.speedMultiplier);
  syncSpeed();
  let model;
  let sdk;
  let directions;
  let moving = false;
  let transport;
  let taskLineId = null;
  let wantsFollow = false;
  let playback;
  let followCamera;
  let travelBearing = 0;
  let ready = false;
  let pickMode = null;
  const status = (message) => { ui.status.textContent = message; };
  const showError = (error) => {
    ui.error.textContent = error.message || String(error);
    ui.error.hidden = false;
  };
  const clearError = () => { ui.error.hidden = true; ui.error.textContent = ""; };
  const syncControls = () => {
    // 需求草稿獨立於車輛停用範圍，接送期間仍可新增。
    ui["vehicle-controls"].disabled = !ready;
    ui.scale.disabled = ui["apply-scale"].disabled = !modelSettings.canApply();
    ui.speed.disabled = !ready;
    ui.transport.disabled = !transport?.canStart();
    ui["auto-transport"].disabled = !transport?.canStartNearest();
    ui.follow.disabled = !ready || wantsFollow;
    ui.locate.disabled = !ready || wantsFollow;
    for (const endpoint of ["origin", "destination"]) {
      ui[`select-${endpoint}`].disabled = !ready || moving || transport?.busy;
      ui[`select-${endpoint}`].setAttribute("aria-pressed", String(pickMode === endpoint));
    }
  };
  const number = (input) => {
    if (!input.checkValidity() || input.value === "" || !Number.isFinite(input.valueAsNumber)) {
      throw new Error(`請輸入有效數值（${input.min}～${input.max}）。`);
    }
    return input.valueAsNumber;
  };
  const setBearing = (bearing) => {
    // 設定目標 Z 角度，不累加或重複套用素材校正。
    model.setRotation({ x: 0, y: 0, z: modelRotationFromBearing(bearing) });
  };
  const currentPosition = () => {
    // 已查驗 1.4.3 實作：SDK 使用模型 coordinates 作為跟隨位置，移動時會更新它。
    const coordinates = model.coordinates;
    if (!Array.isArray(coordinates) || !validCoordinate(coordinates.slice(0, 2))) {
      throw new Error("無法取得車輛目前的有效座標。");
    }
    return [...coordinates];
  };
  const releaseLock = () => { followCamera?.stop(); };
  const action = (fn) => () => {
    if (!ready) return;
    clearError();
    try { fn(); } catch (error) { showError(error); }
  };
  const mapElement = document.getElementById("map");
  let dragStart = null;
  const resetDrag = () => {
    dragStart = null;
    window.removeEventListener("blur", resetDrag);
  };
  const releaseFollow = () => {
    resetDrag();
    wantsFollow = false;
    try { releaseLock(); } finally { syncControls(); }
  };
  const beginDrag = (event) => {
    resetDrag();
    if (!ready || !wantsFollow || event.pointerType !== "mouse" || event.button !== 0 || event.buttons !== 1) return;
    dragStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    window.addEventListener("blur", resetDrag, { once: true });
  };
  const moveDrag = (event) => {
    if (!dragStart || event.pointerId !== dragStart.id) return;
    if (event.buttons !== 1 || !wantsFollow) { resetDrag(); return; }
    const distance = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
    if (distance >= FOLLOW_DRAG_THRESHOLD) action(releaseFollow)();
  };
  // 容器捕獲僅觀察事件，不取消預設行為或傳播，不攔截 SDK 原本的拖曳處理。
  const dragListeners = [
    ["pointerdown", beginDrag, true], ["pointermove", moveDrag, true],
    ["pointerup", resetDrag, true], ["pointercancel", resetDrag, true],
    ["pointerleave", resetDrag, false],
  ];
  for (const [name, handler, capture] of dragListeners) mapElement.addEventListener(name, handler, { capture, passive: true });
  disposeMapDrag = () => {
    resetDrag();
    for (const [name, handler, capture] of dragListeners) mapElement.removeEventListener(name, handler, capture);
  };
  let pickGesture = null;
  let pickClickAllowed = false;
  const resetPickGesture = () => { pickGesture = null; pickClickAllowed = false; };
  const cancelPick = (message = "已取消選點；可手動輸入或重新選取。") => {
    if (pickMode) status(message);
    pickMode = null;
    resetPickGesture();
    mapElement.classList.remove("proj01-picking");
    syncControls();
  };
  const beginPick = (event) => {
    resetPickGesture();
    if (!pickMode || !ready || moving || transport?.busy || event.pointerType !== "mouse" || event.button !== 0 || event.buttons !== 1) return;
    pickGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  };
  const movePick = (event) => {
    if (!pickGesture || event.pointerId !== pickGesture.id) return;
    if (event.buttons !== 1) { resetPickGesture(); return; }
    if (Math.hypot(event.clientX - pickGesture.x, event.clientY - pickGesture.y) >= FOLLOW_DRAG_THRESHOLD) pickGesture.dragged = true;
  };
  const endPick = (event) => {
    if (!pickGesture || event.pointerId !== pickGesture.id) return;
    pickClickAllowed = event.button === 0 && !pickGesture.dragged
      && Math.hypot(event.clientX - pickGesture.x, event.clientY - pickGesture.y) < FOLLOW_DRAG_THRESHOLD;
    pickGesture = null;
  };
  const handlePickClick = (event) => {
    const allowed = pickClickAllowed;
    pickClickAllowed = false;
    // 已在實際 mapThree 1.4.3 查驗 click 的 lngLat 及 originalEvent；不自行轉換像素。
    if (!allowed || !pickMode || !ready || moving || transport?.busy || event.originalEvent?.button !== 0
      || !mapElement.contains(event.originalEvent.target)) return;
    const { lng, lat } = event.lngLat ?? {};
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      showError(new Error("地圖點選未取得有效經緯度，請重新點選。"));
      return;
    }
    const endpoint = pickMode;
    ui[endpoint].value = `${lng}, ${lat}`;
    syncDraft();
    clearError();
    cancelPick(`已填入${endpoint === "origin" ? "起點" : "終點"}經緯度；請按「新增需求」。`);
  };
  const escapePick = (event) => { if (event.key === "Escape" && pickMode) cancelPick(); };
  const pickListeners = [
    ["pointerdown", beginPick, true], ["pointermove", movePick, true], ["pointerup", endPick, true],
    ["pointercancel", resetPickGesture, true], ["pointerleave", resetPickGesture, false],
  ];
  for (const [name, handler, capture] of pickListeners) mapElement.addEventListener(name, handler, { capture, passive: true });
  window.addEventListener("keydown", escapePick);
  window.addEventListener("blur", resetPickGesture);
  let pickMap = null;
  disposeMapPick = () => {
    cancelPick();
    for (const [name, handler, capture] of pickListeners) mapElement.removeEventListener(name, handler, capture);
    window.removeEventListener("keydown", escapePick);
    window.removeEventListener("blur", resetPickGesture);
    pickMap?.off("click", handlePickClick);
  };
  for (const endpoint of ["origin", "destination"]) {
    ui[endpoint].addEventListener("input", () => {
      clearError();
      cancelPick();
      syncDraft();
    });
    ui[`select-${endpoint}`].addEventListener("click", action(() => {
      if (!ready || moving || transport?.busy) return;
      if (pickMode === endpoint) { cancelPick(); return; }
      releaseFollow();
      resetPickGesture();
      pickMode = endpoint;
      status(`請在地圖上點選${endpoint === "origin" ? "起點" : "終點"}`);
      mapElement.classList.add("proj01-picking");
      syncControls();
    }));
  }
  ui["add-request"].addEventListener("click", () => {
    clearError();
    try {
      const origin = parseCoordinate(ui.origin.value, "起點");
      const destination = parseCoordinate(ui.destination.value, "終點");
      validateEndpoints(origin, destination);
      const request = requestList.addRequest(origin, destination);
      ui.origin.value = ui.destination.value = "";
      syncDraft();
      cancelPick();
      // 接送中只附加需求，保留原本執行狀態、車位與鏡頭。
      if (!transport?.busy) status(`已新增需求 ${request.id.slice("request-".length)}。`);
    } catch (error) { showError(error); }
  });
  document.getElementById("proj01-random-request").addEventListener("click", () => {
    clearError();
    try {
      const { origin, destination } = generateRandomEndpoints(RANDOM_REQUEST_OPTIONS);
      const request = requestList.addRequest(origin, destination);
      if (!transport?.busy) status(`已新增需求 ${request.id.slice("request-".length)}。`);
    } catch (error) { showError(error); }
  });

  ui["apply-scale"].addEventListener("click", action(() => {
    if (!modelSettings.canApply()) return;
    modelSettings.apply(number(ui.scale));
  }));
  const readSpeedInput = () => {
    const value = number(ui.speed);
    if (!Number.isInteger(value) || value < 1 || value > 300) {
      throw new Error("速度倍率須為 1～300 的整數。");
    }
    return value;
  };
  const readSpeedMultiplier = () => {
    readSpeedInput();
    return simulationSettings.speedMultiplier;
  };
  ui.speed.addEventListener("input", action(() => {
    simulationSettings.speedMultiplier = readSpeedInput();
    syncSpeed();
  }));
  ui.follow.addEventListener("click", action(() => {
    if (wantsFollow) return;
    cancelPick();
    wantsFollow = true;
    try { followCamera.start(currentPosition(), travelBearing); }
    catch (error) { wantsFollow = false; releaseLock(); throw error; }
    syncControls();
  }));
  ui.locate.addEventListener("click", (event) => {
    // 僅取消此按鈕點擊的 summary 預設切換，保留原生按鈕鍵盤啟動。
    event.preventDefault();
    if (!ready || wantsFollow) return;
    action(() => map.jumpTo({ center: currentPosition().slice(0, 2) }))();
  });
  const cancelPlayback = () => {
    playback?.cancel();
    moving = false;
    wantsFollow = false;
    releaseLock();
    syncControls();
  };
  const playSegment = ({ onStart, onEnd, onError, ...segment }) => {
    moving = true;
    syncControls();
    status(ui["vehicle-status"].textContent + "…");
    playback.play({ ...segment,
      onStart,
      onEnd: (details) => {
        moving = false;
        onEnd(details);
        syncControls();
      },
      onError: (error, details) => {
        moving = false;
        wantsFollow = false;
        releaseLock();
        onError(error, details);
        syncControls();
      },
    });
  };
  disposePlayback = () => {
    cancelPlayback();
    playback?.dispose();
    modelSettings.clear();
    if (model) { map.three.remove3dObject(model); model = null; }
    ready = false;
    syncControls();
  };
  const clearTaskLine = () => {
    if (!taskLineId) return;
    map.three.remove3dObjectById(taskLineId);
    taskLineId = null;
    map.redraw();
  };
  transport = createTransport({
    requestList,
    isAvailable: () => ready && !moving && Boolean(directions),
    getPosition: currentPosition,
    cancelPlayback,
    getDirections: () => directions,
    decodePolyline: (encoded) => map.decodePolyline(encoded),
    playSegment,
    showSegment: (path, color, id) => {
      clearTaskLine();
      taskLineId = `proj01-transport-route-${id}`;
      map.three.add3dLine({ id: taskLineId, coordinates: path.map(([lng, lat]) => [lng, lat, 0]), color, width: 5 });
      map.redraw();
    },
    clearSegment: clearTaskLine,
    changed: (label) => {
      ui["vehicle-status"].textContent = label;
      status(label === "閒置" ? "接送完成，車輛閒置。" : label === "閒置（接送中斷）" ? "接送中斷，車輛閒置。" : label + "…");
      syncControls();
    },
    reportError: showError,
  });
  const unsubscribeTaskSelection = requestList.subscribeSelection(syncControls);
  const unsubscribeTaskData = requestList.subscribeChange(syncControls);
  disposeTransport = () => {
    unsubscribeTaskSelection(); unsubscribeTaskData();
    transport.dispose();
  };
  ui.transport.addEventListener("click", action(() => {
    if (!transport.canStart()) return;
    cancelPick();
    readSpeedMultiplier();
    void transport.start();
  }));
  ui["auto-transport"].addEventListener("click", action(() => {
    if (!transport.canStartNearest()) return;
    cancelPick();
    readSpeedMultiplier();
    void transport.startNearest();
  }));


  const pageCleanup = () => {
    if (requestMapRun === requestMapVersion) requestMapVersion++;
    disposeTransport?.(); disposePlayback?.(); disposeMapDrag?.(); disposeMapPick?.();
    disposeMapDisplay?.(); disposePanelWheel?.(); disposeRequestMap?.(); disposeRequests?.();
  };
  window.addEventListener("pagehide", pageCleanup);
  disposePage = () => { window.removeEventListener("pagehide", pageCleanup); };

  try {
    await checkModelAssets();
    if (requestMapRun !== requestMapVersion) return;
    status("正在載入官方 mapThree 1.4.3 SDK…");
    const MapThree = await loadSdk("mapThree");
    if (requestMapRun !== requestMapVersion) return;
    sdk = MapThree;
    status("正在初始化 mapThree 1.4.3 地圖…");
    map = await withTimeout(new MapThree(document.getElementById("map"), {
      accessKey, accessToken,
      style: "https://kw3dmap.localking.com.tw/openapi/map/kwmap.etxt",
      center: [121.563, 25.0334], pitch: 60, zoom: 17,
      // 預設上限會限制跟隨視角的 pitch 65、zoom 18，僅在本範例明確放寬。
      maxPitch: 85, maxZoom: 24,
      // 官方公開選項：視窗及響應式分區尺寸改變時，由 SDK 更新地圖大小。
      trackResize: true,
    }), 45000, "地圖初始化逾時，請檢查網路、憑證與官方服務後重新整理。");
    if (requestMapRun !== requestMapVersion) return;
    disposeMapDisplay = mountPoiToggle({ map, button: document.getElementById("proj01-poi-toggle"), reportError: showError });
    await withTimeout(new Promise((resolve) => {
      let started = false;
      const loaded = () => {
        if (started) return;
        map.offLayer("base3d"); // 隱藏底圖的 3D 建築
        started = true;
        map.off("style.load", loaded);
        resolve();
      };
      map.on("style.load", loaded);
      if (map.isStyleLoaded()) loaded();
    }), 45000, "地圖樣式載入逾時，請檢查 Network、憑證與官方服務後重新整理。");
    if (requestMapRun !== requestMapVersion) return;
    status(`正在載入模型 ${MODEL_URL}…`);
    // 已查驗 mapThree 1.4.3 會提供此服務，直接使用目前地圖，不另外載入 mapPlus。
    if (typeof sdk.DirectionsService === "function") {
      try { directions = new sdk.DirectionsService(map); }
      catch (error) {  }
    }
    // 需求圖層不等待模型，也不影響車輛初始化；重複初始化的舊工作不得重建圖層。
    if (requestMapRun === requestMapVersion) {
      try {
        const requestMap = mountRequestMap({ map, sdk, directions, requestList });
        disposeRequestMap = requestMap.dispose;
      } catch (error) {
        for (const request of requestList.requests) requestList.setRouteState(request.id, { status: "error", error: error.message });
      }
    }
    let expired = false;
    const loading = map.three.add3dModel({
      id: "proj01-model", obj: MODEL_URL, type: "gltf", coordinates: [...DEFAULT_ORIGIN, 0],
      rotation: { ...INITIAL_ROTATION }, scale: MODEL_INITIAL_SCALE, anchor: "bottom",
    }).then((loaded) => {
      // 逾時後才到達的模型不啟用控制，避免畫面與載入狀態不一致。
      if (expired || requestMapRun !== requestMapVersion) map.three.remove3dObject(loaded);
      return loaded;
    });
    try {
      model = await withTimeout(loading, 60000, "模型載入逾時，請檢查 glTF、bin、貼圖請求及格式相容性後重新整理。");
    } catch (error) {
      expired = true;
      throw error;
    }
    if (requestMapRun !== requestMapVersion) { model = null; return; }
    followCamera = createFollowCamera({ map, view: FOLLOW_CAMERA });
    const clock = createSimulationClock({ getSpeedMultiplier: readSpeedMultiplier });
    playback = createPlayback({ clock, model,
      updateCamera: (current, bearing) => {
        travelBearing = bearing;
        followCamera.update(current, bearing);
      },
      redraw: () => map.redraw(),
    });
    setBearing(0);
    modelSettings.register({ id: "車輛 01", model, initialScale: MODEL_INITIAL_SCALE,
      isBusy: () => !ready || moving || Boolean(transport?.busy) });
    ready = true;
    ui["vehicle-status"].textContent = "閒置";
    pickMap = map;
    map.on("click", handlePickClick);
    syncControls();
    status("模型載入完成。");
  } catch (error) {
    if (requestMapRun !== requestMapVersion) return;
    ready = false;
    syncControls();
    status("模型實驗室載入失敗，控制已停用。修正問題後請重新整理。");
    showError(error);
  }
}
