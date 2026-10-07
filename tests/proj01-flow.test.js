import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { mountRequestList } from "../src/proj01/proj01-requests.js";
import { normalizeDirections, validateEndpoints, parseCoordinate } from "../src/proj01/proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "../src/proj01/proj01-heading.js";

// 隔離外部服務與渲染，只檢查查詢競態、控制狀態及有效路線的替換流程。
async function setup({ manualRequests = false } = {}) {
  const nodes = new Map(), timers = new Map(), queries = [], markers = [], lines = new Map(), frames = new Map();
  const camera = { locks: 0, releases: 0, moves: 0 };
  const renderedLines = new Map();
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
    coordinates: [121.561, 25.0334, 0], playback: null, rotations: [], playing: false,
    quaternion: { setFromAxisAngle() { return this; } },
    setCoordinates(point) { this.coordinates = [...point]; },
    setRotation(rotation) { assert.equal(this.playing, false, "播放時不能由手動旋轉干涉 SDK"); this.rotations.push({ ...rotation }); },
    scales: [],
    setScale(scale) { this.scales.push(scale); },
    followPath(options) {
      const onEnd = options.onEnd;
      this.playback = { ...options, onEnd: () => { this.playing = false; onEnd(); } };
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
      this.three = {
        add3dModel: (options) => { model.creationOptions = options; return Promise.resolve(model); },
        add3dLine: (options) => (options.id.startsWith("proj01-request-route-") ? requestLines : lines).set(options.id, options),
        remove3dObjectById: (id) => (id.startsWith("proj01-request-route-") ? requestLines : lines).delete(id),
        fixedCameraToModel() { camera.locks++; }, releaseCamera() { camera.releases++; },
      };
    }
    on(event, callback) { if (event === "style.load") callback(); else this.click = callback; }
    off(event, callback) { if (event === "click" && this.click === callback) this.click = null; }
    offLayer() {} jumpTo() { camera.moves++; }
    redraw() {
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
    normalizeDirections, validateEndpoints, parseCoordinate, geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (fn) => { const id = ++nextTimer; frames.set(id, fn); return id; }, cancelAnimationFrame: (id) => frames.delete(id),
  });
  const source = fs.readFileSync(new URL("../src/proj01/proj01.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export async function init", "async function init");
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
  return { ui, nodes, timers, queries, markers, lines, renderedLines, model, result, camera, frames, requestList, requestMap, requestQueries, requestMarkers, requestLines,
    click: (lng, lat, overrides = {}) => instance.click({ lngLat: { lng, lat }, originalEvent: { button: 0, target: node("map"), ...overrides } }),
    frame: () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); },
    plan: () => ui("plan").handlers.click() };
}

test("逾時及過期回應不覆蓋新路線，失敗保留有效路線，播放阻止新查詢", async () => {
  const h = await setup();
  const points = [[121.561, 25.0334], [121.562, 25.034]];
  assert.equal(h.ui("start").disabled, true);
  const oldQuery = h.plan();
  assert.equal(h.ui("plan").disabled, true);
  await h.plan();
  assert.equal(h.queries.length, 1);
  const timeout = [...h.timers.values()].find(({ delay }) => delay === 20000);
  timeout.fn();
  await oldQuery;
  assert.equal(h.timers.size, 0);
  assert.equal(h.ui("plan").disabled, false);
  assert.equal(h.ui("start").disabled, true);
  assert.match(h.ui("error").textContent, /逾時/);

  const newQuery = h.plan();
  h.queries[1].callback(h.result(points, "新路線"), "OK");
  await newQuery;
  const success = h.ui("status").textContent;
  h.queries[0].callback(h.result(points, "過期路線"), "OK");
  await Promise.resolve();
  assert.equal(h.ui("status").textContent, success);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ui("start").disabled, false);
  assert.equal(h.model.playback, null);
  assert.equal(h.lines.size, 1);
  assert.equal(h.markers.filter((marker) => !marker.removed).length, 2);

  const noRoute = h.plan();
  assert.equal(h.ui("vehicle-controls").disabled, false);
  assert.equal(h.ui("path").disabled, false);
  h.ui("path").checked = false;
  h.ui("path").handlers.change();
  assert.equal(h.lines.size, 0);
  assert.equal(h.renderedLines.size, 0, "關閉路線後畫面立即清除");
  h.ui("path").checked = true;
  h.ui("path").handlers.change();
  assert.equal(h.lines.size, 1);
  assert.deepEqual([...h.renderedLines], [...h.lines], "新增路線完成後才重繪，不需要鏡頭操作");
  h.queries[2].callback([], "OK");
  await noRoute;
  assert.match(h.ui("error").textContent, /可用路線/);
  assert.equal(h.lines.size, 1);
  assert.equal(h.ui("start").disabled, false);

  const replacement = h.plan();
  h.queries[3].callback(h.result(points.toReversed()), "OK");
  await replacement;
  assert.equal(h.lines.size, 1);
  assert.equal(h.markers.filter((marker) => !marker.removed).length, 2);
  assert.equal(h.markers[0].removed, true);
  h.ui("start").handlers.click();
  assert.equal(h.ui("vehicle-controls").disabled, false);
  assert.equal(h.ui("duration").disabled, true);
  for (const name of ["scale", "apply-scale", "origin", "destination"]) {
    assert.equal(h.ui(name).disabled, true, "合併後仍分別停用播放期間不能修改的控制項");
  }
  assert.equal(h.ui("start").disabled, true);
  assert.equal(h.ui("follow").disabled, false);
  assert.equal(h.ui("plan").disabled, true);
  assert.equal(h.ui("vehicle-controls").disabled, false);
  assert.equal(h.ui("path").disabled, false);
  h.ui("path").checked = false;
  h.ui("path").handlers.change();
  assert.equal(h.lines.size, 0);
  h.ui("path").checked = true;
  h.ui("path").handlers.change();
  assert.equal(h.lines.size, 1);
  await h.plan();
  assert.equal(h.queries.length, 4);
  assert.equal(h.model.playback.curveOptions.tension, 0);
  assert.equal(h.model.playback.trackHeading, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.model.playback.path)), points.toReversed().map((point) => [...point, 0]));
  h.model.coordinates = [...points[0], 0];
  h.model.playback.onEnd();
  assert.equal(h.ui("duration").disabled, false);
  assert.equal(h.ui("scale").disabled, false);
  assert.equal(h.ui("start").disabled, false);
  assert.equal(h.ui("plan").disabled, false);
});

test("道路吸附起點、第一段方向與重播一致，失敗不改變位置及朝向", async () => {
  const h = await setup();
  assert.equal(h.nodes.has("proj01-heading"), false);
  assert.equal(h.nodes.has("proj01-rotation"), false);
  assert.equal(h.nodes.has("proj01-height"), false);
  assert.equal(h.model.creationOptions.coordinates[2], 0);
  const points = [[121.56, 25.03], [121.56, 25.03], [121.56, 25.031], [121.559, 25.031]];
  const request = h.plan();
  h.queries[0].callback(h.result(points), "OK");
  await request;
  assert.deepEqual(h.model.coordinates, [...points[0], 0]);
  assert.ok([...h.lines.values()].every((line) => line.coordinates.every((point) => point[2] === 0)));
  assert.ok(h.markers.every((marker) => marker.options.altitude === 0));
  h.ui("path").checked = false; h.ui("path").handlers.change();
  h.ui("path").checked = true; h.ui("path").handlers.change();
  assert.ok([...h.lines.values()].every((line) => line.coordinates.every((point) => point[2] === 0)));
  assert.notDeepEqual(h.model.coordinates.slice(0, 2), h.queries[0].options.origin);
  assert.equal(h.model.rotations.at(-1).z, 180);
  assert.equal(h.model.playback, null);

  const position = [...h.model.coordinates], rotationCount = h.model.rotations.length;
  for (const [candidates, status] of [[[], "OK"], [h.result(points), "ERROR"], [[{ legs: [] }], "OK"]]) {
    const pending = h.plan();
    h.queries.at(-1).callback(candidates, status);
    await pending;
    assert.deepEqual(h.model.coordinates, position);
    assert.equal(h.model.rotations.length, rotationCount);
  }
  for (let replay = 0; replay < 2; replay++) {
    h.ui("start").handlers.click();
    assert.deepEqual(h.model.coordinates, [...points[0], 0]);
    assert.equal(h.model.rotations.at(-1).z, 180);
    assert.equal(h.model.playback.trackHeading, true);
    assert.ok(h.model.playback.path.every((point) => point[2] === 0));
    const rotations = h.model.rotations.length;
    // SDK 負責播放途中的方向；測試只模擬到達終點，不呼叫手動 setRotation。
    h.model.coordinates = [...points.at(-1), 0];
    h.model.playback.onEnd();
    assert.equal(h.model.rotations.length, rotations);
  }
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

  const points = [[121.561, 25.0334], [121.562, 25.034]];
  const planning = h.plan(); h.queries[0].callback(h.result(points), "OK"); await planning;
  for (let replay = 0; replay < 2; replay++) {
    h.ui("follow").handlers.click(); h.frame();
    assert.equal(h.ui("follow").disabled, true);
    h.ui("start").handlers.click();
    const playback = h.model.playback, locks = h.camera.locks;
    if (replay === 1) h.frame(); // 分別驗證等待重鎖及已重鎖的播放。
    const releases = h.camera.releases;
    pointer("pointerdown"); pointer("pointermove", { clientX: 110 });
    h.frame();
    assert.equal(h.ui("follow").disabled, false);
    assert.equal(h.camera.locks, locks + (replay === 1 ? 1 : 0));
    assert.equal(h.camera.releases, releases + (replay === 1 ? 1 : 0));
    assert.equal(h.model.playing, true);
    assert.equal(h.model.playback, playback, "原本的播放流程不能重啟");
    pointer("pointerdown"); pointer("pointermove", { clientX: 120 });
    assert.equal(h.model.playback, playback, "自由鏡頭拖曳不影響播放");
    playback.onEnd();
  }
});

test("地圖選點切換及取消，只接受有效左鍵點擊，不改變既有路線與模型", async () => {
  const h = await setup();
  const map = h.nodes.get("map");
  const pointer = (type, overrides = {}) => map.handlers[type]({ pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...overrides });
  const select = (endpoint) => h.ui(`select-${endpoint}`).handlers.click();
  const pressed = (endpoint) => h.ui(`select-${endpoint}`).attributes["aria-pressed"];
  const click = (lng, lat, overrides) => { pointer("pointerdown"); pointer("pointerup", { buttons: 0 }); h.click(lng, lat, overrides); };
  const points = [[121.561, 25.0334], [121.562, 25.034]];
  const query = h.plan(); h.queries[0].callback(h.result(points), "OK"); await query;
  const position = [...h.model.coordinates], rotations = h.model.rotations.length;
  const line = [...h.lines.values()][0], markers = [...h.markers];

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
  assert.equal(h.ui("origin").value, "121.561, 25.0334");

  select("origin");
  for (const overrides of [{ button: 1 }, { button: 2 }, { target: h.nodes.get("proj01-panel") }]) {
    click(122, 26, overrides);
    assert.equal(pressed("origin"), "true");
    assert.equal(h.ui("origin").value, "121.561, 25.0334");
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
  assert.equal(h.queries.length, 1, "選點不自動規劃");
  assert.equal(h.model.playback, null);
  assert.deepEqual(h.model.coordinates, position);
  assert.equal(h.model.rotations.length, rotations);
  assert.equal([...h.lines.values()][0], line);
  assert.deepEqual(h.markers, markers);
  assert.equal(h.markers.some((marker) => marker.removed), false);
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
  const query = h.plan();
  assert.equal(pressed(), "false");
  assert.equal(h.ui("select-origin").disabled, true);
  assert.equal(h.ui("select-destination").disabled, true);
  h.ui("select-origin").handlers.click();
  assert.equal(pressed(), "false");
  h.queries[0].callback(h.result([[121.561, 25.0334], [121.562, 25.034]]), "OK"); await query;
  assert.equal(h.ui("select-origin").disabled, false);
  h.ui("select-origin").handlers.click(); h.ui("start").handlers.click();
  assert.equal(pressed(), "false");
  assert.equal(h.ui("select-origin").disabled, true);
  h.ui("select-origin").handlers.click();
  assert.equal(pressed(), "false");
  assert.equal(h.model.playing, true);
  h.model.playback.onEnd();
  assert.equal(h.ui("select-origin").disabled, false);
});

test("合併座標輸入驗證後才送出查詢，比例只在套用時更新", async () => {
  const h = await setup();
  const position = [...h.model.coordinates], rotations = h.model.rotations.length;
  h.ui("scale").value = "20";
  assert.deepEqual(h.model.scales, []);
  h.ui("apply-scale").handlers.click();
  assert.deepEqual(h.model.scales, [2]);
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
    await h.plan();
    assert.equal(h.queries.length, 0);
    assert.match(h.ui("error").textContent, /起點.*座標/);
  }
  h.ui("origin").value = " 121.561 , 25.0334 ";
  h.ui("destination").value = "121.562,25.034";
  const query = h.plan();
  assert.deepEqual(h.queries[0].options.origin, [121.561, 25.0334]);
  assert.deepEqual(h.queries[0].options.destination, [121.562, 25.034]);
  h.queries[0].callback(h.result([[121.561, 25.0334], [121.562, 25.034]]), "OK");
  await query;
  for (const value of ["", "0", "301", "NaN"]) {
    h.ui("duration").value = value;
    h.ui("start").handlers.click();
    assert.equal(h.model.playback, null);
  }
  h.ui("duration").value = "12";
  h.ui("start").handlers.click();
  assert.equal(h.model.playback.duration, 12000);
});

test("需求選取與重繪保留唯一識別碼，不改變車輛、鏡頭或路線", async () => {
  const h = await setup();
  const list = h.ui("request-list");
  const select = (id, checked = true) => list.handlers.change({ target: { type: "radio", name: "proj01-request", value: id, checked } });
  assert.equal(h.requestList.selectedRequestId, null);
  const pending = h.plan();
  select("request-02");
  assert.equal(h.requestList.selectedRequestId, "request-02", "查詢時需求仍可操作");
  h.queries[0].callback(h.result([[121.561, 25.0334], [121.562, 25.034]]), "OK");
  await pending;
  h.ui("follow").handlers.click(); h.frame();
  h.ui("start").handlers.click(); h.frame();
  const before = { origin: h.ui("origin").value, destination: h.ui("destination").value,
    position: [...h.model.coordinates], rotations: [...h.model.rotations], playback: h.model.playback,
    lines: [...h.lines], markers: [...h.markers], camera: { ...h.camera }, frames: [...h.frames] };
  select("request-01"); select("request-01");
  select("request-01", false); select("invalid");
  assert.equal(h.requestList.selectedRequestId, "request-01");
  h.requestList.render();
  assert.match(list.innerHTML, /value="request-01" checked/);
  assert.equal((list.innerHTML.match(/ checked/g) ?? []).length, 1);
  select("request-03"); h.requestList.render();
  assert.equal(h.requestList.selectedRequestId, "request-03");
  assert.match(list.innerHTML, /value="request-03" checked/);
  assert.equal(h.queries.length, 1);
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
  const planning = h.plan();
  h.queries[0].callback(h.result([first.origin, first.destination]), "OK"); await planning;
  h.ui("path").checked = false; h.ui("path").handlers.change();
  h.ui("path").checked = true; h.ui("path").handlers.change();
  assert.equal(h.requestLines.size, 1, "車輛路線切換保留需求圖層");
  assert.equal(h.requestMarkers.filter(marker => !marker.removed).length, 6);
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
