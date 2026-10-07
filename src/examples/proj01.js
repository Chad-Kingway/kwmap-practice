import { accessKey, accessToken } from "../config.js";
import { loadSdk } from "../sdk.js";
import { normalizeDirections, validateEndpoints } from "./proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "./proj01-heading.js";
import "./proj01.css";

const MODEL_URL = "/models/car/scene.gltf";
// 請不要改INITIAL_ROTATION
const INITIAL_ROTATION = { x: 90, y: 180, z: 0 };
const INITIAL = { height: 0, scale: 10, duration: 10 };
const FOLLOW_CAMERA = { pitch: 65, zoom: 18 };
const DEFAULT_ORIGIN = [121.561, 25.0334];
const DEFAULT_DESTINATION = [121.567, 25.034];
// 已查驗 SDK 使用 CatmullRomCurve3；catmullrom 的零張力使每段幾何沿原線段，不切角。
const ROUTE_CURVE = { closed: false, curveType: "catmullrom", tension: 0 };
const LINE_ID = "proj01-path";
const FOLLOW_DRAG_THRESHOLD = 5;
let disposePanelWheel;
let disposeMapDrag;

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
  disposePanelWheel?.();
  disposeMapDrag?.();
  document.title = "proj01：3D 模型與路徑實驗室";
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="proj01-layout">
    <aside id="proj01-panel" class="proj01-panel" aria-label="模型與路徑控制面板">
      <a href="/">← 返回首頁</a>
      <h1>proj01：3D 模型與路徑實驗室</h1>
      <p id="proj01-status" role="status" aria-live="polite">正在檢查模型素材…</p>
      <p id="proj01-error" role="alert" hidden></p>
      <fieldset id="proj01-route" disabled>
        <legend>汽車路線規劃</legend>
        <fieldset id="proj01-route-query" class="proj01-route-query" disabled>
          <legend>起終點</legend>
          <div class="proj01-coordinate-row">
            <div><label for="proj01-origin-lng">起點經度</label>
              <input id="proj01-origin-lng" type="number" min="-180" max="180" step="any" value="${DEFAULT_ORIGIN[0]}"></div>
            <div><label for="proj01-origin-lat">起點緯度</label>
              <input id="proj01-origin-lat" type="number" min="-90" max="90" step="any" value="${DEFAULT_ORIGIN[1]}"></div>
            <button id="proj01-select-origin" type="button" disabled title="地圖選點功能尚未接入">選取起點</button>
          </div>
          <div class="proj01-coordinate-row">
            <div><label for="proj01-destination-lng">終點經度</label>
              <input id="proj01-destination-lng" type="number" min="-180" max="180" step="any" value="${DEFAULT_DESTINATION[0]}"></div>
            <div><label for="proj01-destination-lat">終點緯度</label>
              <input id="proj01-destination-lat" type="number" min="-90" max="90" step="any" value="${DEFAULT_DESTINATION[1]}"></div>
            <button id="proj01-select-destination" type="button" disabled title="地圖選點功能尚未接入">選取終點</button>
          </div>
          <button id="proj01-plan" type="button">規劃汽車路線</button>
          <p class="proj01-note">地圖選點尚未接入，請輸入經緯度。</p>
        </fieldset>
        <label class="proj01-check"><input id="proj01-path" type="checkbox" checked>顯示規劃路線</label>
      </fieldset>
      <p id="proj01-route-status" role="status" aria-live="polite">尚未規劃路線。</p>
      <fieldset id="proj01-settings" disabled>
        <legend>模型設定</legend>
        <label for="proj01-height">高度</label>
        <input id="proj01-height" type="number" min="0" max="500" step="1" value="${INITIAL.height}">
        <label for="proj01-scale">整體比例</label>
        <input id="proj01-scale" type="number" min="0.1" max="1000" step="0.1" value="${INITIAL.scale}">
        <button id="proj01-reset" type="button">還原模型初始設定</button>
      </fieldset>
      <fieldset id="proj01-motion" disabled>
        <legend>路徑移動</legend>
        <label for="proj01-duration">展示動畫時間（秒，1～300）</label>
        <input id="proj01-duration" type="number" min="1" max="300" step="1" value="${INITIAL.duration}">
        <button id="proj01-start" type="button">開始沿路徑移動</button>
      </fieldset>
      <fieldset id="proj01-view" disabled>
        <legend>鏡頭控制</legend>
        <p class="proj01-note">跟隨時在地圖按住左鍵拖曳即可解除，車子繼續移動；單擊不解除。</p>
        <button id="proj01-follow" type="button">鏡頭跟隨模型</button>
        <button id="proj01-release" type="button" disabled>解除跟隨</button>
      </fieldset>
      <p class="proj01-note">規劃完成即朝向道路起始方向，但不自動播放。播放時固定沿當下前進方向轉向；每次重播從路線起點出發。</p>
      <p class="proj01-note">選用服務回傳的第一條候選路線；標記是貼合道路後的起終點。高度取目前設定，並非真實道路或橋梁高度；秒數是展示時間，不是行車時間。</p>
    </aside>
    <div id="map" aria-label="3D 地圖"></div>
    </div>
  `;
  const panel = document.getElementById("proj01-panel");
  // 已查驗 SDK 跟隨以 window 的冒泡 wheel 調整縮放；只隔離面板，保留原生捲動。
  const stopPanelWheel = (event) => event.stopPropagation();
  panel.addEventListener("wheel", stopPanelWheel, { passive: true });
  disposePanelWheel = () => panel.removeEventListener("wheel", stopPanelWheel);
  const ui = Object.fromEntries(["status", "error", "settings", "motion", "view", "height", "scale", "reset", "duration", "start", "path", "follow", "release", "route", "route-query", "route-status", "origin-lng", "origin-lat", "destination-lng", "destination-lat", "plan"]
    .map((name) => [name, document.getElementById(`proj01-${name}`)]));
  let map;
  let model;
  let sdk;
  let directions;
  let activePath = [];
  let lineId = LINE_ID;
  let routeMarkers = [];
  let routing = false;
  let queryVersion = 0;
  let moving = false;
  let wantsFollow = false;
  let cameraLocked = false;
  let lockFrame = null;
  let followVersion = 0;
  let runVersion = 0;
  let movementStarted = false;
  let movementFrame = null;
  let travelBearing = 0;
  let ready = false;
  let position = [...DEFAULT_ORIGIN, INITIAL.height];
  const status = (message) => { ui.status.textContent = message; };
  const showError = (error) => {
    ui.error.textContent = error.message || String(error);
    ui.error.hidden = false;
  };
  const clearError = () => { ui.error.hidden = true; ui.error.textContent = ""; };
  const syncControls = () => {
    ui.settings.disabled = ui.motion.disabled = !ready || moving || routing;
    // 路線顯示獨立於查詢控制，查詢與播放期間仍可切換。
    ui.route.disabled = !ready;
    ui["route-query"].disabled = !ready || moving || routing || !directions;
    ui.start.disabled = activePath.length < 2;
    ui.view.disabled = !ready;
    ui.follow.disabled = wantsFollow || cameraLocked;
    ui.release.disabled = !wantsFollow && !cameraLocked;
  };
  const number = (input) => {
    if (!input.checkValidity() || input.value === "" || !Number.isFinite(input.valueAsNumber)) {
      throw new Error(`請輸入有效數值（${input.min}～${input.max}）。`);
    }
    return input.valueAsNumber;
  };
  const setBearing = (bearing) => {
    // 設定目標 Z 角度；不累加、不重複套用素材校正，播放中只由 SDK 控制旋轉。
    model.setRotation({ x: 0, y: 0, z: modelRotationFromBearing(bearing) });
  };
  const placeAtRouteStart = (path, height) => {
    const bearing = initialPathBearing(path);
    const start = [path[0][0], path[0][1], height];
    model.setCoordinates(start);
    setBearing(bearing);
    position = [...start];
    travelBearing = bearing;
  };
  const currentPosition = () => {
    // 已查驗 1.4.3 實作：SDK 使用模型 coordinates 作為跟隨位置，移動時會更新它。
    const coordinates = model.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(Number.isFinite)) {
      throw new Error("SDK 未提供有效的模型當下座標，無法準備跟隨視角。");
    }
    return [...coordinates];
  };
  const samplePosition = () => {
    const current = currentPosition();
    if (moving) travelBearing = geographicBearing(position, current) ?? travelBearing;
    position = current;
    return current;
  };
  const cancelPendingLock = () => {
    followVersion++;
    if (lockFrame !== null) cancelAnimationFrame(lockFrame);
    lockFrame = null;
  };
  const releaseLock = () => {
    cancelPendingLock();
    if (cameraLocked) {
      map.three.releaseCamera();
      cameraLocked = false;
    }
  };
  const prepareCamera = () => {
    const current = samplePosition();
    map.jumpTo({ ...FOLLOW_CAMERA, center: current.slice(0, 2), bearing: travelBearing });
  };
  const scheduleLock = () => {
    cancelPendingLock();
    const request = followVersion;
    const run = runVersion;
    // 實作中的 onStart 先於 tb.update()；下一個繪製幀才讀取更新後的位置並鎖定。
    lockFrame = requestAnimationFrame(() => {
      if (request !== followVersion || run !== runVersion || !ready || !wantsFollow || cameraLocked) return;
      lockFrame = null;
      try {
        prepareCamera();
        // 先標記可能已鎖定，讓 SDK 部分完成後拋錯時仍會嘗試清理。
        cameraLocked = true;
        map.three.fixedCameraToModel({ model, rotateWithDirection: true, releaseCameraOnClick: false });
      } catch (error) {
        wantsFollow = false;
        try { releaseLock(); } catch (releaseError) { showError(releaseError); }
        showError(error);
      }
      syncControls();
    });
  };
  const cancelMovementFrame = () => {
    if (movementFrame !== null) cancelAnimationFrame(movementFrame);
    movementFrame = null;
  };
  const trackPosition = (run) => {
    movementFrame = requestAnimationFrame(() => {
      if (run !== runVersion || !moving) return;
      movementFrame = null;
      try { samplePosition(); } catch (error) { showError(error); return; }
      trackPosition(run);
    });
  };
  const failMovement = (run, error) => {
    if (run !== runVersion || !moving) return;
    runVersion++;
    moving = movementStarted = false;
    cancelMovementFrame();
    wantsFollow = false;
    try { releaseLock(); } catch (releaseError) { showError(releaseError); }
    syncControls();
    status("無法開始路徑移動，請檢查錯誤後重試。");
    showError(error);
  };
  const pathAtHeight = () => activePath.map(([lng, lat]) => [lng, lat, number(ui.height)]);
  const updateLine = () => {
    map.three.remove3dObjectById(lineId);
    if (ui.path.checked && activePath.length >= 2) {
      map.three.add3dLine({ id: lineId, coordinates: pathAtHeight(), color: "#ff7a18", width: 5 });
    }
    for (const marker of routeMarkers) marker.setAltitude(number(ui.height));
  };
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
    if (!ready || (!wantsFollow && !cameraLocked) || event.pointerType !== "mouse" || event.button !== 0 || event.buttons !== 1) return;
    dragStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    window.addEventListener("blur", resetDrag, { once: true });
  };
  const moveDrag = (event) => {
    if (!dragStart || event.pointerId !== dragStart.id) return;
    if (event.buttons !== 1 || (!wantsFollow && !cameraLocked)) { resetDrag(); return; }
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
  const installRoute = (data, request, height) => {
    const nextLine = `${LINE_ID}-${request}`;
    const nextMarkers = [];
    const path = data.coordinates.map(([lng, lat]) => [lng, lat, height]);
    try {
      for (const [index, point] of [path[0], path.at(-1)].entries()) {
        const icon = document.createElement("span");
        icon.className = `proj01-route-marker ${index ? "proj01-route-end" : "proj01-route-origin"}`;
        icon.textContent = index ? "終" : "起";
        nextMarkers.push(new sdk.Marker({ position: point.slice(0, 2), altitude: height, icon, title: index ? "道路路線終點" : "道路路線起點" }));
      }
      if (ui.path.checked) map.three.add3dLine({ id: nextLine, coordinates: path, color: "#ff7a18", width: 5 });
      releaseLock();
      placeAtRouteStart(path, height);
    } catch (error) {
      map.three.remove3dObjectById(nextLine);
      for (const marker of nextMarkers) marker.remove();
      throw error;
    }
    // 幾何驗證與新物件建立成功後，才替換上一份路線及其標記。
    map.three.remove3dObjectById(lineId);
    for (const marker of routeMarkers) marker.remove();
    activePath = data.coordinates;
    lineId = nextLine;
    routeMarkers = nextMarkers;
    runVersion++;
    if (wantsFollow) scheduleLock();
    else map.jumpTo({ center: position.slice(0, 2), zoom: 15.5, pitch: 60, bearing: travelBearing });
  };
  ui.plan.addEventListener("click", async () => {
    if (!ready || !directions || moving || routing) return;
    clearError();
    let origin;
    let destination;
    let height;
    try {
      origin = [number(ui["origin-lng"]), number(ui["origin-lat"])];
      destination = [number(ui["destination-lng"]), number(ui["destination-lat"])];
      validateEndpoints(origin, destination);
      height = number(ui.height);
    } catch (error) {
      ui["route-status"].textContent = "查詢未送出，請修正起終點或模型設定。";
      showError(error);
      return;
    }
    const request = ++queryVersion;
    routing = true;
    syncControls();
    ui["route-status"].textContent = "正在規劃 DRIVING 汽車路線…";
    try {
      const response = new Promise((resolve, reject) => {
        // 實際 SDK 的回呼傳入候選陣列與狀態，並另回傳 Promise；同時處理其拒絕。
        const pending = directions.route({ origin, destination, travelMode: "DRIVING" }, (candidates, routeStatus) => resolve({ candidates, routeStatus }));
        Promise.resolve(pending).catch(reject);
      });
      const { candidates, routeStatus } = await withTimeout(response, 20000, "路線查詢逾時，請重試；遲到的回應不會取代目前路線。");
      if (request !== queryVersion) return;
      if (routeStatus === "OK" && Array.isArray(candidates) && !candidates.length) {
        ui["route-status"].textContent = `無可用路線（${routeStatus}）。${activePath.length ? "保留上一條成功路線。" : "尚無有效路線可播放。"}`;
        return;
      }
      if (routeStatus !== "OK") throw new Error(`路線服務回傳失敗狀態：${String(routeStatus)}。`);
      const data = normalizeDirections(candidates, (encoded) => map.decodePolyline(encoded));
      installRoute(data, request, height);
      ui["route-status"].textContent = `規劃成功：${data.summary}，${data.coordinates.length} 個幾何點；選用 ${data.candidates} 條候選中的第一條。請另按開始播放。`;
      status("模型已移到道路路線起點並朝向起始前進方向，尚未開始移動。");
    } catch (error) {
      if (request !== queryVersion) return;
      ui["route-status"].textContent = `查詢失敗。${activePath.length ? "保留上一條成功路線。" : "尚無有效路線可播放。"}`;
      showError(error);
    } finally {
      if (request === queryVersion) {
        queryVersion++;
        routing = false;
        syncControls();
      }
    }
  });

  ui.height.addEventListener("change", action(() => {
    if (moving) return;
    position[2] = number(ui.height);
    model.setCoordinates([...position]);
    updateLine();
  }));
  ui.scale.addEventListener("change", action(() => {
    // SDK 以新增模型時的比例為基準，因此將 UI 的整體比例換成相對倍率。
    if (!moving) model.setScale(number(ui.scale) / INITIAL.scale);
  }));
  ui.reset.addEventListener("click", action(() => {
    if (moving) return;
    releaseLock();
    for (const key of ["height", "scale"]) ui[key].value = INITIAL[key];
    if (activePath.length >= 2) placeAtRouteStart(activePath, INITIAL.height);
    else {
      position = [...DEFAULT_ORIGIN, INITIAL.height];
      model.setCoordinates([...position]);
      travelBearing = 0;
      setBearing(travelBearing);
    }
    model.setScale(1);
    updateLine();
    if (wantsFollow) scheduleLock();
    syncControls();
    status("已還原模型高度、方向、比例與起點位置。");
  }));
  ui.path.addEventListener("change", action(updateLine));
  ui.follow.addEventListener("click", action(() => {
    if (wantsFollow || cameraLocked) return;
    wantsFollow = true;
    // 播放尚未 onStart 時先保留意願，其餘情況在下一幀使用模型當下座標。
    if (!moving || movementStarted) scheduleLock();
    syncControls();
  }));
  ui.release.addEventListener("click", action(releaseFollow));
  ui.start.addEventListener("click", action(() => {
    if (moving || routing) return;
    if (activePath.length < 2) throw new Error("請先成功規劃一條有效路線。");
    const duration = number(ui.duration) * 1000;
    const path = pathAtHeight();
    const run = ++runVersion;
    // 先同步鎖定控制，再交給 SDK；只由官方 onEnd 回呼解除移動狀態。
    moving = true;
    movementStarted = false;
    syncControls();
    status(`沿路徑移動中（${duration / 1000} 秒）…`);
    try {
      releaseLock();
      cancelMovementFrame();
      placeAtRouteStart(path, number(ui.height));
      if (wantsFollow) prepareCamera();
      const playback = model.followPath({
        path, duration, trackHeading: true, curveOptions: { ...ROUTE_CURVE },
        onStart: () => {
          if (run !== runVersion || !moving || movementStarted) return;
          movementStarted = true;
          trackPosition(run);
          if (wantsFollow) scheduleLock();
        },
        onEnd: () => {
          if (run !== runVersion || !moving) return;
          try { samplePosition(); } catch (error) { showError(error); }
          position = [...path.at(-1)];
          moving = movementStarted = false;
          cancelMovementFrame();
          cancelPendingLock();
          if (wantsFollow && !cameraLocked) scheduleLock();
          syncControls();
          status("路徑移動完成，可調整模型或再次開始。");
        },
      });
      // SDK 的 followPath 回傳 Promise；同步與非同步啟動錯誤都須使舊回呼失效。
      Promise.resolve(playback).catch((error) => failMovement(run, error));
      syncControls();
    } catch (error) {
      failMovement(run, error);
    }
  }));

  try {
    await checkModelAssets();
    status("正在載入官方 mapThree 1.4.3 SDK…");
    const MapThree = await loadSdk("mapThree");
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
    await withTimeout(new Promise((resolve) => {
      let started = false;
      map.on("style.load", () => {
        if (started) return;
        map.offLayer("base3d"); // 隱藏底圖的 3D 建築
        started = true;
        resolve();
      });
    }), 45000, "地圖樣式載入逾時，請檢查 Network、憑證與官方服務後重新整理。");
    status(`正在載入模型 ${MODEL_URL}…`);
    // 已查驗 mapThree 1.4.3 會提供此服務，直接使用目前地圖，不另外載入 mapPlus。
    if (typeof sdk.DirectionsService === "function") {
      try { directions = new sdk.DirectionsService(map); }
      catch (error) { ui["route-status"].textContent = `路線服務初始化失敗：${error.message}`; }
    } else ui["route-status"].textContent = "目前 SDK 未提供 DirectionsService，無法規劃路線。";
    let expired = false;
    const loading = map.three.add3dModel({
      id: "proj01-model", obj: MODEL_URL, type: "gltf", coordinates: [...DEFAULT_ORIGIN, INITIAL.height],
      rotation: { ...INITIAL_ROTATION }, scale: INITIAL.scale, anchor: "bottom",
    }).then((loaded) => {
      // 逾時後才到達的模型不啟用控制，避免畫面與載入狀態不一致。
      if (expired) map.three.remove3dObject(loaded);
      return loaded;
    });
    try {
      model = await withTimeout(loading, 60000, "模型載入逾時，請檢查 glTF、bin、貼圖請求及格式相容性後重新整理。");
    } catch (error) {
      expired = true;
      throw error;
    }
    installSdkHeadingQuaternionFix(model);
    setBearing(0);
    updateLine();
    ready = true;
    syncControls();
    status("模型載入完成，可以調整設定；請先規劃路線再開始移動。");
  } catch (error) {
    ready = false;
    syncControls();
    status("模型實驗室載入失敗，控制已停用。修正問題後請重新整理。");
    showError(error);
  }
}
