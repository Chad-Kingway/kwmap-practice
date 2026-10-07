import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { normalizeDirections, validateEndpoints } from "../src/examples/proj01-route.js";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "../src/examples/proj01-heading.js";

// 隔離外部服務與渲染，只檢查查詢競態、控制狀態及有效路線的替換流程。
async function setup() {
  const nodes = new Map(), timers = new Map(), queries = [], markers = [], lines = new Map();
  let nextTimer = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", checked: true, disabled: false, hidden: true, textContent: "", handlers: {},
      get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); },
      checkValidity() { return Number.isFinite(this.valueAsNumber) && this.valueAsNumber >= Number(this.min) && this.valueAsNumber <= Number(this.max); },
      addEventListener(event, fn) { this.handlers[event] = fn; },
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
    setScale() {},
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
    static Marker = class { constructor(options) { this.options = options; this.removed = false; markers.push(this); } remove() { this.removed = true; } setAltitude() {} };
    constructor() {
      this.three = {
        add3dModel: (options) => { model.creationOptions = options; return Promise.resolve(model); },
        add3dLine: (options) => lines.set(options.id, options), remove3dObjectById: (id) => lines.delete(id),
        fixedCameraToModel() {}, releaseCamera() {},
      };
    }
    on(_, callback) { callback(); } offLayer() {} jumpTo() {}
    decodePolyline(encoded) { return JSON.parse(encoded); }
  }
  const context = vm.createContext({
    document: { getElementById: node, createElement: () => ({}) }, window: { location: { origin: "http://localhost" } },
    fetch: async () => ({ ok: true, headers: { get: () => "model/gltf+json" }, json: async () => ({ asset: { version: "2.0" } }) }),
    AbortSignal, loadSdk: async () => SDK, accessKey: "測試", accessToken: "測試",
    normalizeDirections, validateEndpoints, geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame: () => ++nextTimer, cancelAnimationFrame() {},
  });
  const source = fs.readFileSync(new URL("../src/examples/proj01.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export async function init", "async function init");
  await vm.runInContext(`${source}\ninit()`, context);
  const result = (points, summary = "測試路線") => [{ summary, legs: [{ steps: [{
    polyline: { points: JSON.stringify(points) },
    start_location: { lng: points[0][0], lat: points[0][1] },
    end_location: { lng: points.at(-1)[0], lat: points.at(-1)[1] },
  }] }] }];
  return { ui, nodes, timers, queries, markers, lines, model, result, plan: () => ui("plan").handlers.click() };
}

test("逾時及過期回應不覆蓋新路線，失敗保留有效路線，播放阻止新查詢", async () => {
  const h = await setup();
  const points = [[121.561, 25.0334], [121.562, 25.034]];
  assert.equal(h.ui("start").disabled, true);
  const oldQuery = h.plan();
  assert.equal(h.ui("route").disabled, true);
  await h.plan();
  assert.equal(h.queries.length, 1);
  const timeout = [...h.timers.values()].find(({ delay }) => delay === 20000);
  timeout.fn();
  await oldQuery;
  assert.equal(h.timers.size, 0);
  assert.equal(h.ui("route").disabled, false);
  assert.equal(h.ui("start").disabled, true);
  assert.match(h.ui("error").textContent, /逾時/);

  const newQuery = h.plan();
  h.queries[1].callback(h.result(points, "新路線"), "OK");
  await newQuery;
  const success = h.ui("route-status").textContent;
  h.queries[0].callback(h.result(points, "過期路線"), "OK");
  await Promise.resolve();
  assert.equal(h.ui("route-status").textContent, success);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ui("start").disabled, false);
  assert.equal(h.model.playback, null);
  assert.equal(h.lines.size, 1);
  assert.equal(h.markers.filter((marker) => !marker.removed).length, 2);

  const noRoute = h.plan();
  h.queries[2].callback([], "OK");
  await noRoute;
  assert.match(h.ui("route-status").textContent, /無可用路線.*保留/);
  assert.equal(h.lines.size, 1);
  assert.equal(h.ui("start").disabled, false);

  const replacement = h.plan();
  h.queries[3].callback(h.result(points.toReversed()), "OK");
  await replacement;
  assert.equal(h.lines.size, 1);
  assert.equal(h.markers.filter((marker) => !marker.removed).length, 2);
  assert.equal(h.markers[0].removed, true);
  h.ui("start").handlers.click();
  assert.equal(h.ui("route").disabled, true);
  await h.plan();
  assert.equal(h.queries.length, 4);
  assert.equal(h.model.playback.curveOptions.tension, 0);
  assert.equal(h.model.playback.trackHeading, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.model.playback.path)), points.toReversed().map((point) => [...point, 0]));
  h.model.coordinates = [...points[0], 0];
  h.model.playback.onEnd();
  assert.equal(h.ui("route").disabled, false);
});

test("道路吸附起點、第一段方向、還原與重播一致，失敗不改變位置及朝向", async () => {
  const h = await setup();
  assert.equal(h.nodes.has("proj01-heading"), false);
  assert.equal(h.nodes.has("proj01-rotation"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.model.creationOptions.rotation)), { x: 90, y: 0, z: 0 });
  h.ui("height").value = "12";
  const points = [[121.56, 25.03], [121.56, 25.03], [121.56, 25.031], [121.559, 25.031]];
  const request = h.plan();
  h.queries[0].callback(h.result(points), "OK");
  await request;
  assert.deepEqual(h.model.coordinates, [...points[0], 12]);
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
  h.ui("reset").handlers.click();
  assert.deepEqual(h.model.coordinates, [...points[0], 0]);
  assert.equal(h.model.rotations.at(-1).z, 180);
  for (let replay = 0; replay < 2; replay++) {
    h.ui("start").handlers.click();
    assert.deepEqual(h.model.coordinates, [...points[0], 0]);
    assert.equal(h.model.rotations.at(-1).z, 180);
    assert.equal(h.model.playback.trackHeading, true);
    const rotations = h.model.rotations.length;
    // SDK 負責播放途中的方向；測試只模擬到達終點，不呼叫手動 setRotation。
    h.model.coordinates = [...points.at(-1), 0];
    h.model.playback.onEnd();
    assert.equal(h.model.rotations.length, rotations);
  }
});
