import test from "node:test";
import assert from "node:assert/strict";
import { mountCompass } from "../src/proj01/proj01-compass.js";

function setup() {
  const listeners = new Map(), buttonListeners = new Map(), errors = [], actions = [];
  const view = { bearing: 27, center: { lng: 121.56, lat: 25.03 }, zoom: 18, pitch: 65 };
  const button = { disabled: false,
    addEventListener(name, fn) { if (!buttonListeners.has(name)) buttonListeners.set(name, new Set()); buttonListeners.get(name).add(fn); },
    removeEventListener(name, fn) { buttonListeners.get(name)?.delete(fn); },
  };
  const needle = { style: {} };
  const map = { ready: false,
    getMapView() { return { ...view }; },
    isStyleLoaded() { return this.ready; },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    jumpTo(options) { actions.push(options); Object.assign(view, options); emit("rotate"); },
    redraw() { actions.push("redraw"); },
  };
  const emit = (name, event = {}) => { for (const fn of [...listeners.get(name) ?? []]) fn(event); };
  const click = () => { for (const fn of [...buttonListeners.get("click") ?? []]) fn({ stopPropagation() {} }); };
  const mount = () => mountCompass({ map, button, needle, beforeReset: () => actions.push("release"), reportError: error => errors.push(error) });
  return { map, button, needle, view, errors, actions, emit, click, mount, listeners, buttonListeners };
}

test("指南針等待地圖就緒，依實際旋轉事件處理負角及整圈邊界，樣式重載重新同步", () => {
  const h = setup(); const dispose = h.mount();
  assert.equal(h.button.disabled, true); h.click(); assert.equal(h.actions.length, 0);
  h.map.ready = true; h.emit("style.load");
  assert.equal(h.button.disabled, false); assert.equal(h.needle.style.transform, "rotate(-27deg)");
  for (const [bearing, expected] of [[-90, 90], [359, 1], [360, 0], [361, -1], [-361, 1], [180, 180], [-180, 180]]) {
    h.view.bearing = bearing; h.emit("rotate");
    assert.equal(h.needle.style.transform, `rotate(${expected}deg)`);
  }
  h.emit("dataloading", { dataType: "source" }); assert.equal(h.button.disabled, false);
  h.emit("dataloading", { dataType: "style" }); assert.equal(h.button.disabled, true);
  h.view.bearing = 48; h.emit("style.load");
  assert.equal(h.needle.style.transform, "rotate(-48deg)");
  assert.equal(h.actions.length, 0); assert.equal(h.errors.length, 0);
  dispose();
});

test("回正北先解除跟隨、同步更新且保留其他視角，工具事件不傳給地圖", () => {
  const h = setup(); h.map.ready = true; const dispose = h.mount();
  const before = { ...h.view }; h.click();
  assert.deepEqual(h.actions, ["release", { bearing: 0 }, "redraw"]);
  assert.deepEqual(h.view, { ...before, bearing: 0 });
  assert.equal(h.needle.style.transform, "rotate(0deg)");
  for (const event of ["pointerdown", "pointerup", "dblclick", "contextmenu", "wheel"]) {
    let stopped = 0;
    for (const fn of h.buttonListeners.get(event)) fn({ stopPropagation() { stopped++; } });
    assert.equal(stopped, 1);
  }
  dispose();
});

test("清理後過期回呼不能更新方向，重新掛載不重複回正北", () => {
  const h = setup(); h.map.ready = true; const dispose = h.mount();
  const stale = [...h.listeners.values()].flatMap(set => [...set]);
  dispose(); dispose();
  for (const set of [...h.listeners.values(), ...h.buttonListeners.values()]) assert.equal(set.size, 0);
  h.view.bearing = 75; stale.forEach(fn => fn({ dataType: "style" })); h.click();
  assert.equal(h.needle.style.transform, "rotate(-27deg)"); assert.equal(h.button.disabled, true);
  const disposeAgain = h.mount();
  assert.equal(h.needle.style.transform, "rotate(-75deg)");
  h.click(); assert.deepEqual(h.actions, ["release", { bearing: 0 }, "redraw"]);
  disposeAgain();
});
