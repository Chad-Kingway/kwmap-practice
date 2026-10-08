import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { distanceMeters } from "../src/proj01/proj01-transport.js";
import { createModelSettings } from "../src/proj01/proj01-model-settings.js";
import { mountPoiToggle } from "../src/proj01/proj01-map-display.js";
import { mountRequestList } from "../src/proj01/proj01-requests.js";
import { normalizeDirections, validateEndpoints, parseCoordinate, validCoordinate } from "../src/proj01/proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "../src/proj01/proj01-heading.js";

// 隔離外部服務與渲染，只檢查查詢競態、控制狀態及有效路線的替換流程。
async function setup({ manualRequests = false } = {}) {
  const nodes = new Map(), timers = new Map(), queries = [], markers = [], lines = new Map(), frames = new Map();
  const camera = { locks: 0, releases: 0, moves: 0 };
  const cameraView = { zoom: 16, pitch: 40, bearing: 27, center: [121, 25] }, cameraTargets = [];
  const renderedLines = new Map();
  const layers = new Map(["poi_shop", "poi_shop_name", "txt_road_name", "other_symbol"].map(id => [id, true])), renderedLayers = new Map();
  let instance;
  let requestList;
  let requestMap;
  const requestQueries = [], requestMarkers = [], requestLines = new Map();
  let nextTimer = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", checked: true, disabled: false, hidden: true, textContent: "", handlers: {}, listeners: {}, attributes: {},
      classList: { add() {}, remove() {} },
      contains(target) { return target === this; },
      querySelector(selector) { return node(selector); },
      insertAdjacentHTML(_position, html) { this.innerHTML += html; },
      setAttribute(name, value) { this.attributes[name] = value; },
      get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); },
      checkValidity() { return Number.isFinite(this.valueAsNumber) && this.valueAsNumber >= Number(this.min) && this.valueAsNumber <= Number(this.max); },
      addEventListener(event, fn) {
        (this.listeners[event] ??= new Set()).add(fn);
        this.handlers[event] = (...args) => {
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
    setRotation(rotation) { assert.equal(this.playing, false, "播放時不能由手動旋轉干涉 SDK"); this.rotations.push({ ...rotation }); },
    scales: [],
    effectiveScale: 10, renderedScale: 10,
    setScale(scale) { this.scales.push(scale); this.effectiveScale = 10 * scale; },
    followPath(options) {
      const onEnd = options.onEnd;
      const playback = { ...options, onEnd: () => { if (this.playback === playback) this.playing = false; onEnd(); } };
      this.playback = playback;
      this.playbacks.push(playback);
      this.playing = true;
      options.onStart();
      return Promise.resolve();
    },
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
    jumpTo(options) { camera.moves++; cameraTargets.push(options); Object.assign(cameraView, options); }
    redraw() {
      model.renderedScale = model.effectiveScale;
      for (const [id, visible] of layers) renderedLayers.set(id, visible);
      renderedLines.clear();
      for (const [id, line] of lines) renderedLines.set(id, line);
    }
    decodePolyline(encoded) { return JSON.parse(encoded); }
  }
  const context = vm.createContext({
    document: { getElementById: node, createElement: () => ({ style: {}, classList: { toggle(name, selected) { this[name] = selected; } } }) }, window: Object.assign(node("window"), { location: { origin: "http://localhost" } }),
    fetch: async () => ({ ok: true, headers: { get: () => "model/gltf+json" }, json: async () => ({ asset: { version: "2.0" } }) }),
    AbortSignal, loadSdk: async () => SDK, accessKey: "測試", accessToken: "測試",
    mountRequestList: (container) => (requestList = mountRequestList(container)),
    mountPoiToggle, createModelSettings, normalizeDirections, validateEndpoints, parseCoordinate, validCoordinate, geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix,
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
      if (!manualRequests) callback([{ legs: [{ steps: [{ polyline: { points: JSON.stringify([query.origin, query.destination]) },
        start_location: { lng: query.origin[0], lat: query.origin[1] }, end_location: { lng: query.destination[0], lat: query.destination[1] } }] }] }], "OK");
    } };
    return requestMap = mountMap({ ...options, directions });
  };
  await vm.runInContext(`${source}\ninit()`, context);
  if (!manualRequests) await requestMap.loading;
  const result = (points, summary = "測試路線") => [{ summary, legs: [{ steps: [{
    polyline: { points: JSON.stringify(points) },
    start_location: { lng: points[0][0], lat: points[0][1] },
    end_location: { lng: points.at(-1)[0], lat: points.at(-1)[1] },
  }] }] }];
  return { ui, nodes, timers, queries, markers, lines, renderedLines, model, result, camera, cameraView, cameraTargets, frames, requestList, requestMap, requestQueries, requestMarkers, requestLines, map: instance, layers, renderedLayers,
    disposeDisplay: () => vm.runInContext("disposeMapDisplay()", context),
    click: (lng, lat, overrides = {}) => instance.click({ lngLat: { lng, lat }, originalEvent: { button: 0, target: node("map"), ...overrides } }),
    frame: () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); },
    disposeVehicle: () => vm.runInContext("disposeTransport(); disposePlayback();", context),
    add: () => ui("add-request").handlers.click() };
}

test("POI 切換立即呈現且與車輛獨立，樣式重載保留選擇，失敗與釋放不誤更新", async () => {
  const h = await setup(), button = h.ui("poi-toggle");
  const toggle = () => button.handlers.click();
  assert.equal(button.attributes["aria-pressed"], "false");
  const before = { position: [...h.model.coordinates], camera: { ...h.camera }, markers: [...h.requestMarkers], lines: [...h.requestLines] };
  toggle();
  assert.equal(button.textContent, "顯示地點圖標");
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

test("定位使用點擊當下車位，只改中心；跟隨與待鎖定時拒絕定位，解除後恢復", async () => {
  const h = await setup();
  const locate = () => h.ui("locate").handlers.click({ preventDefault() {} });
  h.model.coordinates = [121.57, 25.04, 0];
  locate();
  assert.deepEqual(Array.from(h.cameraView.center), [121.57, 25.04]);
  assert.equal(h.cameraView.zoom, 16); assert.equal(h.cameraView.pitch, 40); assert.equal(h.cameraView.bearing, 27);
  assert.equal(h.camera.locks, 0);
  assert.deepEqual(h.model.coordinates, [121.57, 25.04, 0]);
  h.model.coordinates = [NaN, 25, 0];
  locate();
  assert.equal(h.camera.moves, 1);
  assert.match(h.ui("error").textContent, /有效座標/);
  h.model.coordinates = [121.561, 25.0334, 0];
  h.ui("follow").handlers.click();
  assert.equal(h.ui("locate").disabled, true);
  locate(); assert.equal(h.camera.moves, 1);
  h.frame();
  const moves = h.camera.moves;
  locate(); assert.equal(h.camera.moves, moves);
  assert.equal(h.camera.releases, 0);
  const map = h.nodes.get("map");
  map.handlers.pointerdown({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 0, clientY: 0 });
  map.handlers.pointermove({ pointerId: 1, buttons: 1, clientX: 10, clientY: 0 });
  assert.equal(h.ui("locate").disabled, false);
  selectRequest(h, "request-01"); h.ui("transport").handlers.click();
  const playback = h.model.playback;
  h.model.coordinates = [121.563, 25.034, 0];
  locate();
  assert.deepEqual(Array.from(h.cameraView.center), [121.563, 25.034]);
  assert.equal(h.model.playback, playback); assert.equal(h.model.playing, true);
  assert.equal(h.camera.locks, 1);
});

test("地圖左鍵拖曳解除跟隨，取消待鎖定回呼且不中斷播放", async () => {
  const h = await setup();
  const map = h.nodes.get("map"), window = h.nodes.get("window");
  const pointer = (type, overrides = {}) => map.handlers[type]({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...overrides });
  h.ui("follow").handlers.click();
  const staleLock = [...h.frames.values()][0];
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
  staleLock(); h.frame();
  assert.equal(h.camera.locks, 0, "取消待鎖定且過期回呼不能重新鎖定");
  assert.equal(h.ui("follow").disabled, false);

  for (const id of ["request-01", "request-02"]) {
    const request = h.requestList.requests.find(item => item.id === id);
    h.model.coordinates = [...request.origin, 0];
    selectRequest(h, id);
    h.ui("follow").handlers.click(); h.frame();
    h.ui("transport").handlers.click();
    const playback = h.model.playback;
    const stale = [...h.frames.values()];
    pointer("pointerdown"); pointer("pointermove", { clientX: 110 });
    for (const fn of stale) fn(); h.frame();
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

test("選點解除已鎖定及待鎖定跟隨，查詢或播放取消模式並禁止選點", async () => {
  const h = await setup();
  const pressed = () => h.ui("select-origin").attributes["aria-pressed"];
  for (const locked of [false, true]) {
    h.ui("follow").handlers.click();
    const stale = [...h.frames.values()][0];
    if (locked) h.frame();
    const locks = h.camera.locks, releases = h.camera.releases;
    h.ui("select-origin").handlers.click(); stale(); h.frame();
    assert.equal(pressed(), "true");
    assert.equal(h.camera.locks, locks);
    assert.equal(h.camera.releases, releases + Number(locked));
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
  for (const value of ["", "0", "301", "NaN"]) {
    h.ui("duration").value = value;
    h.ui("transport").handlers.click();
    assert.equal(h.model.playback, null);
  }
  h.ui("duration").value = "12";
  h.ui("transport").handlers.click();
  assert.equal(h.model.playback.duration, 12000);
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
  assert.match(list.innerHTML, /value="request-01" checked/);
  assert.equal((list.innerHTML.match(/type="radio"[^>]* checked/g) ?? []).length, 1);
  select("request-03"); h.requestList.render();
  assert.equal(h.requestList.selectedRequestId, "request-03");
  assert.match(list.innerHTML, /value="request-03" checked/);
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
  h.requestList.setRouteVisible(second.id, false);
  assert.equal(h.requestLines.size, 0);
  h.requestList.setRouteVisible(second.id, true);
  assert.equal(h.requestLines.size, 1);
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
  // onEnd 不代表座標一定正確；終點未到達時不得標完成或自動換下一筆。
  dropoff.onEnd(); h.frame();
  assert.equal(h.requestList.requests[1].status, "onboard");
  assert.match(h.ui("error").textContent, /未到達預期終點/);
  assert.equal(h.model.playbacks.length, 2);
  assert.equal(h.queries.length, 2);
});

test("自動接送每次只執行一筆，完成後從新位置重新排序且排除不可用需求", async () => {
  const h = await setup();
  const [first, second, third] = h.requestList.requests;
  // 第一筆送人道路終點接近第三筆，不能沿用初始車位挑第二筆。
  h.requestList.setRouteState(first.id, { status: "ready", coordinates: [first.origin, third.origin] });
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
  h.requestList.setRouteState(second.id, { status: "ready", coordinates: [second.origin, second.destination] });
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
  h.requestList.setRouteState(first.id, { status: "ready", coordinates: [first.origin, third.destination] });
  h.requestList.setRouteState(third.id, { status: "loading" });
  h.model.coordinates = [121.542, 25.041, 0];
  h.ui("auto-transport").handlers.click();
  assert.equal(h.requestList.selectedRequestId, first.id);
  assert.equal(h.queries.length, 1);
  h.disposeVehicle(); await flushTask();
});
const endSegment = (h, playback = h.model.playback) => {
  h.model.coordinates = [...playback.path.at(-1)];
  playback.onEnd();
  h.frame();
};

test("新增驗證、座標副本與連點只建立一筆，保留選取、狀態與車位", async () => {
  const h = await setup();
  const [first, second] = h.requestList.requests;
  h.requestList.selectById(second.id);
  h.requestList.setRouteVisible(first.id, false);
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
  assert.equal(added.routeVisible, true);
  assert.equal(added.status, "pending");
  assert.equal(h.ui("origin").value, "");
  assert.equal(h.ui("destination").value, "");
  assert.equal(h.requestList.selectedRequestId, second.id);
  assert.equal(second.status, "completed");
  assert.equal(first.routeVisible, false);
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

test("初始化查詢中新增仍依序查一次，隱藏狀態及失敗保留，釋放後不再新增圖層", async () => {
  const h = await setup({ manualRequests: true });
  const fourth = h.requestList.addRequest([121.562, 25.034], [121.563, 25.035]);
  h.requestList.setRouteVisible(fourth.id, false);
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
  assert.equal(h.requestLines.has(id), false, "查詢完成仍依目前 checkbox 隱藏");
  h.requestList.selectById(fourth.id);
  h.requestList.setStatus(fourth.id, "assigned");
  assert.equal(h.requestLines.has(id), false, "選取及狀態不重開隱藏線");
  const cached = h.requestList.getRouteState(fourth.id);
  h.requestList.setRouteVisible(fourth.id, true);
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

test("接送中新增不換任務，每筆路線 checkbox 不改選取、快取或任務線", async () => {
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
  h.ui("request-list").handlers.change({ target: { type: "checkbox", name: "proj01-request-line", value: "request-01", checked: false } });
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal(h.requestLines.has(id), false);
  assert.equal(h.requestLines.size, 2);
  h.ui("origin").value = "121.561, 25.0334";
  h.ui("destination").value = "121.565, 25.035";
  h.add(); await flushTask();
  assert.equal(h.requestList.requests.length, 4);
  assert.equal(h.model.playback, playback);
  assert.deepEqual(h.model.coordinates, current);
  assert.deepEqual(h.camera, camera);
  assert.equal(h.requestList.requests[0].routeVisible, false);
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  assert.equal([...h.lines.values()][0], line);
  h.requestList.setRouteVisible("request-01", true);
  assert.equal(h.requestLines.has(id), true);
  assert.equal(h.requestList.getRouteState("request-01"), cached);
  assert.equal(h.requestQueries.length, 4, "checkbox 與狀態更新不重查");
  endSegment(h, playback);
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
  h.ui("duration").value = "12";
  const html = h.ui("request-list").innerHTML;
  h.ui("transport").handlers.click();
  const playback = h.model.playback;
  await flushTask(); // followPath 的 Promise 已完成，仍不能假裝到站。
  assert.equal(h.queries.length, 0);
  assert.equal(playback.duration, 12000);
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.ui("vehicle-status").textContent, "送人中");
  h.ui("transport").handlers.click();
  selectRequest(h, "request-02");
  h.ui("select-origin").handlers.click();
  assert.equal(h.model.playbacks.length, 1);
  assert.equal(h.queries.length, 0);
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.ui("select-origin").attributes["aria-pressed"], "false");
  for (const control of ["scale", "apply-scale", "duration"]) assert.equal(h.ui(control).disabled, true);
  endSegment(h, playback);
  playback.onEnd(); playback.onStart(); h.frame();
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
  assert.equal(h.requestLines.size, 3);
});

test("接人與送人依 onEnd 順序播放，分配總時間且保留需求路線", async () => {
  const h = await setup();
  const current = [121.53, 25.035, 0];
  h.model.coordinates = [...current];
  selectRequest(h, "request-02");
  h.ui("duration").value = "10";
  h.ui("follow").handlers.click(); h.frame();
  const cached = h.requestList.getRouteState("request-02");
  h.ui("transport").handlers.click();
  const request = h.queries[0];
  assert.deepEqual(JSON.parse(JSON.stringify(request.options.origin)), current.slice(0, 2));
  assert.deepEqual([...request.options.destination], h.requestList.requests[1].origin);
  assert.equal(h.requestList.requests[1].status, "assigned");
  assert.equal(h.ui("vehicle-status").textContent, "準備接送");
  assert.equal(h.model.playbacks.length, 0);
  for (const name of ["select-origin", "select-destination", "scale", "duration"]) {
    assert.equal(h.ui(name).disabled, true, "準備查詢期間也須停用會干擾任務的控制項");
  }
  selectRequest(h, "request-03"); h.ui("transport").handlers.click();
  const pickupPoints = [current.slice(0, 2), [121.538, 25.04], h.requestList.requests[1].origin];
  // 模擬 SDK 調整查詢陣列順序；本次任務的 C、A 驗證基準仍須保持。
  request.options.origin.reverse(); request.options.destination.reverse();
  request.callback(h.result(pickupPoints), "OK"); await flushTask();
  const pickup = h.model.playback;
  assert.equal(h.requestList.requests[1].status, "pickingUp");
  assert.equal(h.ui("vehicle-status").textContent, "前往接人");
  assert.deepEqual(JSON.parse(JSON.stringify(pickup.path)), pickupPoints.map(point => [...point, 0]));
  assert.ok(pickup.duration > 5000 && pickup.duration < 10000);
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
  assert.ok(Math.abs(pickup.duration + dropoff.duration - 10000) < 1e-6);
  const pickupLength = pickupPoints.slice(1).reduce((sum, point, index) => sum + distanceMeters(pickupPoints[index], point), 0);
  const dropoffLength = distanceMeters(cached.coordinates[0], cached.coordinates[1]);
  assert.ok(Math.abs(pickup.duration / dropoff.duration - pickupLength / dropoffLength) < 1e-6);
  assert.deepEqual(JSON.parse(JSON.stringify(dropoff.path)), cached.coordinates.map(point => [...point, 0]));
  pickup.onEnd(); pickup.onStart(); h.frame();
  assert.equal(h.model.playbacks.length, 2);
  assert.equal(h.model.playing, true);
  assert.equal(h.requestList.requests[2].status, "pending");
  endSegment(h, dropoff); dropoff.onEnd(); h.frame();
  assert.equal(h.requestList.requests[1].status, "completed");
  assert.equal(h.requestList.selectedRequestId, "request-03");
  assert.equal(h.ui("vehicle-status").textContent, "閒置");
  assert.equal(h.requestList.getRouteState("request-02"), cached);
  assert.equal(h.requestQueries.length, 3, "送人沿用快取");
  assert.equal(h.requestLines.size, 3);
  assert.equal(h.lines.size, 0, "完成僅清除任務線");
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

test("動畫拒絕不能假裝完成或停止，上車狀態保留且等待有效 onEnd 才解鎖", async () => {
  const h = await setup();
  const followPath = h.model.followPath.bind(h.model);
  h.model.followPath = (options) => { followPath(options); return Promise.reject(new Error("模擬動畫錯誤")); };
  selectRequest(h, "request-01"); h.ui("transport").handlers.click();
  const interrupted = h.model.playback;
  await flushTask();
  assert.equal(h.requestList.requests[0].status, "onboard");
  assert.equal(h.model.playing, true);
  assert.match(h.ui("error").textContent, /未確認可用的公開停止介面/);
  assert.match(h.ui("vehicle-status").textContent, /等待動畫結束/);
  selectRequest(h, "request-02"); h.ui("transport").handlers.click(); h.ui("auto-transport").handlers.click();
  assert.equal(h.ui("transport").disabled, true);
  assert.equal(h.queries.length, 0);
  assert.equal(h.model.playbacks.length, 1);
  interrupted.onEnd(); h.frame();
  assert.equal(h.requestList.requests[0].status, "onboard", "收到結束也不能把中斷任務標成完成");
  assert.equal(h.ui("transport").disabled, false);
  assert.equal(h.lines.size, 0);
  h.model.followPath = followPath;
  h.ui("transport").handlers.click();
  assert.equal(h.queries.length, 1);
  interrupted.onEnd(); interrupted.onStart(); h.frame();
  assert.equal(h.requestList.requests[1].status, "assigned");
  h.disposeVehicle(); await flushTask();
});
