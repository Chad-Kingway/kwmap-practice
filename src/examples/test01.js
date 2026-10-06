import { accessKey, accessToken } from "../config.js";
import { loadSdk } from "../sdk.js";
import "./test01.css";

const MODEL_URL = "/models/car/scene.gltf";
// 素材的初始姿態校正；只在建立模型時套用，與手動車頭角度分開管理。
const INITIAL_ROTATION = { x: 90, y: 180, z: 0 };
const INITIAL = { height: 0, heading: 0, scale: 10, duration: 10 };
const FOLLOW_CAMERA = { pitch: 65, zoom: 18 };
// 第一版使用同一直線上的座標，讓預設曲線移動與顯示的路徑線一致。
const PATH = [
  [121.561, 25.0334, 0],
  [121.563, 25.0334, 0],
  [121.565, 25.0334, 0],
  [121.567, 25.0340, 0],
];
const LINE_ID = "test01-path";

// 地理前進方位角：北為 0 度、東為 90 度，與素材的手動 Z 角度無關。
function geographicBearing(from, to) {
  if (from[0] === to[0] && from[1] === to[1]) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(from[1]);
  const lat2 = radians(to[1]);
  const deltaLng = radians(to[0] - from[0]);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function initialPathBearing(path) {
  const valid = path.filter((point) => Array.isArray(point) && point.length >= 2
    && point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
  for (let i = 1; i < valid.length; i++) {
    const bearing = geographicBearing(valid[i - 1], valid[i]);
    if (bearing !== null) return bearing;
  }
  throw new Error("路徑缺少有效且不同位置的線段，無法設定跟隨方向。");
}

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
  document.title = "test01：3D 模型與路徑實驗室";
  const app = document.getElementById("app");
  app.innerHTML = `
    <div id="map"></div>
    <aside class="test01-panel" aria-label="模型與路徑控制面板">
      <a href="/">← 返回首頁</a>
      <h1>test01：3D 模型與路徑實驗室</h1>
      <p id="test01-status" role="status" aria-live="polite">正在檢查模型素材…</p>
      <p id="test01-error" role="alert" hidden></p>
      <fieldset id="test01-settings" disabled>
        <legend>模型設定</legend>
        <label for="test01-height">高度（公尺）</label>
        <input id="test01-height" type="number" min="0" max="500" step="1" value="${INITIAL.height}">
        <label for="test01-rotation">手動車頭角度</label>
        <input id="test01-rotation" type="number" min="0" max="360" step="1" value="${INITIAL.heading}" aria-describedby="test01-heading-note">
        <label for="test01-scale">整體比例（初始展示比例為 10）</label>
        <input id="test01-scale" type="number" min="0.1" max="1000" step="0.1" value="${INITIAL.scale}">
        <button id="test01-reset" type="button">還原模型初始設定</button>
      </fieldset>
      <fieldset id="test01-motion" disabled>
        <legend>路徑移動</legend>
        <label for="test01-duration">移動時間（秒，1～300）</label>
        <input id="test01-duration" type="number" min="1" max="300" step="1" value="${INITIAL.duration}">
        <label class="test01-check"><input id="test01-heading" type="checkbox" checked>朝向前進方向</label>
        <button id="test01-start" type="button">開始沿路徑移動</button>
      </fieldset>
      <fieldset id="test01-view" disabled>
        <legend>路徑與鏡頭</legend>
        <label class="test01-check"><input id="test01-path" type="checkbox" checked>顯示預設路徑線</label>
        <button id="test01-follow" type="button">鏡頭跟隨模型</button>
        <button id="test01-release" type="button" disabled>解除跟隨</button>
        <p id="test01-camera-status" class="test01-note" role="status" aria-live="polite">鏡頭未跟隨。</p>
        <p class="test01-note">鏡頭從模型後上方沿路徑方向看。未勾選「朝向前進方向」時，不保證視角與素材車頭一致；手動車頭角度不是地理方位角。</p>
      </fieldset>
      <p class="test01-note">每次移動從路徑起點出發。移動完成後可再調整模型或重播。</p>
    </aside>
  `;
  const ui = Object.fromEntries(["status", "error", "settings", "motion", "view", "height", "rotation", "scale", "reset", "duration", "heading", "start", "path", "follow", "release", "camera-status"]
    .map((name) => [name, document.getElementById(`test01-${name}`)]));
  let map;
  let model;
  let moving = false;
  let wantsFollow = false;
  let cameraLocked = false;
  let lockFrame = null;
  let followVersion = 0;
  let runVersion = 0;
  let movementStarted = false;
  let movementFrame = null;
  let travelBearing = initialPathBearing(PATH);
  let ready = false;
  let position = [...PATH[0]];
  const status = (message) => { ui.status.textContent = message; };
  const showError = (error) => {
    ui.error.textContent = error.message || String(error);
    ui.error.hidden = false;
  };
  const clearError = () => { ui.error.hidden = true; ui.error.textContent = ""; };
  const syncControls = () => {
    ui.settings.disabled = ui.motion.disabled = !ready || moving;
    ui.view.disabled = !ready;
    ui.follow.disabled = wantsFollow || cameraLocked;
    ui.release.disabled = !wantsFollow && !cameraLocked;
    ui["camera-status"].textContent = cameraLocked
      ? (wantsFollow ? "鏡頭已鎖定模型，沿前進方向跟隨。" : "鏡頭解除失敗，請再次解除跟隨。")
      : (wantsFollow ? "已啟用跟隨，正在等待重新鎖定。" : "鏡頭未跟隨。");
  };
  const number = (input) => {
    if (!input.checkValidity() || input.value === "" || !Number.isFinite(input.valueAsNumber)) {
      throw new Error(`請輸入有效數值（${input.min}～${input.max}）。`);
    }
    return input.valueAsNumber;
  };
  const setHeading = (heading) => {
    // SDK 以建立模型時的校正姿態為基準，設定目標 Z 角度，不累加或重複套用 X、Y。
    model.setRotation({ x: 0, y: 0, z: heading });
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
  const pathAtHeight = () => PATH.map(([lng, lat]) => [lng, lat, number(ui.height)]);
  const updateLine = () => {
    map.three.remove3dObjectById(LINE_ID);
    if (ui.path.checked) {
      map.three.add3dLine({ id: LINE_ID, coordinates: pathAtHeight(), color: "#ff7a18", width: 5 });
    }
  };
  const action = (fn) => () => {
    if (!ready) return;
    clearError();
    try { fn(); } catch (error) { showError(error); }
  };

  ui.height.addEventListener("change", action(() => {
    if (moving) return;
    position[2] = number(ui.height);
    model.setCoordinates([...position]);
    updateLine();
  }));
  ui.rotation.addEventListener("change", action(() => {
    if (!moving) setHeading(number(ui.rotation));
  }));
  ui.scale.addEventListener("change", action(() => {
    // SDK 以新增模型時的比例為基準，因此將 UI 的整體比例換成相對倍率。
    if (!moving) model.setScale(number(ui.scale) / INITIAL.scale);
  }));
  ui.reset.addEventListener("click", action(() => {
    if (moving) return;
    releaseLock();
    for (const key of ["height", "scale"]) ui[key].value = INITIAL[key];
    ui.rotation.value = INITIAL.heading;
    position = [...PATH[0]];
    model.setCoordinates([...position]);
    setHeading(INITIAL.heading);
    model.setScale(1);
    travelBearing = initialPathBearing(PATH);
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
  ui.release.addEventListener("click", action(() => {
    wantsFollow = false;
    try { releaseLock(); } finally { syncControls(); }
  }));
  ui.start.addEventListener("click", action(() => {
    if (moving) return;
    const duration = number(ui.duration) * 1000;
    const path = pathAtHeight();
    const heading = number(ui.rotation);
    const bearing = initialPathBearing(path);
    const run = ++runVersion;
    // 先同步鎖定控制，再交給 SDK；只由官方 onEnd 回呼解除移動狀態。
    moving = true;
    movementStarted = false;
    syncControls();
    status(`沿路徑移動中（${duration / 1000} 秒）…`);
    try {
      releaseLock();
      cancelMovementFrame();
      position = [...path[0]];
      travelBearing = bearing;
      model.setCoordinates([...path[0]]);
      setHeading(heading);
      if (wantsFollow) prepareCamera();
      const playback = model.followPath({
        path, duration, trackHeading: ui.heading.checked,
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
    status("正在初始化 mapThree 1.4.3 地圖…");
    map = await withTimeout(new MapThree(document.getElementById("map"), {
      accessKey, accessToken,
      style: "https://kw3dmap.localking.com.tw/openapi/map/kwmap.etxt",
      center: [121.563, 25.0334], pitch: 60, zoom: 17,
      // 預設上限會限制跟隨視角的 pitch 65、zoom 18，僅在本範例明確放寬。
      maxPitch: 85, maxZoom: 24,
    }), 45000, "地圖初始化逾時，請檢查網路、憑證與官方服務後重新整理。");
    await withTimeout(new Promise((resolve) => {
      let started = false;
      map.on("style.load", () => {
        if (started) return;
        started = true;
        resolve();
      });
    }), 45000, "地圖樣式載入逾時，請檢查 Network、憑證與官方服務後重新整理。");
    status(`正在載入模型 ${MODEL_URL}…`);
    let expired = false;
    const loading = map.three.add3dModel({
      id: "test01-model", obj: MODEL_URL, type: "gltf", coordinates: [...PATH[0]],
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
    setHeading(INITIAL.heading);
    updateLine();
    ready = true;
    syncControls();
    status("模型載入完成，可以調整設定或開始移動。");
  } catch (error) {
    ready = false;
    syncControls();
    status("模型實驗室載入失敗，控制已停用。修正問題後請重新整理。");
    showError(error);
  }
}
