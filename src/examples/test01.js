import { accessKey, accessToken } from "../config.js";
import { loadSdk } from "../sdk.js";
import "./test01.css";

const MODEL_URL = "/models/car/scene.gltf";
const INITIAL = { height: 0, rotation: 0, scale: 10, duration: 10 };
// 第一版使用同一直線上的座標，讓預設曲線移動與顯示的路徑線一致。
const PATH = [
  [121.561, 25.0334, 0],
  [121.563, 25.0334, 0],
  [121.565, 25.0334, 0],
];
const LINE_ID = "test01-path";

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
      <p class="test01-model">預設模型：<code>${MODEL_URL}</code></p>
      <p id="test01-status" role="status" aria-live="polite">正在檢查模型素材…</p>
      <p id="test01-error" role="alert" hidden></p>
      <fieldset id="test01-settings" disabled>
        <legend>模型設定</legend>
        <label for="test01-height">高度（公尺）</label>
        <input id="test01-height" type="number" min="0" max="500" step="1" value="${INITIAL.height}">
        <label for="test01-rotation">旋轉方向（度）</label>
        <input id="test01-rotation" type="number" min="0" max="360" step="1" value="${INITIAL.rotation}">
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
      </fieldset>
      <p class="test01-note">每次移動從路徑起點出發。移動完成後可再調整模型或重播。</p>
    </aside>
  `;
  const ui = Object.fromEntries(["status", "error", "settings", "motion", "view", "height", "rotation", "scale", "reset", "duration", "heading", "start", "path", "follow", "release"]
    .map((name) => [name, document.getElementById(`test01-${name}`)]));
  let map;
  let model;
  let moving = false;
  let following = false;
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
    ui.follow.disabled = following;
    ui.release.disabled = !following;
  };
  const number = (input) => {
    if (!input.checkValidity() || input.value === "" || !Number.isFinite(input.valueAsNumber)) {
      throw new Error(`請輸入有效數值（${input.min}～${input.max}）。`);
    }
    return input.valueAsNumber;
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
    if (!moving) model.setRotation({ x: 0, y: 0, z: number(ui.rotation) });
  }));
  ui.scale.addEventListener("change", action(() => {
    // SDK 以新增模型時的比例為基準，因此將 UI 的整體比例換成相對倍率。
    if (!moving) model.setScale(number(ui.scale) / INITIAL.scale);
  }));
  ui.reset.addEventListener("click", action(() => {
    if (moving) return;
    for (const key of ["height", "rotation", "scale"]) ui[key].value = INITIAL[key];
    position = [...PATH[0]];
    model.setCoordinates([...position]);
    model.setRotation({ x: 0, y: 0, z: 0 });
    model.setScale(1);
    updateLine();
    status("已還原模型高度、方向、比例與起點位置。");
  }));
  ui.path.addEventListener("change", action(updateLine));
  ui.follow.addEventListener("click", action(() => {
    map.three.fixedCameraToModel({ model, rotateWithDirection: false, releaseCameraOnClick: false });
    following = true;
    syncControls();
  }));
  ui.release.addEventListener("click", action(() => {
    map.three.releaseCamera();
    following = false;
    syncControls();
  }));
  ui.start.addEventListener("click", action(() => {
    if (moving) return;
    const duration = number(ui.duration) * 1000;
    const path = pathAtHeight();
    const rotation = number(ui.rotation);
    // 先同步鎖定控制，再交給 SDK；只由官方 onEnd 回呼解除移動狀態。
    moving = true;
    syncControls();
    status(`沿路徑移動中（${duration / 1000} 秒）…`);
    try {
      model.setCoordinates([...path[0]]);
      model.setRotation({ x: 0, y: 0, z: rotation });
      model.followPath({
        path, duration, trackHeading: ui.heading.checked,
        onEnd: () => {
          position = [...path.at(-1)];
          moving = false;
          syncControls();
          status("路徑移動完成，可調整模型或再次開始。");
        },
      });
    } catch (error) {
      moving = false;
      syncControls();
      status("無法開始路徑移動。");
      throw error;
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
      rotation: { x: 0, y: 0, z: 0 }, scale: INITIAL.scale, anchor: "bottom",
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
