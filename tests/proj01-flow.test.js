import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createPlayback } from "../src/proj01/proj01-playback.js";
import { createSimulationClock } from "../src/proj01/proj01-clock.js";
import { createFollowCamera } from "../src/proj01/proj01-camera.js";
import { distanceMeters } from "../src/proj01/proj01-transport.js";
import { createModelSettings } from "../src/proj01/proj01-model-settings.js";
import { mountPoiToggle } from "../src/proj01/proj01-map-display.js";
import { mountCompass } from "../src/proj01/proj01-compass.js";
import { mountRequestList } from "../src/proj01/proj01-requests.js";
import { generateRandomEndpoints } from "../src/proj01/proj01-random-request.js";
import { normalizeDirections, validateEndpoints, parseCoordinate, validCoordinate } from "../src/proj01/proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "../src/proj01/proj01-heading.js";

// 隔離外部服務與渲染，只檢查查詢競態、控制狀態及有效路線的替換流程。
test("缺少送人時間仍保留道路預覽，禁止接送且需求維持 pending", async () => {
  const h = await setup({ manualRequests: true });
  const request = h.requestList.requests[0];
  const response = h.result([request.origin, request.destination]);
  delete response[0].legs[0].duration;
  h.requestQueries[0].callback(response, "OK"); await flushTask();
  selectRequest(h, request.id);
  const cached = h.requestList.getRouteState(request.id);
  assert.equal(cached.status, "ready");
  assert.equal(cached.durationSeconds, null);
  assert.match(cached.error, /缺少有效路線時間/);
  assert.equal(h.requestLines.size, 1);
  h.ui("transport").handlers.click(); h.ui("auto-transport").handlers.click();
  assert.equal(h.model.playbacks.length, 0);
  assert.equal(request.status, "pending");
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.ui("auto-transport").disabled, true);
  assert.equal(h.requestList.getRouteState(request.id), cached);
  h.disposeVehicle(); await flushTask();
});

test("無效接人時間不播放、不改位置，遲到回應不能啟動動畫", async () => {
  for (const invalid of [undefined, null, "300", 0, -1, NaN, Infinity]) {
    const h = await setup();
    h.model.coordinates = [121.53, 25.035, 0];
    const position = [...h.model.coordinates];
    selectRequest(h, "request-02"); h.ui("transport").handlers.click();
    const query = h.queries[0];
    const response = h.result([position.slice(0, 2), h.requestList.requests[1].origin]);
    response[0].legs[0].duration.value = invalid;
    query.callback(response, "OK"); await flushTask();
    assert.equal(h.model.playbacks.length, 0);
    assert.deepEqual(h.model.coordinates, position);
    assert.equal(h.requestList.requests[1].status, "pending");
    assert.match(h.ui("error").textContent, /缺少有效時間/);
    assert.equal(h.ui("speed").disabled, false);
    query.callback(h.result([position.slice(0, 2), h.requestList.requests[1].origin]), "OK");
    await flushTask(); assert.equal(h.model.playbacks.length, 0);
    h.disposeVehicle();
  }
});

test("線性滑桿直接使用整數倍率，預設 60 倍，略過接人不增加時間", async () => {
  for (const [value, multiplier] of [[1, 1], [300, 300], [150, 150], [null, 60]]) {
    const h = await setup();
    selectRequest(h, "request-01");
    if (value === null) {
      assert.equal(Number(h.ui("speed").value), 60);
    } else { h.ui("speed").value = String(value); h.ui("speed").handlers.input(); }
    assert.equal(h.ui("speed-value").textContent, `${multiplier}×`);
    assert.equal(h.ui("speed").attributes["aria-valuetext"], `${multiplier} 倍`);
    h.ui("transport").handlers.click();
    assert.equal(h.model.playback.durationSeconds, 600);
    assert.equal(h.queries.length, 0);
    endSegment(h, h.model.playback);
    assert.equal(h.ui("speed").disabled, false);
    assert.equal(h.requestList.requests[0].status, "completed");
    h.disposeVehicle();
  }
});

async function setup({ manualRequests = false, random = Math.random } = {}) {
  const nodes = new Map(), timers = new Map(), queries = [], markers = [], lines = new Map(), frames = new Map();
  const camera = { locks: 0, releases: 0, moves: 0 };
  const cameraView = { zoom: 16, pitch: 40, bearing: 27, center: [121, 25] }, cameraTargets = [];
  const renderedLines = new Map();
  const layers = new Map(["poi_shop", "poi_shop_name", "txt_road_name", "other_symbol"].map(id => [id, true])), renderedLayers = new Map();
  let instance;
  let requestList;
  let requestMap;
  const requestQueries = [], requestMarkers = [], requestLines = new Map();
  let nextTimer = 0, time = 0;
  let activeElement = null;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", checked: true, disabled: false, hidden: true, textContent: "", handlers: {}, listeners: {}, attributes: {},
      children: [], parentNode: null, open: false, style: {},
      get ownerDocument() { return { get activeElement() { return activeElement; } }; },
      get nextElementSibling() { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; },
      classList: { add() {}, remove() {} },
      contains(target) { return target === this || this.children.some(child => child.contains(target)) || (id === "proj01-coordinate-inputs" && [nodes.get("proj01-origin"), nodes.get("proj01-destination")].includes(target)); },
      focus() { activeElement = this; },
      querySelector(selector) { return selector.startsWith('[data-request-id=') ? nodes.get(selector) ?? null : node(selector); },
      insertBefore(child, next) {
        if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
        const index = next ? this.children.indexOf(next) : this.children.length;
        this.children.splice(index, 0, child); child.parentNode = this;
      },
      insertAdjacentHTML(_position, html) {
        this.innerHTML = (this.innerHTML ?? "") + html;
        const requestId = /data-request-id="([^"]+)"/.exec(html)?.[1];
        if (requestId) {
          const card = node(`[data-request-id="${requestId}"]`);
          const radio = node(`input[type="radio"][value="${requestId}"]`);
          radio.checked = /type="radio"[^>]* checked/.test(html);
          card.insertBefore(radio, null); this.insertBefore(card, null);
        }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); },
      checkValidity() { return Number.isFinite(this.valueAsNumber) && this.valueAsNumber >= Number(this.min) && this.valueAsNumber <= Number(this.max); },
      addEventListener(event, fn) {
        (this.listeners[event] ??= new Set()).add(fn);
        this.handlers[event] = (...args) => {
          if (event === "click" && !args.length) args.push({ preventDefault() {}, stopPropagation() {} });
          let result;
          for (const listener of [...this.listeners[event]]) result = listener(...args);
          return result;
        };
      },
      removeEventListener(event, fn) {
        this.listeners[event]?.delete(fn);
        if (!this.listeners[event]?.size) delete this.handlers[event];
      },
    });
    return nodes.get(id);
  };
  Object.defineProperty(node("app"), "innerHTML", { set(html) {
    for (const match of html.matchAll(/<input\s+([^>]+)>/g)) {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => entry.slice(1, 3)));
      Object.assign(node(attributes.id), attributes);
    }
  } });
  const ui = (name) => node(`proj01-${name}`);
  const model = {
    coordinates: [121.561, 25.0334, 0], playback: null, playbacks: [], rotations: [], playing: false,
    quaternion: { setFromAxisAngle() { return this; } },
    setCoordinates(point) { this.coordinates = [...point]; },
    setRotation(rotation) { this.rotations.push({ ...rotation }); },
    scales: [],
    effectiveScale: 10, renderedScale: 10,
    setScale(scale) { this.scales.push(scale); this.effectiveScale = 10 * scale; },
    followPath() { throw new Error("自管動畫不應呼叫 SDK followPath"); },
  };
  class SDK {
    static DirectionsService = class { route(options, callback) { queries.push({ options, callback }); } };
    static Marker = class { constructor(options) { this.options = options; this.removed = false; (options.icon.className === "proj01-request-marker" ? requestMarkers : markers).push(this); } remove() { this.removed = true; } };
    constructor() {
      instance = this;
      this.events = new Map(); this.styleReady = true;
      this.three = {
        add3dModel: (options) => { model.creationOptions = options; return Promise.resolve(model); },
        add3dLine: (options) => (options.id.startsWith("proj01-request-route-") ? requestLines : lines).set(options.id, options),
        remove3dObjectById: (id) => (id.startsWith("proj01-request-route-") ? requestLines : lines).delete(id),
        fixedCameraToModel() { camera.locks++; }, releaseCamera() { camera.releases++; },
        remove3dObject() { model.playing = false; },
      };
    }
    on(event, callback) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event).add(callback);
      if (event === "style.load" && this.styleReady) callback();
      if (event === "click") this.click = callback;
    }
    off(event, callback) { this.events.get(event)?.delete(callback); if (event === "click" && this.click === callback) this.click = null; }
    emit(event, data = {}) { for (const callback of [...this.events.get(event) ?? []]) callback(data); }
    isStyleLoaded() { return this.styleReady; }
    offLayer(fragment) { this.setVisibility(fragment, false); }
    onLayer(fragment) { this.setVisibility(fragment, true); }
    setVisibility(fragment, visible) {
      if (fragment === "poi_" && this.failPoi) { this.failPoi = false; throw new Error("圖層操作失敗"); }
      for (const id of layers.keys()) if (id.includes(fragment)) layers.set(id, visible);
    }
    getMapView() { return { ...cameraView }; }
    jumpTo(options) {
      camera.moves++; cameraTargets.push(options); Object.assign(cameraView, options);
      if ("bearing" in options) this.emit("rotate");
    }
    redraw() {
      model.renderedScale = model.effectiveScale;
      for (const [id, visible] of layers) renderedLayers.set(id, visible);
      renderedLines.clear();
      for (const [id, line] of lines) renderedLines.set(id, line);
    }
    decodePolyline(encoded) { return JSON.parse(encoded); }
  }
  const context = vm.createContext({
    document: { getElementById: node, get activeElement() { return activeElement; }, createElement: () => ({ style: {}, classList: { toggle(name, selected) { this[name] = selected; } } }) }, window: Object.assign(node("window"), { location: { origin: "http://localhost" } }),
    fetch: async () => ({ ok: true, headers: { get: () => "model/gltf+json" }, json: async () => ({ asset: { version: "2.0" } }) }),
    AbortSignal, loadSdk: async () => SDK, accessKey: "測試", accessToken: "測試",
    mountRequestList: (container) => (requestList = mountRequestList(container)),
    generateRandomEndpoints: (options) => generateRandomEndpoints({ ...options, random }),
    createFollowCamera: (options) => {
      const cameraController = createFollowCamera(options);
      return { start(...args) { camera.locks++; cameraController.start(...args); }, update: cameraController.update,
        stop() { if (cameraController.following) camera.releases++; cameraController.stop(); } };
    },
    createSimulationClock: (options) => createSimulationClock({ ...options, requestFrame: context.requestAnimationFrame,
      cancelFrame: context.cancelAnimationFrame, now: () => time, visibility: Object.assign(node("visibility"), { hidden: false }) }),
    createPlayback: (options) => {
      const controller = createPlayback(options);
      return { ...controller,
        cancel() { controller.cancel(); model.playing = false; },
        dispose() { controller.dispose(); model.playing = false; },
        play(segment) {
          const playback = { ...segment, path: segment.path.map(point => [...point.slice(0, 2), 0]) };
          model.playback = playback; model.playbacks.push(playback); model.playing = true;
          playback.handle = controller.play({ ...segment,
            onEnd: details => { model.playing = false; segment.onEnd(details); },
            onError: (...args) => { model.playing = false; segment.onError(...args); },
          });
          return playback.handle;
        },
      };
    },
    mountCompass, mountPoiToggle, createModelSettings, normalizeDirections, validateEndpoints, parseCoordinate, validCoordinate, geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (fn) => { const id = ++nextTimer; frames.set(id, fn); return id; }, cancelAnimationFrame: (id) => frames.delete(id),
  });
  const source = fs.readFileSync(new URL("../src/proj01/proj01.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export async function init", "async function init");
  const transportSource = fs.readFileSync(new URL("../src/proj01/proj01-transport.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(transportSource, context);
  const mapSource = fs.readFileSync(new URL("../src/proj01/proj01-request-map.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export function mountRequestMap", "function mountRequestMap");
  const mountMap = vm.runInContext(mapSource + "\nmountRequestMap", context);
  context.mountRequestMap = (options) => {
    const directions = { route(query, callback) {
      requestQueries.push({ options: query, callback });
      if (!manualRequests) callback([{ legs: [{ duration: { value: 600, text: "10 分鐘" }, steps: [{ polyline: { points: JSON.stringify([query.origin, query.destination]) },
        start_location: { lng: query.origin[0], lat: query.origin[1] }, end_location: { lng: query.destination[0], lat: query.destination[1] } }] }] }], "OK");
    } };
    return requestMap = mountMap({ ...options, directions });
  };
  await vm.runInContext(`${source}\ninit()`, context);
  if (!manualRequests) await requestMap.loading;
  const result = (points, summary = "測試路線", seconds = 300) => [{ summary, legs: [{ duration: { value: seconds, text: "顯示文字不供解析" }, steps: [{
    polyline: { points: JSON.stringify(points) },
    start_location: { lng: points[0][0], lat: points[0][1] },
    end_location: { lng: points.at(-1)[0], lat: points.at(-1)[1] },
  }] }] }];
  return { ui, nodes, timers, queries, markers, lines, renderedLines, model, result, camera, cameraView, cameraTargets, frames, requestList, requestMap, requestQueries, requestMarkers, requestLines, map: instance, layers, renderedLayers,
    get activeElement() { return activeElement; },
    disposeDisplay: () => vm.runInContext("disposeMapDisplay()", context),
    click: (lng, lat, overrides = {}) => instance.click({ lngLat: { lng, lat }, originalEvent: { button: 0, target: node("map"), ...overrides } }),
    frame: (milliseconds = 16) => { time += milliseconds; const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time); },
    disposeVehicle: () => vm.runInContext("disposeTransport(); disposePlayback();", context),
    add: () => ui("add-request").handlers.click() };
}

test("POI 切換立即呈現且與車輛獨立，樣式重載保留選擇，失敗與釋放不誤更新", async () => {
  const h = await setup(), button = h.ui("poi-toggle");
  const toggle = () => button.handlers.click();
  assert.equal(button.attributes["aria-pressed"], "false");
  const before = { position: [...h.model.coordinates], camera: { ...h.camera }, markers: [...h.requestMarkers], lines: [...h.requestLines] };
  toggle();
  assert.equal(button.attributes["aria-label"], "顯示地點圖標");
  assert.equal(button.attributes.title, "顯示地點圖標");
  assert.equal(button.attributes["aria-pressed"], "true");
  for (const id of ["poi_shop", "poi_shop_name"]) assert.equal(h.renderedLayers.get(id), false);
  for (const id of ["txt_road_name", "other_symbol"]) assert.equal(h.renderedLayers.get(id), true);
  assert.deepEqual(h.model.coordinates, before.position); assert.deepEqual(h.camera, before.camera);
  assert.deepEqual(h.requestMarkers, before.markers); assert.deepEqual([...h.requestLines], before.lines);
  h.map.styleReady = false; h.map.emit("dataloading", { dataType: "source" });
  assert.equal(button.disabled, false, "來源瓦片載入不應停用圖層操作");
  h.map.emit("dataloading", { dataType: "style" });
  assert.equal(button.disabled, true); toggle();
  assert.equal(button.attributes["aria-pressed"], "true");
  for (const id of h.layers.keys()) h.layers.set(id, true);
  h.map.styleReady = true; h.map.emit("style.load");
  assert.equal(button.disabled, false); assert.equal(h.renderedLayers.get("poi_shop"), false);
  h.map.failPoi = true; toggle();
  assert.match(h.ui("error").textContent, /切換失敗/);
  assert.equal(button.attributes["aria-pressed"], "true"); assert.equal(h.renderedLayers.get("poi_shop"), false);
  h.ui("follow").handlers.click(); h.frame();
  selectRequest(h, "request-01"); h.ui("transport").handlers.click();
  const playback = h.model.playback;
  toggle(); toggle(); toggle();
  assert.equal(button.attributes["aria-pressed"], "false"); assert.equal(h.renderedLayers.get("poi_shop"), true);
  assert.equal(h.model.playback, playback); assert.equal(h.model.playing, true);
  const staleLoad = [...h.map.events.get("style.load")][0];
  h.disposeDisplay(); h.layers.set("poi_shop", false); staleLoad(); h.map.emit("style.load");
  assert.equal(button.disabled, true); assert.equal(h.layers.get("poi_shop"), false);
});

test("標題列跟隨取消 summary 切換，使用當下車位且不移動模型，無效座標不啟動", async () => {
  const h = await setup();
  let prevented = 0;
  const follow = () => h.ui("follow").handlers.click({ preventDefault() { prevented++; } });
  h.model.coordinates = [NaN, 25, 0];
  follow();
  assert.equal(prevented, 1);
  assert.equal(h.camera.moves, 0);
  assert.equal(h.ui("follow").disabled, false);
  assert.match(h.ui("error").textContent, /有效座標/);
  h.model.coordinates = [121.57, 25.04, 0];
  follow();
  assert.equal(prevented, 2);
  assert.deepEqual(Array.from(h.cameraView.center), [121.57, 25.04]);
  assert.equal(h.cameraView.zoom, 18); assert.equal(h.cameraView.pitch, 65);
  assert.deepEqual(h.model.coordinates, [121.57, 25.04, 0]);
  assert.equal(h.ui("follow").disabled, true);
  const moves = h.camera.moves;
  follow(); assert.equal(h.camera.moves, moves);
  assert.equal(h.camera.releases, 0);
  assert.equal(h.model.playbacks.length, 0);
  assert.equal(h.queries.length, 0);
  assert.equal(h.camera.locks, 1);
  h.disposeVehicle();
});

test("指南針解除跟隨並保留視角、草稿及原接送，下一幀不覆蓋回正北", async () => {
  const h = await setup();
  selectRequest(h, "request-01");
  h.ui("origin").value = "草稿起點"; h.ui("destination").value = "草稿終點";
  h.ui("follow").handlers.click(); h.ui("transport").handlers.click(); h.frame(1000);
  h.map.jumpTo({ bearing: 123, zoom: 19, pitch: 52 });
  assert.equal(h.ui("compass-needle").style.transform, "rotate(-123deg)");
  const before = { view: { ...h.cameraView }, position: [...h.model.coordinates], rotations: [...h.model.rotations],
    playback: h.model.playback, lines: [...h.lines], requests: [...h.requestLines], selected: h.requestList.selectedRequestId };
  h.ui("compass").handlers.click();
  assert.deepEqual(h.cameraView, { ...before.view, bearing: 0 });
  assert.equal(h.ui("follow").disabled, false);
  assert.equal(h.camera.releases, 1);
  assert.deepEqual(h.model.coordinates, before.position); assert.deepEqual(h.model.rotations, before.rotations);
  assert.equal(h.model.playback, before.playback); assert.equal(h.model.playing, true);
  assert.deepEqual([...h.lines], before.lines); assert.deepEqual([...h.requestLines], before.requests);
  assert.equal(h.requestList.selectedRequestId, before.selected);
  assert.equal(h.ui("origin").value, "草稿起點"); assert.equal(h.ui("destination").value, "草稿終點");
  const moves = h.camera.moves; h.frame(1000);
  assert.equal(h.camera.moves, moves); assert.equal(h.cameraView.bearing, 0);
  assert.notDeepEqual(h.model.coordinates, before.position); assert.equal(h.model.playback, before.playback);
  h.disposeVehicle();
});

test("地圖左鍵拖曳解除跟隨且不中斷播放", async () => {
  const h = await setup();
  const map = h.nodes.get("map"), window = h.nodes.get("window");
  const pointer = (type, overrides = {}) => map.handlers[type]({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...overrides });
  h.ui("follow").handlers.click();
  const beforeRelease = h.camera.moves;
  for (const [button, buttons] of [[1, 4], [2, 2]]) {
    pointer("pointerdown", { button, buttons });
    pointer("pointermove", { buttons, clientX: 120 });
    assert.equal(h.ui("follow").disabled, true);
  }
  pointer("pointerdown");
  pointer("pointermove", { clientX: 103, clientY: 102 });
  assert.equal(h.ui("follow").disabled, true, "小於 5px 不解除");
  pointer("pointerup", { buttons: 0 });
  pointer("pointermove", { clientX: 120 });
  assert.equal(h.ui("follow").disabled, true, "點擊後不殘留拖曳");
  for (const end of ["pointerleave", "pointercancel", "blur"]) {
    pointer("pointerdown");
    if (end === "blur") window.handlers.blur(); else pointer(end);
    pointer("pointermove", { clientX: 120 });
    assert.equal(h.ui("follow").disabled, true);
  }
  pointer("pointerdown");
  pointer("pointermove", { pointerId: 2, clientX: 120 });
  assert.equal(h.ui("follow").disabled, true, "忽略另一個指標");
  pointer("pointermove", { clientX: 105 });
  h.frame();
  assert.equal(h.camera.moves, beforeRelease, "解除後沒有額外跟隨更新");
  assert.equal(h.ui("follow").disabled, false);

  for (const id of ["request-01", "request-02"]) {
    const request = h.requestList.requests.find(item => item.id === id);
    h.model.coordinates = [...request.origin, 0];
    selectRequest(h, id);
    h.ui("follow").handlers.click(); h.frame();
    h.ui("transport").handlers.click();
    const playback = h.model.playback;
    pointer("pointerdown"); pointer("pointermove", { clientX: 110 });
    h.frame();
    assert.equal(h.ui("follow").disabled, false);
    assert.equal(h.model.playing, true);
    assert.equal(h.model.playback, playback, "拖曳不停止或重啟接送");
    endSegment(h, playback);
  }
});

test("地圖選點切換及取消，只接受有效左鍵點擊，只更新草稿，不建立需求或移動模型", async () => {
  const h = await setup();
  const map = h.nodes.get("map");
  const pointer = (type, overrides = {}) => map.handlers[type]({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...overrides });
  const select = (endpoint) => h.ui(`select-${endpoint}`).handlers.click();
  const pressed = (endpoint) => h.ui(`select-${endpoint}`).attributes["aria-pressed"];
  const click = (lng, lat, overrides) => { pointer("pointerdown"); pointer("pointerup", { buttons: 0 }); h.click(lng, lat, overrides); };
  const position = [...h.model.coordinates], rotations = h.model.rotations.length;
  const markers = [...h.requestMarkers];

  select("origin");
  for (const [button, buttons] of [[1, 4], [2, 2]]) {
    pointer("pointerdown", { button, buttons }); pointer("pointerup", { button, buttons: 0 }); h.click(122, 26);
    assert.equal(pressed("origin"), "true", "非左鍵按下不能授權 SDK click");
  }
  assert.equal(pressed("origin"), "true");
  assert.match(h.ui("status").textContent, /請在地圖上點選起點/);
  select("destination");
  assert.equal(pressed("origin"), "false");
  assert.equal(pressed("destination"), "true");
  select("destination");
  assert.equal(pressed("destination"), "false");
  select("origin"); h.nodes.get("window").handlers.keydown({ key: "Escape" });
  assert.equal(pressed("origin"), "false");
  h.click(122, 26);
  assert.equal(h.ui("origin").value, "");

  select("origin");
  for (const overrides of [{ button: 1 }, { button: 2 }, { target: h.nodes.get("proj01-panel") }]) {
    click(122, 26, overrides);
    assert.equal(pressed("origin"), "true");
    assert.equal(h.ui("origin").value, "");
  }
  for (const [lng, lat] of [[NaN, 25], [181, 25], [121, -91]]) {
    click(lng, lat);
    assert.equal(pressed("origin"), "true");
    assert.match(h.ui("error").textContent, /有效經緯度/);
  }
  pointer("pointerdown"); pointer("pointermove", { clientX: 110 });
  pointer("pointermove", { clientX: 100 }); pointer("pointerup", { buttons: 0 }); h.click(122, 26);
  assert.equal(pressed("origin"), "true", "拖曳再回到按下位置也不能選點");
  for (const end of ["pointerleave", "pointercancel", "blur"]) {
    pointer("pointerdown");
    if (end === "blur") h.nodes.get("window").handlers.blur(); else pointer(end);
    pointer("pointerup", { buttons: 0 }); h.click(122, 26);
    assert.equal(pressed("origin"), "true");
  }
  pointer("pointerdown"); pointer("pointermove", { clientX: 103, clientY: 102 });
  pointer("pointerup", { buttons: 0, clientX: 103, clientY: 102 }); h.click(121.561123456789, 25.033456789123);
  assert.equal(h.ui("origin").value, "121.561123456789, 25.033456789123");
  assert.equal(pressed("origin"), "false");
  for (let repeat = 0; repeat < 3; repeat++) {
    select("destination"); click(121.562 + repeat / 10000, 25.034);
    assert.equal(pressed("destination"), "false");
  }
  assert.equal(h.requestQueries.length, 3, "選點不新增或查詢需求");
  assert.equal(h.requestList.requests.length, 3);
  assert.equal(h.model.playback, null);
  assert.deepEqual(h.model.coordinates, position);
  assert.equal(h.model.rotations.length, rotations);
  assert.equal(h.lines.size, 0);
  assert.deepEqual(h.requestMarkers, markers);
  assert.equal(h.requestMarkers.some((marker) => marker.removed), false);
});

test("選點解除跟隨，查詢或播放取消模式並禁止選點", async () => {
  const h = await setup();
  const pressed = () => h.ui("select-origin").attributes["aria-pressed"];
  {
    h.ui("follow").handlers.click();
    const locks = h.camera.locks, releases = h.camera.releases;
    h.ui("select-origin").handlers.click(); h.frame();
    assert.equal(pressed(), "true");
    assert.equal(h.camera.locks, locks);
    assert.equal(h.camera.releases, releases + 1);
    assert.equal(h.ui("follow").disabled, false);
    h.nodes.get("window").handlers.keydown({ key: "Escape" });
  }
  h.ui("select-origin").handlers.click();
  selectRequest(h, "request-02"); h.ui("transport").handlers.click();
  assert.equal(pressed(), "false");
  assert.equal(h.ui("select-origin").disabled, true);
  h.ui("select-origin").handlers.click();
  assert.equal(pressed(), "false");
  const request = h.requestList.requests[1];
  h.queries[0].callback(h.result([[121.561, 25.0334], request.origin]), "OK"); await flushTask();
  assert.equal(h.model.playing, true);
  endSegment(h); endSegment(h);
  assert.equal(h.ui("select-origin").disabled, false);
});

test("座標展開與收合保留原始無效草稿，編輯取消選點，收合妥善移回焦點", async () => {
  const h = await setup();
  const toggle = () => h.ui("toggle-coordinates").handlers.click();
  assert.equal(h.ui("coordinate-inputs").hidden, true);
  assert.equal(h.ui("coordinate-preview").hidden, false);
  assert.equal(h.ui("origin-preview").textContent, "未設定");
  toggle();
  assert.equal(h.ui("coordinate-inputs").hidden, false);
  assert.equal(h.ui("coordinate-preview").hidden, true);
  const raw = '  <img src=x onerror="alert(1)">, 尚未輸完  ';
  for (const endpoint of ["origin", "destination"]) {
    h.ui(`select-${endpoint}`).handlers.click();
    h.ui(endpoint).value = raw;
    h.ui(endpoint).handlers.input();
    assert.equal(h.ui(`select-${endpoint}`).attributes["aria-pressed"], "false");
    assert.equal(h.ui(`${endpoint}-preview`).textContent, raw);
    assert.equal(h.ui("error").hidden, true, "編輯中不驗證格式");
  }
  h.ui("origin").focus(); toggle();
  assert.equal(h.activeElement, h.ui("toggle-coordinates"));
  assert.equal(h.ui("toggle-coordinates").attributes["aria-expanded"], "false");
  assert.equal(h.ui("coordinate-inputs").hidden, true);
  assert.equal(h.ui("coordinate-preview").hidden, false);
  assert.equal(h.ui("origin-preview").textContent, raw);
  toggle();
  assert.equal(h.ui("origin").value, raw);
  assert.equal(h.ui("destination").value, raw);
  assert.equal(h.requestQueries.length, 3);
  assert.equal(h.requestList.requests.length, 3);
  assert.equal(h.queries.length, 0);
  h.add();
  assert.match(h.ui("error").textContent, /座標格式錯誤/);
  assert.equal(h.ui("origin").value, raw);
  assert.equal(h.requestList.requests.length, 3);
  h.disposeVehicle();
});

test("收合時地圖選點同步摘要且不展開，成功新增同步清空輸入與摘要", async () => {
  const h = await setup();
  const map = h.nodes.get("map");
  for (const [endpoint, lng, lat] of [["origin", 121.55, 25.04], ["destination", 121.56, 25.05]]) {
    h.ui(`select-${endpoint}`).handlers.click();
    map.handlers.pointerdown({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100 });
    map.handlers.pointerup({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 0, clientX: 100, clientY: 100 });
    h.click(lng, lat);
    assert.equal(h.ui(endpoint).value, `${lng}, ${lat}`);
    assert.equal(h.ui(`${endpoint}-preview`).textContent, `${lng}, ${lat}`);
    assert.equal(h.ui("coordinate-inputs").hidden, true);
  }
  assert.equal(h.requestQueries.length, 3);
  h.add(); await h.requestMap.loading;
  assert.equal(h.requestList.requests.length, 4);
  assert.deepEqual(h.requestList.requests[3].origin, [121.55, 25.04]);
  for (const endpoint of ["origin", "destination"]) {
    assert.equal(h.ui(endpoint).value, "");
    assert.equal(h.ui(`${endpoint}-preview`).textContent, "未設定");
  }
  assert.equal(h.ui("coordinate-inputs").hidden, true);
  h.disposeVehicle();
});

test("接送跟隨中切換與編輯草稿不改任務或鏡頭，隨機需求保留展開狀態", async () => {
  const h = await setup({ random: fixedRandom() });
  selectRequest(h, "request-01"); h.ui("follow").handlers.click(); h.ui("transport").handlers.click();
  const before = { playback: h.model.playback, position: [...h.model.coordinates], camera: { ...h.camera }, queryCount: h.requestQueries.length };
  for (const expanded of [true, false, true]) {
    h.ui("toggle-coordinates").handlers.click();
    h.ui("origin").value = "草稿原文"; h.ui("origin").handlers.input();
    assert.equal(h.ui("select-origin").disabled, true);
    assert.equal(h.ui("select-destination").disabled, true);
    assert.equal(h.ui("coordinate-inputs").hidden, !expanded);
    assert.equal(h.requestQueries.length, before.queryCount);
    assert.deepEqual(h.model.coordinates, before.position);
    assert.deepEqual(h.camera, before.camera);
    assert.equal(h.model.playback, before.playback);
  }
  for (const expanded of [true, false]) {
    if (!expanded) h.ui("toggle-coordinates").handlers.click();
    h.ui("random-request").handlers.click(); await h.requestMap.loading;
    assert.equal(h.ui("coordinate-inputs").hidden, !expanded);
    assert.equal(h.ui("origin").value, "草稿原文");
    assert.equal(h.ui("origin-preview").textContent, "草稿原文");
    assert.equal(h.requestList.selectedRequestId, "request-01");
    assert.deepEqual(h.camera, before.camera);
    assert.equal(h.model.playback, before.playback);
  }
  h.disposeVehicle(); await flushTask();
});

test("合併座標輸入驗證後才新增需求，比例只在套用時更新", async () => {
  const h = await setup();
  const position = [...h.model.coordinates], rotations = h.model.rotations.length;
  h.ui("scale").value = "20";
  assert.deepEqual(h.model.scales, []);
  h.ui("apply-scale").handlers.click();
  assert.deepEqual(h.model.scales, [2]);
  assert.equal(h.model.renderedScale, 20, "套用後無須操作鏡頭就呈現新比例");
  for (const value of ["", "0", "1001", "NaN"]) {
    h.ui("scale").value = value;
    h.ui("apply-scale").handlers.click();
    assert.deepEqual(h.model.scales, [2]);
    assert.match(h.ui("error").textContent, /有效數值/);
  }
  assert.deepEqual(h.model.coordinates, position);
  assert.equal(h.model.rotations.length, rotations);
  for (const value of ["", " ", "121", ",25", "121,", "121,25,1", "NaN,25", "181,25", "121,91", "1e999,25"]) {
    h.ui("origin").value = value;
    h.add();
    assert.equal(h.requestList.requests.length, 3);
    assert.match(h.ui("error").textContent, /起點.*座標/);
  }
  h.ui("origin").value = " 121.561 , 25.0334 ";
  h.ui("destination").value = "121.562,25.034";
  h.add(); await flushTask();
  assert.equal(h.requestList.requests.length, 4);
  assert.deepEqual(h.requestList.requests[3].origin, [121.561, 25.0334]);
  assert.deepEqual(h.requestList.requests[3].destination, [121.562, 25.034]);
  assert.deepEqual(h.model.coordinates, position);
  selectRequest(h, "request-01");
  for (const value of ["", "0", "301", "100.1", "NaN", "Infinity", "-1"]) {
    h.ui("speed").value = value;
    h.ui("transport").handlers.click();
    assert.equal(h.model.playback, null);
    assert.equal(h.requestList.requests[0].status, "pending");
  }
  setSpeed(h, 12);
  h.ui("transport").handlers.click();
  assert.equal(h.model.playback.durationSeconds, 600);
});

test("共用比例與輸入草稿分開，相同值不累乘，新登記模型繼承最後成功值", () => {
  let redraws = 0;
  const settings = createModelSettings({ initialScale: 10, redraw: () => redraws++ });
  const first = { scale: 10, setScale(value) { this.scale = 10 * value; } };
  settings.register({ id: "車輛 01", model: first, initialScale: 10, isBusy: () => false });
  settings.apply(20); settings.apply(20); settings.apply(5);
  assert.equal(first.scale, 5);
  assert.equal(settings.appliedScale, 5);
  const later = { scale: 2, setScale(value) { this.scale = 2 * value; } };
  settings.register({ id: "模擬後續模型", model: later, initialScale: 2, isBusy: () => false });
  assert.equal(later.scale, 5);
  settings.apply(20);
  assert.equal(first.scale, 20);
  assert.equal(later.scale, 20);
  assert.equal(redraws, 5);
});

test("任一模型忙碌或套用失敗不得宣稱全域成功，清理後不能操作", () => {
  let busy = true, fail = false, renders = 0;
  const settings = createModelSettings({ initialScale: 10, redraw: () => renders++ });
  const first = { calls: 0, setScale() { this.calls++; } };
  settings.register({ id: "車輛 01", model: first, initialScale: 10, isBusy: () => false });
  settings.register({ id: "模擬後續模型", model: { setScale() { if (fail) throw new Error("比例拒絕"); } }, initialScale: 10, isBusy: () => busy });
  assert.equal(settings.canApply(), false);
  assert.throws(() => settings.apply(20), /接送中/);
  assert.equal(first.calls, 0);
  busy = false;
  for (const value of [NaN, Infinity, 0, 1001]) assert.throws(() => settings.apply(value), /有效模型比例/);
  settings.apply(20);
  fail = true;
  assert.throws(() => settings.apply(30), /未全部套用.*模擬後續模型.*比例拒絕/);
  assert.equal(settings.appliedScale, 20);
  assert.equal(renders, 2);
  settings.clear();
  assert.equal(settings.canApply(), false);
  assert.throws(() => settings.apply(10), /尚未就緒/);
});

test("需求選取與重繪保留唯一識別碼，不改變車輛、鏡頭或路線", async () => {
  const h = await setup();
  const list = h.ui("request-list");
  const select = (id, checked = true) => list.handlers.change({ target: { type: "radio", name: "proj01-request", value: id, checked } });
  assert.equal(h.requestList.selectedRequestId, null);
  select("request-01");
  h.ui("follow").handlers.click(); h.frame();
  h.ui("transport").handlers.click(); h.frame();
  const before = { origin: h.ui("origin").value, destination: h.ui("destination").value,
    position: [...h.model.coordinates], rotations: [...h.model.rotations], playback: h.model.playback,
    lines: [...h.lines], markers: [...h.markers], camera: { ...h.camera }, frames: [...h.frames] };
  select("request-01"); select("request-01");
  select("request-01", false); select("invalid");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  h.requestList.render();
  const radio = id => list.querySelector(`input[type="radio"][value="${id}"]`);
  assert.equal(radio("request-01").checked, true);
  assert.equal(h.requestList.requests.filter(request => radio(request.id).checked).length, 1);
  select("request-03"); h.requestList.render();
  assert.equal(h.requestList.selectedRequestId, "request-03");
  assert.equal(radio("request-03").checked, true);
  assert.equal(h.queries.length, 0);
  assert.equal(h.requestQueries.length, 3, "切換需求不重查道路路線");
  assert.equal(h.requestLines.size, 3);
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 6);
  assert.equal(h.ui("origin").value, before.origin);
  assert.equal(h.ui("destination").value, before.destination);
  assert.deepEqual(h.model.coordinates, before.position);
  assert.deepEqual(h.model.rotations, before.rotations);
  assert.equal(h.model.playback, before.playback);
  assert.equal(h.model.playing, true);
  assert.deepEqual([...h.lines], before.lines);
  assert.deepEqual(h.markers, before.markers);
  assert.deepEqual(h.camera, before.camera);
  assert.deepEqual([...h.frames], before.frames);
  h.requestList.dispose();
  assert.equal(list.listeners.change.size, 0);
});

test("需求路線依序查詢，逾時與失敗獨立，選取及釋放不接受過期回應", async () => {
  const h = await setup({ manualRequests: true });
  const list = h.ui("request-list");
  const select = (id) => list.handlers.change({ target: { type: "radio", name: "proj01-request", value: id, checked: true } });
  const [first, second, third] = h.requestList.requests;
  assert.equal(h.requestQueries.length, 1);
  assert.equal(h.requestMarkers.length, 6);
  select(second.id);
  assert.ok(h.requestMarkers.slice(2, 4).every(marker => marker.options.icon.classList["proj01-request-selected"]));
  const timeout = [...h.timers.values()].find(({ delay }) => delay === 20000);
  timeout.fn();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.requestList.getRouteState(first.id).status, "error");
  assert.equal(h.requestQueries.length, 2);
  h.requestQueries[0].callback(h.result([first.origin, first.destination]), "OK");
  await Promise.resolve();
  assert.equal(h.requestLines.size, 0, "逾時回應不可補畫路線");
  const points = [second.origin, [121.546, 25.044], second.destination];
  h.requestQueries[1].callback(h.result(points), "OK");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.requestQueries.length, 3);
  const id = "proj01-request-route-" + second.id;
  assert.equal(h.requestLines.get(id).width, 7, "載入完成採用當下選取");
  assert.deepEqual(JSON.parse(JSON.stringify(h.requestLines.get(id).coordinates)), points.map(point => [...point, 0]));
  assert.deepEqual(h.requestList.getRouteState(second.id).coordinates, points);
  h.requestQueries[2].callback([], "OK");
  await h.requestMap.loading;
  assert.equal(h.requestList.getRouteState(third.id).status, "unavailable");
  assert.ok(h.requestList.requests.every(request => request.status === "pending"));
  assert.equal(h.requestLines.size, 1);
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 6);
  select(first.id);
  assert.equal(h.requestLines.get(id).width, 3);
  assert.equal(h.requestQueries.length, 3);
  assert.equal(h.timers.size, 0);
  h.requestMap.dispose(); h.requestMap.dispose();
  assert.equal(h.requestLines.size, 0);
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 0);
  select(second.id);
  assert.equal(h.requestLines.size, 0);

  const pending = await setup({ manualRequests: true });
  pending.requestMap.dispose();
  await pending.requestMap.loading;
  pending.requestQueries[0].callback(pending.result([first.origin, first.destination]), "OK");
  await Promise.resolve();
  assert.equal(pending.requestQueries.length, 1, "釋放後不繼續查下一筆");
  assert.equal(pending.timers.size, 0);
  assert.equal(pending.requestLines.size, 0);
});

const flushTask = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test("完成卡片保留節點與選取，按建立順序分區，焦點依收合狀態安置且不重設展開", async () => {
  const h = await setup();
  const list = h.ui("request-list"), section = list.querySelector("[data-request-completed]");
  const summary = list.querySelector("[data-request-completed-summary]");
  const active = list.querySelector("[data-request-active]"), completed = list.querySelector("[data-request-completed-list]");
  const card = id => list.querySelector(`[data-request-id="${id}"]`);
  const radio = id => list.querySelector(`input[type="radio"][value="${id}"]`);
  const originals = h.requestList.requests.map(request => card(request.id));
  const originalData = h.requestList.requests.map(request => ({ ...request }));
  const firstCache = h.requestList.getRouteState("request-01");
  assert.equal(section.hidden, true);
  assert.equal(section.open, false);
  for (const status of ["assigned", "pickingUp", "onboard"]) {
    h.requestList.setStatus("request-02", status);
    assert.deepEqual(active.children, originals, "未完成狀態皆留在主清單");
  }
  h.requestList.setStatus("request-03", "completed");
  assert.equal(section.hidden, false);
  assert.equal(section.open, false);
  h.requestList.selectById("request-01"); radio("request-01").focus();
  h.requestList.setStatus("request-01", "completed");
  assert.equal(h.activeElement, summary, "卡片移入收合區時焦點落在 summary");
  assert.deepEqual(completed.children, [originals[0], originals[2]], "完成順序不改建立順序");
  assert.deepEqual(active.children, [originals[1]]);
  assert.equal(summary.textContent, "已完成（2）");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal(radio("request-01").checked, true);
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.requestList.getRouteState("request-01"), firstCache);
  assert.equal(h.requestLines.has("proj01-request-route-request-01"), false);
  section.open = true;
  h.requestList.addRequest([121.54, 25.04], [121.55, 25.05]); await h.requestMap.loading;
  h.requestList.setRouteState("request-01", { ...firstCache, error: "更新提示" });
  radio("request-02").focus();
  h.requestList.setStatus("request-02", "completed");
  assert.equal(h.activeElement, radio("request-02"), "完成區已展開時保留原控制項焦點");
  assert.equal(section.open, true);
  assert.deepEqual(completed.children, originals);
  assert.deepEqual(active.children, [card("request-04")]);
  assert.equal(summary.textContent, "已完成（3）");
  h.requestList.render();
  assert.deepEqual(completed.children, originals);
  assert.equal(h.activeElement, radio("request-02"));
  for (const original of originalData) {
    const current = h.requestList.requests.find(request => request.id === original.id);
    assert.equal(current.color, original.color);
    assert.deepEqual(current.origin, original.origin); assert.deepEqual(current.destination, original.destination);
  }
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 8);
  h.disposeVehicle();
});

test("延遲路線回應、選取與樣式重載不能復活已完成預覽，快取及端點保留", async () => {
  const h = await setup({ manualRequests: true });
  const first = h.requestList.requests[0];
  h.requestList.selectById(first.id);
  h.requestList.setStatus(first.id, "completed");
  h.requestQueries[0].callback(h.result([first.origin, first.destination]), "OK"); await flushTask();
  const cache = h.requestList.getRouteState(first.id);
  assert.equal(cache.durationSeconds, 300);
  assert.deepEqual(cache.coordinates, [first.origin, first.destination]);
  for (let i = 1; i < 3; i++) {
    const request = h.requestList.requests[i];
    h.requestQueries[i].callback(h.result([request.origin, request.destination]), "OK"); await flushTask();
  }
  await h.requestMap.loading;
  h.ui("request-list").querySelector("[data-request-completed]").open = true;
  h.requestList.selectById("request-02"); h.requestList.selectById(first.id);
  h.requestList.render(); h.map.emit("style.load");
  h.requestList.setRouteState(first.id, { ...cache });
  assert.equal(h.requestLines.has(`proj01-request-route-${first.id}`), false);
  assert.equal(h.requestLines.size, 2);
  assert.equal(h.requestQueries.length, 3, "查看完成卡片不重新查詢");
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 6);
  h.disposeVehicle(); h.requestMap.dispose();
  h.map.emit("style.load"); assert.equal(h.requestLines.size, 0);
});

test("完成另一筆僅移除其預覽，不影響其他路線、執行任務或跟隨", async () => {
  const h = await setup();
  selectRequest(h, "request-01"); h.ui("follow").handlers.click(); h.ui("transport").handlers.click();
  const before = { playback: h.model.playback, line: [...h.lines.values()][0], camera: { ...h.camera },
    position: [...h.model.coordinates], others: [h.requestLines.get("proj01-request-route-request-01"), h.requestLines.get("proj01-request-route-request-02")] };
  h.requestList.setStatus("request-03", "completed");
  assert.equal(h.requestLines.has("proj01-request-route-request-03"), false);
  assert.equal(h.requestLines.get("proj01-request-route-request-01"), before.others[0]);
  assert.equal(h.requestLines.get("proj01-request-route-request-02"), before.others[1]);
  assert.equal(h.model.playback, before.playback); assert.equal([...h.lines.values()][0], before.line);
  assert.deepEqual(h.camera, before.camera); assert.deepEqual(h.model.coordinates, before.position);
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal(h.ui("follow").disabled, true);
  h.disposeVehicle(); await flushTask();
});

const fixedRandom = () => {
  let index = 0;
  return () => [0.2, 0.3, 0.8, 0.7][index++ % 4];
};

test("隨機需求一次點擊只新增一筆，保留草稿、選取與鏡頭並沿用標記及路線快取", async () => {
  const h = await setup({ random: fixedRandom() });
  selectRequest(h, "request-02");
  h.ui("origin").value = "手動起點草稿"; h.ui("destination").value = "手動終點草稿";
  const before = { position: [...h.model.coordinates], camera: { ...h.camera }, queries: h.requestQueries.length };
  h.ui("random-request").handlers.click();
  assert.equal(h.requestList.requests.length, 4);
  assert.equal(h.requestMarkers.length, 8, "立即附加起終點標記");
  const added = h.requestList.requests[3];
  assert.equal(added.id, "request-04");
  assert.equal(added.color, "#7e22ce");
  assert.equal(added.status, "pending");
  assert.equal(h.requestQueries.length, before.queries + 1);
  assert.deepEqual([...h.requestQueries[3].options.origin], added.origin);
  assert.deepEqual([...h.requestQueries[3].options.destination], added.destination);
  await h.requestMap.loading;
  assert.equal(h.requestList.getRouteState(added.id).durationSeconds, 600);
  assert.equal(h.requestLines.size, 4);
  assert.equal(h.ui("origin").value, "手動起點草稿");
  assert.equal(h.ui("destination").value, "手動終點草稿");
  assert.equal(h.requestList.selectedRequestId, "request-02");
  assert.deepEqual(h.model.coordinates, before.position);
  assert.deepEqual(h.camera, before.camera);
  assert.equal(h.model.playbacks.length, 0);
  assert.equal(h.queries.length, 0);
  h.disposeVehicle();
});

test("隨機抽樣 20 次失敗不新增、不查路線且保留草稿與選取", async () => {
  let calls = 0;
  const h = await setup({ random: () => { calls++; return 0.5; } });
  selectRequest(h, "request-02");
  h.ui("origin").value = "起點草稿"; h.ui("destination").value = "終點草稿";
  h.ui("random-request").handlers.click();
  assert.equal(calls, 80);
  assert.equal(h.requestList.requests.length, 3);
  assert.equal(h.requestQueries.length, 3);
  assert.equal(h.requestMarkers.length, 6);
  assert.match(h.ui("error").textContent, /無法產生隨機需求/);
  assert.equal(h.ui("origin").value, "起點草稿");
  assert.equal(h.ui("destination").value, "終點草稿");
  assert.equal(h.requestList.selectedRequestId, "request-02");
  h.disposeVehicle();
});

test("隨機需求沿用查詢佇列與接送資格，失敗不重抽，路線途中可超出矩形", async () => {
  for (const mode of ["error", "invalid", "no-time", "valid"]) {
    const h = await setup({ manualRequests: true, random: fixedRandom() });
    h.ui("random-request").handlers.click();
    const added = h.requestList.requests[3];
    selectRequest(h, added.id);
    assert.equal(h.requestQueries.length, 1, "隨機需求排在既有查詢之後");
    assert.equal(h.requestMarkers.length, 8);
    for (let i = 0; i < 3; i++) { h.requestQueries[i].callback([], "ERROR"); await flushTask(); }
    assert.equal(h.requestQueries.length, 4);
    assert.equal(h.ui("transport").disabled, true);
    assert.equal(h.ui("auto-transport").disabled, true);
    h.ui("transport").handlers.click(); h.ui("auto-transport").handlers.click();
    assert.equal(h.queries.length, 0);
    assert.equal(h.model.playbacks.length, 0);
    const response = h.result([added.origin, [121.58, 25.07], added.destination]);
    if (mode === "no-time") delete response[0].legs[0].duration;
    if (mode === "invalid") response[0].legs[0].steps[0].polyline.points = JSON.stringify([[25, 121], [25.01, 121.01]]);
    h.requestQueries[3].callback(mode === "error" ? [] : response, mode === "error" ? "ERROR" : "OK");
    await h.requestMap.loading;
    assert.equal(h.requestList.requests.length, 4);
    assert.equal(h.requestQueries.length, 4, "不自動重抽或重新查詢");
    assert.equal(added.status, "pending");
    assert.equal(h.model.playbacks.length, 0, "查詢完成不自動接送");
    if (mode === "valid") {
      assert.equal(h.ui("transport").disabled, false);
      assert.equal(h.ui("auto-transport").disabled, false);
      assert.equal(h.requestLines.size, 1);
      h.model.coordinates = [...added.origin, 0];
      h.ui("transport").handlers.click();
      assert.equal(h.model.playbacks.length, 1);
    } else {
      assert.equal(h.ui("transport").disabled, true);
      assert.equal(h.ui("auto-transport").disabled, true);
      h.ui("transport").handlers.click(); h.ui("auto-transport").handlers.click();
      assert.equal(h.model.playbacks.length, 0);
      assert.equal(h.requestLines.size, mode === "no-time" ? 1 : 0);
      assert.ok(h.requestList.getRouteState(added.id).error);
    }
    h.disposeVehicle(); await flushTask();
  }
});

test("接送與跟隨中生成隨機需求保留任務、位置、鏡頭及草稿", async () => {
  const h = await setup({ random: fixedRandom() });
  selectRequest(h, "request-01"); h.ui("follow").handlers.click();
  h.ui("transport").handlers.click(); h.frame(1000);
  h.ui("origin").value = "草稿";
  const before = { playback: h.model.playback, position: [...h.model.coordinates], camera: { ...h.camera },
    targets: [...h.cameraTargets], line: [...h.lines.values()][0], status: h.ui("status").textContent };
  h.ui("random-request").handlers.click(); await h.requestMap.loading;
  assert.equal(h.requestList.requests.length, 4);
  assert.equal(h.requestList.requests[3].status, "pending");
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal(h.ui("origin").value, "草稿");
  assert.equal(h.model.playback, before.playback);
  assert.deepEqual(h.model.coordinates, before.position);
  assert.deepEqual(h.camera, before.camera);
  assert.deepEqual(h.cameraTargets, before.targets);
  assert.equal([...h.lines.values()][0], before.line);
  assert.equal(h.ui("status").textContent, before.status);
  assert.equal(h.ui("follow").disabled, true);
  h.frame(1000);
  assert.notDeepEqual(h.model.coordinates, before.position, "原任務繼續移動");
  h.disposeVehicle(); await flushTask();
});
const setSpeed = (h, multiplier) => {
  h.ui("speed").value = String(multiplier);
  h.ui("speed").handlers.input();
};
const selectRequest = (h, id) => h.ui("request-list").handlers.change({ target: { type: "radio", name: "proj01-request", value: id, checked: true } });

test("自動接送從當下位置選原始起點最近需求，鎖定後不換單或失敗換下一筆", async () => {
  const h = await setup();
  assert.equal(h.requestList.selectedRequestId, null);
  assert.equal(h.ui("auto-transport").disabled, false);
  h.model.coordinates = [121.542, 25.041, 0];
  const position = [...h.model.coordinates];
  const html = h.ui("request-list").innerHTML;
  h.ui("auto-transport").handlers.click();
  assert.equal(h.requestList.selectedRequestId, "request-02");
  assert.equal(h.requestList.requests[1].status, "assigned");
  assert.deepEqual([...h.queries[0].options.origin], position.slice(0, 2));
  assert.deepEqual([...h.queries[0].options.destination], h.requestList.requests[1].origin);
  assert.equal(h.ui("auto-transport").disabled, true);
  assert.equal(h.requestMarkers.slice(2, 4).every(marker => marker.options.icon.classList["proj01-request-selected"]), true);
  assert.equal(h.ui("request-list").querySelector('input[type="radio"][value="request-02"]').checked, true);
  assert.equal(h.ui("request-list").innerHTML, html);
  selectRequest(h, "request-01");
  h.ui("transport").handlers.click(); h.ui("auto-transport").handlers.click();
  assert.equal(h.queries.length, 1);
  h.queries[0].callback([], "ERROR"); await flushTask();
  assert.ok(h.requestList.requests.every(request => request.status === "pending"));
  assert.deepEqual(h.model.coordinates, position);
  assert.equal(h.queries.length, 1, "失敗不能自動換下一筆");
  assert.equal(h.model.playback, null);
  assert.equal(h.ui("auto-transport").disabled, false);
  h.model.coordinates = [NaN, 25.041, 0];
  h.ui("auto-transport").handlers.click(); await flushTask();
  assert.match(h.ui("error").textContent, /有效.*座標/);
  assert.ok(h.requestList.requests.every(request => request.status === "pending"));
  assert.equal(h.queries.length, 1);
  h.model.coordinates = [...position];
  h.ui("auto-transport").handlers.click();
  h.queries[1].callback(h.result([position.slice(0, 2), h.requestList.requests[1].origin]), "OK"); await flushTask();
  endSegment(h, h.model.playback);
  const dropoff = h.model.playback;
  // setter 未實際移動模型時，不得標完成或自動換下一筆。
  h.model.setCoordinates = () => {};
  endSegment(h, dropoff);
  assert.equal(h.requestList.requests[1].status, "onboard");
  assert.match(h.ui("error").textContent, /模型位置未到達/);
  assert.equal(h.model.playbacks.length, 2);
  assert.equal(h.queries.length, 2);
});

test("自動接送每次只執行一筆，完成後從新位置重新排序且排除不可用需求", async () => {
  const h = await setup();
  const [first, second, third] = h.requestList.requests;
  // 第一筆送人道路終點接近第三筆，不能沿用初始車位挑第二筆。
  h.requestList.setRouteState(first.id, { status: "ready", durationSeconds: 600, coordinates: [first.origin, third.origin] });
  h.ui("auto-transport").handlers.click();
  assert.equal(h.requestList.selectedRequestId, first.id);
  assert.equal(h.queries.length, 0);
  endSegment(h, h.model.playback);
  assert.equal(first.status, "completed");
  assert.equal(h.model.playbacks.length, 1, "完成不自動接下一筆");
  h.ui("auto-transport").handlers.click();
  assert.equal(h.requestList.selectedRequestId, third.id);
  assert.equal(third.status, "onboard");
  assert.equal(h.queries.length, 0, "在新起點附近略過接人");
  h.ui("auto-transport").handlers.click(); h.ui("transport").handlers.click();
  assert.equal(h.model.playbacks.length, 2);
  endSegment(h, h.model.playback);
  h.requestList.setRouteState(second.id, { status: "unavailable" });
  assert.equal(h.ui("auto-transport").disabled, true);
  h.ui("auto-transport").handlers.click();
  assert.equal(h.model.playbacks.length, 2);
  h.requestList.setRouteState(second.id, { status: "ready", durationSeconds: 600, coordinates: [second.origin, second.destination] });
  assert.equal(h.ui("auto-transport").disabled, false, "目前選取已完成仍可自動接其他需求");
  for (const status of ["assigned", "pickingUp", "onboard", "completed"]) {
    h.requestList.setStatus(second.id, status);
    assert.equal(h.ui("auto-transport").disabled, true);
  }
});

test("同距離按清單順序選擇，不按終點或送人路線長度排序", async () => {
  const h = await setup();
  const [first, second, third] = h.requestList.requests;
  first.origin = [...second.origin];
  h.requestList.setRouteState(first.id, { status: "ready", durationSeconds: 600, coordinates: [first.origin, third.destination] });
  h.requestList.setRouteState(third.id, { status: "loading" });
  h.model.coordinates = [121.542, 25.041, 0];
  h.ui("auto-transport").handlers.click();
  assert.equal(h.requestList.selectedRequestId, first.id);
  assert.equal(h.queries.length, 1);
  h.disposeVehicle(); await flushTask();
});
const endSegment = (h, playback = h.model.playback) => {
  const remaining = playback.durationSeconds - playback.handle.elapsedSeconds;
  h.frame((remaining + 1e-8) * 1000 / Number(h.ui("speed").value));
};

test("新增驗證、座標副本與連點只建立一筆，保留選取、狀態與車位", async () => {
  const h = await setup();
  const [, second] = h.requestList.requests;
  h.requestList.selectById(second.id);
  h.requestList.setStatus(second.id, "completed");
  const before = { position: [...h.model.coordinates], rotations: [...h.model.rotations], camera: { ...h.camera } };
  h.ui("origin").value = h.ui("destination").value = "121.561, 25.0334";
  h.add();
  assert.match(h.ui("error").textContent, /不能相同/);
  assert.equal(h.requestList.requests.length, 3);
  h.ui("destination").value = "121.567, 25.034";
  h.add(); h.add(); await flushTask();
  assert.equal(h.requestList.requests.length, 4);
  const added = h.requestList.requests[3];
  assert.equal(added.id, "request-04");
  assert.equal(added.status, "pending");
  assert.equal(h.ui("origin").value, "");
  assert.equal(h.ui("destination").value, "");
  assert.equal(h.requestList.selectedRequestId, second.id);
  assert.equal(second.status, "completed");
  assert.equal(h.requestLines.size, 3, "新增後未完成需求的路線持續顯示");
  const origin = [121.543, 25.041], destination = [121.553, 25.045];
  const copy = h.requestList.addRequest(origin, destination);
  origin[0] = 0; destination[1] = 0;
  assert.deepEqual(copy.origin, [121.543, 25.041]);
  assert.deepEqual(copy.destination, [121.553, 25.045]);
  assert.equal(copy.id, "request-05");
  assert.notEqual(copy.color, added.color);
  assert.deepEqual(h.model.coordinates, before.position);
  assert.deepEqual(h.model.rotations, before.rotations);
  assert.deepEqual(h.camera, before.camera);
  assert.equal(h.model.playback, null);
});

test("初始化查詢中新增仍依序查一次，路線持續顯示且失敗保留，釋放後不再新增圖層", async () => {
  const h = await setup({ manualRequests: true });
  const fourth = h.requestList.addRequest([121.562, 25.034], [121.563, 25.035]);
  assert.equal(h.requestMarkers.length, 8);
  assert.equal(h.requestQueries.length, 1);
  for (let index = 0; index < 4; index++) {
    const request = h.requestList.requests[index];
    assert.equal(h.requestQueries.length, index + 1);
    h.requestQueries[index].callback(h.result([request.origin, request.destination]), "OK");
    await flushTask();
  }
  await h.requestMap.loading;
  const id = `proj01-request-route-${fourth.id}`;
  assert.equal(h.requestList.getRouteState(fourth.id).status, "ready");
  assert.equal(h.requestLines.has(id), true, "查詢完成即顯示路線");
  h.requestList.selectById(fourth.id);
  h.requestList.setStatus(fourth.id, "assigned");
  assert.equal(h.requestLines.size, 4, "選取及狀態更新保留全部路線");
  const cached = h.requestList.getRouteState(fourth.id);
  assert.equal(h.requestLines.get(id).width, 7);
  assert.equal(h.requestQueries.length, 4);
  assert.equal(h.requestList.getRouteState(fourth.id), cached);
  const fifth = h.requestList.addRequest([121.544, 25.04], [121.554, 25.045]);
  assert.equal(h.requestQueries.length, 5, "佇列閒置後新增也會開始查詢");
  h.requestQueries[4].callback([], "ERROR"); await h.requestMap.loading;
  assert.equal(h.requestList.getRouteState(fifth.id).status, "error");
  assert.equal(fifth.status, "pending");
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 10);
  assert.equal(h.requestLines.size, 4);
  h.requestMap.dispose();
  h.requestList.addRequest([121.545, 25.04], [121.555, 25.045]);
  assert.equal(h.requestQueries.length, 5);
  assert.equal(h.requestLines.size, 0);
});

test("接送中新增不換任務，需求路線持續顯示且保留選取、快取與任務線", async () => {
  const h = await setup();
  selectRequest(h, "request-01");
  h.ui("transport").handlers.click();
  const playback = h.model.playback, current = [...h.model.coordinates], camera = { ...h.camera };
  const line = [...h.lines.values()][0];
  assert.equal(h.ui("origin").disabled, false);
  assert.equal(h.ui("add-request").disabled, false);
  assert.equal(h.ui("select-origin").disabled, true);
  const id = "proj01-request-route-request-01";
  const cached = h.requestList.getRouteState("request-01");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal(h.requestLines.has(id), true);
  assert.equal(h.requestLines.size, 3);
  h.ui("origin").value = "121.561, 25.0334";
  h.ui("destination").value = "121.565, 25.035";
  h.add(); await flushTask();
  assert.equal(h.requestList.requests.length, 4);
  assert.equal(h.model.playback, playback);
  assert.deepEqual(h.model.coordinates, current);
  assert.deepEqual(h.camera, camera);
  assert.equal(h.requestLines.size, 4);
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal([...h.lines.values()][0], line);
  assert.equal(h.requestLines.has(id), true);
  assert.equal(h.requestList.getRouteState("request-01"), cached);
  assert.equal(h.requestQueries.length, 4, "新增只查新需求，狀態更新不重查");
  endSegment(h, playback);
  assert.equal(h.requestLines.size, 3, "接送完成僅隱藏該筆預覽路線");
  assert.equal(h.requestList.requests[0].status, "completed");
  assert.equal(h.requestList.requests[3].status, "pending");
  // 新需求 ready 後可沿用同一接送入口；從目前車位查接人，而非新增時瞬移。
  selectRequest(h, "request-04");
  h.ui("transport").handlers.click();
  assert.deepEqual([...h.queries[0].options.origin], [...playback.path.at(-1)].slice(0, 2));
  h.disposeVehicle(); await flushTask();
});

test("已在起點時略過接人，只服務保留需求，完成後清除任務線", async () => {
  const h = await setup();
  assert.equal(h.ui("transport").disabled, true);
  selectRequest(h, "request-01");
  assert.equal(h.ui("transport").disabled, false);
  setSpeed(h, 12);
  const html = h.ui("request-list").innerHTML;
  h.ui("transport").handlers.click();
  const playback = h.model.playback;
  await flushTask(); // 沒有推進時鐘不能假裝到站。
  assert.equal(h.queries.length, 0);
  assert.equal(playback.durationSeconds, 600, "保留送人官方秒數");
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.ui("vehicle-status").textContent, "送人中");
  h.ui("transport").handlers.click();
  selectRequest(h, "request-02");
  h.ui("select-origin").handlers.click();
  assert.equal(h.model.playbacks.length, 1);
  assert.equal(h.queries.length, 0);
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.ui("select-origin").attributes["aria-pressed"], "false");
  for (const control of ["scale", "apply-scale"]) assert.equal(h.ui(control).disabled, true);
  endSegment(h, playback);
  h.frame();
  assert.equal(h.requestList.requests[0].status, "completed");
  assert.equal(h.requestList.requests[1].status, "pending");
  assert.equal(h.ui("vehicle-status").textContent, "閒置");
  assert.deepEqual(h.model.coordinates, [...playback.path.at(-1)]);
  assert.equal(h.model.playbacks.length, 1);
  assert.equal(h.lines.size, 0);
  assert.equal(h.ui("transport").disabled, false, "可再服務另一筆");
  selectRequest(h, "request-01");
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.ui("request-list").innerHTML, html, "狀態更新不能重建清單");
  assert.equal(h.requestMarkers.slice(0, 2).every(marker => marker.options.icon.classList["proj01-request-completed"]), true);
  assert.equal(h.requestLines.size, 2);
});

test("接人與送人保留官方時間，準備與播放可改倍率且保留需求路線", async () => {
  const h = await setup();
  const current = [121.53, 25.035, 0];
  h.model.coordinates = [...current];
  selectRequest(h, "request-02");
  setSpeed(h, 60);
  h.ui("follow").handlers.click(); h.frame();
  const cached = h.requestList.getRouteState("request-02");
  h.ui("transport").handlers.click();
  const request = h.queries[0];
  assert.deepEqual(JSON.parse(JSON.stringify(request.options.origin)), current.slice(0, 2));
  assert.deepEqual([...request.options.destination], h.requestList.requests[1].origin);
  assert.equal(h.requestList.requests[1].status, "assigned");
  assert.equal(h.ui("vehicle-status").textContent, "準備接送");
  assert.equal(h.model.playbacks.length, 0);
  for (const name of ["select-origin", "select-destination", "scale"]) {
    assert.equal(h.ui(name).disabled, true, "準備查詢期間也須停用會干擾任務的控制項");
  }
  selectRequest(h, "request-03"); h.ui("transport").handlers.click();
  h.ui("speed").value = "100"; h.ui("speed").handlers.input();
  assert.equal(h.ui("speed").disabled, false);
  const pickupPoints = [current.slice(0, 2), [121.538, 25.04], h.requestList.requests[1].origin];
  // 模擬 SDK 調整查詢陣列順序；本次任務的 C、A 驗證基準仍須保持。
  request.options.origin.reverse(); request.options.destination.reverse();
  request.callback(h.result(pickupPoints), "OK"); await flushTask();
  const pickup = h.model.playback;
  assert.equal(h.requestList.requests[1].status, "pickingUp");
  assert.equal(h.ui("vehicle-status").textContent, "前往接人");
  assert.deepEqual(JSON.parse(JSON.stringify(pickup.path)), pickupPoints.map(point => [...point, 0]));
  assert.equal(pickup.durationSeconds, 300);
  assert.equal(h.model.playbacks.length, 1);
  assert.equal(h.ui("follow").disabled, true);
  h.frame();
  const mapElement = h.nodes.get("map");
  mapElement.handlers.pointerdown({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100 });
  mapElement.handlers.pointermove({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 110, clientY: 100 });
  assert.equal(h.model.playing, true);
  assert.equal(h.ui("follow").disabled, false, "拖曳解除不停止接送");
  h.ui("follow").handlers.click(); h.frame();
  endSegment(h, pickup);
  const dropoff = h.model.playback;
  assert.notEqual(dropoff, pickup);
  assert.equal(h.model.playbacks.length, 2);
  assert.equal(h.requestList.requests[1].status, "onboard");
  assert.equal(dropoff.durationSeconds, 600);
  assert.deepEqual(JSON.parse(JSON.stringify(dropoff.path)), cached.coordinates.map(point => [...point, 0]));
  h.frame();
  assert.equal(h.model.playbacks.length, 2);
  assert.equal(h.model.playing, true);
  assert.equal(h.requestList.requests[2].status, "pending");
  endSegment(h, dropoff); h.frame();
  assert.equal(h.requestList.requests[1].status, "completed");
  assert.equal(h.requestList.selectedRequestId, "request-03");
  assert.equal(h.ui("vehicle-status").textContent, "閒置");
  assert.equal(h.requestList.getRouteState("request-02"), cached);
  assert.equal(h.requestQueries.length, 3, "送人沿用快取");
  assert.equal(h.requestLines.size, 2);
  assert.equal(h.lines.size, 0, "完成僅清除任務線");
});

test("單幀跨過接人終點交接餘量，最新倍率繼續送人且需求只完成一次", async () => {
  const h = await setup();
  const request = h.requestList.requests[1], transitions = [];
  h.requestList.subscribeChange(() => { if (transitions.at(-1) !== request.status) transitions.push(request.status); });
  selectRequest(h, request.id); setSpeed(h, 100);
  h.ui("transport").handlers.click();
  h.queries[0].callback(h.result([[121.561,25.0334], request.origin]), "OK"); await flushTask();
  const pickup = h.model.playback;
  h.frame(4000);
  const dropoff = h.model.playback;
  assert.notEqual(dropoff, pickup); assert.equal(dropoff.handle.elapsedSeconds, 100);
  assert.equal(request.status, "onboard"); assert.equal(h.frames.size, 1);
  setSpeed(h, 50); h.frame(2000); assert.equal(dropoff.handle.elapsedSeconds, 200);
  const stale = [...h.frames.values()]; setSpeed(h, 300); h.frame(2000);
  stale.forEach(fn => fn(999999)); h.frame(1000);
  assert.deepEqual(transitions, ["assigned", "pickingUp", "onboard", "completed"]);
  assert.equal(h.model.playbacks.length, 2); assert.equal(h.ui("vehicle-status").textContent, "閒置");
});

test("準備失敗與逾時回到 pending，位置不變，遲到及已釋放回呼失效", async () => {
  const h = await setup();
  h.model.coordinates = [121.53, 25.035, 0];
  selectRequest(h, "request-02");
  const position = [...h.model.coordinates], rotations = [...h.model.rotations], camera = { ...h.camera };
  h.ui("transport").handlers.click();
  const old = h.queries[0];
  [...h.timers.values()].find(timer => timer.delay === 20000).fn(); await flushTask();
  assert.equal(h.requestList.requests[1].status, "pending");
  assert.equal(h.ui("transport").disabled, false);
  assert.match(h.ui("error").textContent, /逾時/);
  h.ui("transport").handlers.click();
  old.callback(h.result([position.slice(0, 2), h.requestList.requests[1].origin]), "OK"); await flushTask();
  assert.equal(h.requestList.requests[1].status, "assigned");
  h.queries[1].callback([], "ERROR"); await flushTask();
  assert.equal(h.requestList.requests[1].status, "pending");
  h.ui("transport").handlers.click();
  h.queries[2].callback(h.result([[121.54, 25.035], h.requestList.requests[1].origin]), "OK"); await flushTask();
  assert.equal(h.requestList.requests[1].status, "pending");
  assert.match(h.ui("error").textContent, /道路貼齊容許值/);
  assert.equal(h.model.playback, null);
  assert.deepEqual(h.model.coordinates, position);
  assert.deepEqual(h.model.rotations, rotations);
  assert.deepEqual(h.camera, camera);
  assert.equal(h.lines.size, 0);
  assert.equal(h.timers.size, 0);
  h.ui("transport").handlers.click();
  h.queries[3].callback(h.result([position.slice(0, 2), [121.54, 25.04]]), "OK"); await flushTask();
  assert.match(h.ui("error").textContent, /接人與送人路線接點/);
  assert.equal(h.requestList.requests[1].status, "pending");
  assert.equal(h.model.playback, null, "道路接不起來時不能先播放接人段");
  assert.deepEqual(h.model.coordinates, position);
  h.ui("transport").handlers.click();
  const disposedQuery = h.queries[4]; h.disposeVehicle();
  disposedQuery.callback(h.result([position.slice(0, 2), h.requestList.requests[1].origin]), "OK"); await flushTask();
  assert.equal(h.model.playback, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.lines.size, 0);
});

test("模型更新錯誤停止自管動畫，保留乘客狀態且過期更新不完成任務", async () => {
  const h = await setup();
  selectRequest(h, "request-01"); h.ui("transport").handlers.click();
  const stale = [...h.frames.values()][0];
  h.model.setCoordinates = () => { throw new Error("模擬模型錯誤"); };
  h.frame();
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.model.playing, false);
  assert.match(h.ui("error").textContent, /模擬模型錯誤/);
  assert.equal(h.ui("vehicle-status").textContent, "閒置（接送中斷）");
  assert.equal(h.frames.size, 0);
  stale(999999);
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.lines.size, 0);
  h.disposeVehicle();
});
