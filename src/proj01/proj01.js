import { accessKey, accessToken } from "../config.js";
import { loadSdk } from "../sdk.js";
import { validateEndpoints, parseCoordinate, validCoordinate } from "./proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "./proj01-heading.js";
import { mountRequestList } from "./proj01-requests.js";
import { mountRequestMap } from "./proj01-request-map.js";
import { createTransport, distanceMeters, ROAD_SNAP_METERS } from "./proj01-transport.js";
import "./proj01.css";

const MODEL_URL = "/models/car/scene.gltf";
// 請不要改INITIAL_ROTATION
const INITIAL_ROTATION = { x: 90, y: 180, z: 0 };
const INITIAL = { scale: 10, duration: 10 };
const FOLLOW_CAMERA = { pitch: 65, zoom: 18 };
const DEFAULT_ORIGIN = [121.561, 25.0334];
// 已查驗 SDK 使用 CatmullRomCurve3；catmullrom 的零張力使每段幾何沿原線段，不切角。
const ROUTE_CURVE = { closed: false, curveType: "catmullrom", tension: 0 };
const FOLLOW_DRAG_THRESHOLD = 5;
let disposePanelWheel;
let disposeMapDrag;
let disposeMapPick;
let disposeRequests;
let disposeTransport;
let disposePlayback;
let disposeRequestMap;
let requestMapVersion = 0;

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
  disposeTransport?.();
  disposePlayback?.();
  disposePanelWheel?.();
  disposeMapDrag?.();
  disposeMapPick?.();
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
      <fieldset class="proj01-requests">
        <legend>需求管理</legend>
        <div class="proj01-coordinate-row">
          <div><label for="proj01-origin">起點</label>
            <input id="proj01-origin" type="text" placeholder="lng, lat"></div>
          <button id="proj01-select-origin" type="button" aria-pressed="false" disabled>選取起點</button>
        </div>
        <div class="proj01-coordinate-row">
          <div><label for="proj01-destination">終點</label>
            <input id="proj01-destination" type="text" placeholder="lng, lat"></div>
          <button id="proj01-select-destination" type="button" aria-pressed="false" disabled>選取終點</button>
        </div>
        <button id="proj01-add-request" type="button">新增需求</button>
        <div id="proj01-request-list"></div>
      </fieldset>
      <details class="proj01-vehicle" open>
        <summary class="proj01-vehicle-summary">車輛 01</summary>
        <fieldset id="proj01-vehicle-controls" class="proj01-vehicle-controls" disabled>
          <legend class="proj01-visually-hidden">車輛 01 設定</legend>
          <p id="proj01-vehicle-status" role="status" aria-live="polite">尚未就緒</p>
          <button id="proj01-transport" type="button">接送此需求</button>
          <button id="proj01-auto-transport" type="button" title="依車輛與需求起點的直線距離選擇">自動接送一筆</button>
          <section class="proj01-vehicle-section">
              <label for="proj01-scale" class="proj01-section-title">模型比例</label>
              <div class="proj01-input-row">
                <input id="proj01-scale" type="number" min="0.1" max="1000" step="0.1" value="${INITIAL.scale}">
                <button id="proj01-apply-scale" type="button">套用</button>
              </div>
              <label for="proj01-duration" class="proj01-section-title">接送展示時間</label>
              <div class="proj01-input-row">
                <input id="proj01-duration" title="整筆接送任務的總展示時間（秒）" type="number" min="1" max="300" step="1" value="${INITIAL.duration}">
                <span class="proj01-unit">（秒）</span>
              </div>
              <button id="proj01-follow" type="button">鏡頭跟隨模型</button>
          </section>
        </fieldset>
      </details>
    </aside>
    <div id="map" aria-label="3D 地圖"></div>
    </div>
  `;
  const panel = document.getElementById("proj01-panel");
  const requestList = mountRequestList(document.getElementById("proj01-request-list"));
  disposeRequests = requestList.dispose;
  // 已查驗 SDK 跟隨以 window 的冒泡 wheel 調整縮放；只隔離面板，保留原生捲動。
  const stopPanelWheel = (event) => event.stopPropagation();
  panel.addEventListener("wheel", stopPanelWheel, { passive: true });
  disposePanelWheel = () => panel.removeEventListener("wheel", stopPanelWheel);
  const ui = Object.fromEntries(["status", "error", "vehicle-status", "transport", "auto-transport", "vehicle-controls", "scale", "apply-scale", "duration", "follow", "origin", "destination", "add-request", "select-origin", "select-destination"]
    .map((name) => [name, document.getElementById(`proj01-${name}`)]));
  let map;
  let model;
  let sdk;
  let directions;
  let moving = false;
  let transport;
  let taskLineId = null;
  let wantsFollow = false;
  let cameraLocked = false;
  let lockFrame = null;
  let followVersion = 0;
  let runVersion = 0;
  let movementStarted = false;
  let movementFrame = null;
  let travelBearing = 0;
  let ready = false;
  let pickMode = null;
  let position = [...DEFAULT_ORIGIN, 0];
  const status = (message) => { ui.status.textContent = message; };
  const showError = (error) => {
    ui.error.textContent = error.message || String(error);
    ui.error.hidden = false;
  };
  const clearError = () => { ui.error.hidden = true; ui.error.textContent = ""; };
  const syncControls = () => {
    // 需求草稿獨立於車輛停用範圍，接送期間仍可新增。
    ui["vehicle-controls"].disabled = !ready;
    ui.scale.disabled = ui["apply-scale"].disabled = ui.duration.disabled = !ready || moving || transport?.busy;
    ui.transport.disabled = !transport?.canStart();
    ui["auto-transport"].disabled = !transport?.canStartNearest();
    ui.follow.disabled = !ready || wantsFollow || cameraLocked;
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
    // 設定目標 Z 角度；不累加、不重複套用素材校正，播放中只由 SDK 控制旋轉。
    model.setRotation({ x: 0, y: 0, z: modelRotationFromBearing(bearing) });
  };
  const placeAtRouteStart = (path) => {
    const bearing = initialPathBearing(path);
    const start = [path[0][0], path[0][1], 0];
    model.setCoordinates(start);
    setBearing(bearing);
    position = [...start];
    travelBearing = bearing;
  };
  const currentPosition = () => {
    // 已查驗 1.4.3 實作：SDK 使用模型 coordinates 作為跟隨位置，移動時會更新它。
    const coordinates = model.coordinates;
    if (!Array.isArray(coordinates) || !validCoordinate(coordinates.slice(0, 2))) {
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
  const trackPosition = (run, onError) => {
    movementFrame = requestAnimationFrame(() => {
      if (run !== runVersion || !moving) return;
      movementFrame = null;
      try { samplePosition(); } catch (error) { onError(error); return; }
      trackPosition(run, onError);
    });
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
      cancelPick();
      // 接送中只附加需求，保留原本執行狀態、車位與鏡頭。
      if (!transport?.busy) status(`已新增需求 ${request.id.slice("request-".length)}。`);
    } catch (error) { showError(error); }
  });

  ui["apply-scale"].addEventListener("click", action(() => {
    // SDK 以新增模型時的比例為基準，因此將 UI 的整體比例換成相對倍率。
    if (!moving && !transport?.busy) model.setScale(number(ui.scale) / INITIAL.scale);
  }));
  ui.follow.addEventListener("click", action(() => {
    if (wantsFollow || cameraLocked) return;
    cancelPick();
    wantsFollow = true;
    // 播放尚未 onStart 時先保留意願，其餘情況在下一幀使用模型當下座標。
    if (!moving || movementStarted) scheduleLock();
    syncControls();
  }));
  let cancelPlayback = () => {};
  // 接送路段共用 SDK 播放、位置追蹤及鏡頭流程；只有有效 onEnd 才解除播放鎖。
  const playSegment = ({ path: source, duration, onStart, onEnd, onError }) => {
    const path = source.map(([lng, lat]) => [lng, lat, 0]);
    const run = ++runVersion;
    let finished = false, failed = false, attempted = false, completionFrame = null;
    moving = true;
    movementStarted = false;
    syncControls();
    status(ui["vehicle-status"].textContent + "…");
    const fail = (error) => {
      if (run !== runVersion || finished || failed) return;
      failed = true;
      try { samplePosition(); } catch { /* 座標失效時保留最後有效位置。 */ }
      cancelMovementFrame();
      wantsFollow = false;
      try { releaseLock(); } catch (releaseError) { showError(releaseError); }
      moving = attempted;
      if (!attempted) { finished = true; movementStarted = false; }
      syncControls();
      onError(error, { stopped: !attempted, attempted });
    };
    cancelPlayback = () => {
      finished = true;
      runVersion++;
      if (completionFrame !== null) cancelAnimationFrame(completionFrame);
      cancelMovementFrame();
      releaseLock();
    };
    try {
      releaseLock();
      cancelMovementFrame();
      placeAtRouteStart(path);
      if (wantsFollow) prepareCamera();
      attempted = true;
      const playback = model.followPath({
        path, duration, trackHeading: true, curveOptions: { ...ROUTE_CURVE },
        onStart: () => {
          if (run !== runVersion || finished || failed || movementStarted) return;
          movementStarted = true;
          try {
            onStart?.();
            trackPosition(run, fail);
            if (wantsFollow) scheduleLock();
          } catch (error) { fail(error); }
        },
        onEnd: () => {
          if (run !== runVersion || finished) return;
          finished = true;
          cancelMovementFrame();
          cancelPendingLock();
          const complete = () => {
            if (run !== runVersion) return;
            completionFrame = null;
            moving = movementStarted = false;
            try {
              samplePosition();
              if (!failed) {
                // onEnd 後下一個繪製幀再確認最終座標，避免與 SDK 當幀更新及下一段競爭。
                if (distanceMeters(currentPosition(), path.at(-1)) > ROAD_SNAP_METERS) throw new Error("路段結束座標未到達預期終點，接送已中斷。");
                model.setCoordinates([...path.at(-1)]);
              }
              position = failed ? currentPosition() : [...path.at(-1)];
            } catch (error) {
              failed = true;
              wantsFollow = false;
              try { releaseLock(); } catch (releaseError) { showError(releaseError); }
              onError(error, { stopped: true, attempted: true });
            }
            if (wantsFollow && !cameraLocked) scheduleLock();
            syncControls();
            onEnd();
          };
          completionFrame = requestAnimationFrame(complete);
        },
      });
      // Promise 只處理啟動拒絕；完成與兩段接續以 onEnd 為準。
      Promise.resolve(playback).catch(fail);
    } catch (error) { fail(error); }
  };
  disposePlayback = () => {
    cancelPlayback();
    if (model) map.three.remove3dObject(model);
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
    getDuration: () => number(ui.duration) * 1000,
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
    reportError: (error, waiting) => showError(new Error(error.message + (waiting ? " 未確認可用的公開停止介面，請等待動畫結束；若未收到結束回呼，請重新整理。" : ""))),
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
    void transport.start();
  }));
  ui["auto-transport"].addEventListener("click", action(() => {
    if (!transport.canStartNearest()) return;
    cancelPick();
    void transport.startNearest();
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
    ready = true;
    ui["vehicle-status"].textContent = "閒置";
    pickMap = map;
    map.on("click", handlePickClick);
    syncControls();
    status("模型載入完成。");
  } catch (error) {
    ready = false;
    syncControls();
    status("模型實驗室載入失敗，控制已停用。修正問題後請重新整理。");
    showError(error);
  }
}
