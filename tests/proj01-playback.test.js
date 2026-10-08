import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationClock } from '../src/proj01/proj01-clock.js';
import { createPlayback } from '../src/proj01/proj01-playback.js';
import { createFollowCamera } from '../src/proj01/proj01-camera.js';
import { distanceMeters } from '../src/proj01/proj01-transport.js';

const path = [[121, 25], [121.001, 25], [121.002, 25]];
function setup() {
  let time = 0, speed = 1, next = 0;
  const frames = new Map(), listeners = new Set(), events = [], camera = [];
  const visibility = { hidden: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const model = { coordinates: [...path[0], 0], rotation: null,
    setCoordinates(position) { this.coordinates = position; events.push('position'); },
    setRotation(rotation) { this.rotation = rotation; events.push('rotation'); } };
  const clock = createSimulationClock({ getSpeedMultiplier: () => speed, now: () => time, visibility,
    requestFrame: fn => { frames.set(++next, fn); return next; }, cancelFrame: id => frames.delete(id) });
  const playback = createPlayback({ clock, model, updateCamera: (position, bearing) => { camera.push({ position, bearing }); events.push('camera'); }, redraw: () => events.push('redraw') });
  const h = { model, playback, frames, listeners, events, camera,
    speed(value) { speed = value; },
    frame(ms) { time += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time)); },
    visibility(hidden, elapsed = 0) { time += elapsed; visibility.hidden = hidden; [...listeners].forEach(fn => fn()); },
    now: () => time };
  return h;
}
const close = (a, b) => assert.ok(distanceMeters(a, b) < .001, `${a} 與 ${b} 不連續`);

test('當下倍率積分；加減速不改已走進度，完成先確認終點且只通知一次', () => {
  const h = setup(), notifications = [];
  const run = h.playback.play({ path, durationSeconds: 10, onStart: () => notifications.push('start'),
    onEnd: details => { close(h.model.coordinates, path.at(-1)); notifications.push(details); } });
  h.frame(2000); assert.equal(run.elapsedSeconds, 2);
  close(h.model.coordinates, [121.0004, 25]);
  const before = [...h.model.coordinates]; h.speed(3); close(h.model.coordinates, before);
  h.frame(1000); assert.equal(run.elapsedSeconds, 5); close(h.model.coordinates, path[1]);
  h.speed(1); h.frame(1000); assert.equal(run.elapsedSeconds, 6);
  const stale = [...h.frames.values()]; h.speed(4); h.frame(1500);
  assert.equal(run.elapsedSeconds, 10); assert.deepEqual(notifications, ['start', { remainingSeconds: 2 }]);
  stale.forEach(fn => fn(h.now() + 99999)); h.frame(1000);
  assert.equal(notifications.length, 2); assert.equal(h.frames.size, 0); assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.events.slice(-4), ['position', 'rotation', 'camera', 'redraw']);
});

test('座標密度及重複點不改配速，跨越多個點仍在道路折線且朝向不累加', () => {
  const a = setup(), b = setup();
  a.playback.play({ path, durationSeconds: 10 });
  b.playback.play({ path: [path[0], path[0], [121.00001, 25], [121.00003, 25], path[1], path[2]], durationSeconds: 10 });
  a.frame(7250); b.frame(7250); close(a.model.coordinates, b.model.coordinates);
  const turn = [[121,25], [121.00001,25], [121.001,25], [121.001,25.001]];
  const h = setup(); h.playback.play({ path: turn, durationSeconds: 10 }); h.frame(8000);
  assert.equal(h.model.coordinates[0], 121.001); assert.ok(h.model.coordinates[1] > 25);
  assert.equal(h.camera.at(-1).bearing, 0); const yaw = h.model.rotation.z;
  h.speed(2); h.frame(200); assert.equal(h.model.rotation.z, yaw);
});

test('同一幀路段餘量交接，不漏算、不重複；兩段各開始完成一次', () => {
  const h = setup(), calls = []; let second;
  h.playback.play({ path, durationSeconds: 2, onStart: () => calls.push('pickup-start'), onEnd: ({ remainingSeconds }) => {
    calls.push('pickup-end');
    second = h.playback.play({ path: [path.at(-1), [121.003,25]], durationSeconds: 3, initialSeconds: remainingSeconds,
      onStart: () => calls.push('dropoff-start'), onEnd: () => calls.push('completed') });
  } });
  h.frame(4000); assert.equal(second.elapsedSeconds, 2); assert.equal(h.frames.size, 1);
  h.frame(1000); assert.equal(second.elapsedSeconds, 3);
  assert.deepEqual(calls, ['pickup-start','pickup-end','dropoff-start','completed']);
});

test('取消、取代及清理使舊更新失效，取消不能當完成', () => {
  const h = setup(); let completed = 0;
  const old = h.playback.play({ path, durationSeconds: 2, onEnd: () => completed++ });
  const stale = [...h.frames.values()]; old.cancel();
  const next = h.playback.play({ path, durationSeconds: 10, onEnd: () => completed++ });
  stale.forEach(fn => fn(999999)); old.cancel(); assert.equal(next.elapsedSeconds, 0);
  h.frame(1000); assert.equal(next.elapsedSeconds, 1); assert.equal(completed, 0);
  const disposed = [...h.frames.values()]; h.playback.dispose(); disposed.forEach(fn => fn(999999));
  assert.equal(completed, 0); assert.equal(h.frames.size, 0); assert.equal(h.listeners.size, 0);
});

test('背景時間不補算，恢復以新基準前進且舊幀失效', () => {
  const h = setup(); let completed = 0;
  const run = h.playback.play({ path, durationSeconds: 10, onEnd: () => completed++ });
  h.frame(2000); const stale = [...h.frames.values()]; const before = [...h.model.coordinates];
  h.visibility(true); h.frame(600000); stale.forEach(fn => fn(h.now())); close(h.model.coordinates, before);
  h.visibility(false); h.frame(1000); assert.equal(run.elapsedSeconds, 3); assert.equal(completed, 0);
  h.playback.dispose(); assert.equal(h.listeners.size, 0);
});

test('位置、旋轉、鏡頭及倍率錯誤停止更新，不誤完成或干涉後續播放', () => {
  for (const fault of ['position', 'rotation', 'camera', 'speed']) {
    const h = setup(); let errors = 0, completed = 0;
    h.playback.play({ path, durationSeconds: 2, onEnd: () => completed++, onError: (_, details) => { errors++; assert.equal(details.stopped, true); } });
    const stale = [...h.frames.values()];
    if (fault === 'position') h.model.setCoordinates = () => {};
    if (fault === 'rotation') h.model.setRotation = () => { throw new Error('旋轉失敗'); };
    if (fault === 'camera') h.camera.push = () => { throw new Error('鏡頭失敗'); };
    if (fault === 'speed') h.speed(NaN);
    h.frame(3000); stale.forEach(fn => fn(999999));
    assert.equal(errors, 1, fault); assert.equal(completed, 0, fault); assert.equal(h.frames.size, 0); assert.equal(h.listeners.size, 0);
  }
});

test('跟隨同步使用新車位與方向，保留使用者縮放及俯角，解除後不再移動鏡頭', () => {
  const map = { center: null, zoom: 15, pitch: 20, jumpTo(options) { Object.assign(this, options); }, redraw() {} };
  const follow = createFollowCamera({ map, view: { zoom:18, pitch:65 } });
  follow.start([121,25,0], 90); map.zoom = 17; map.pitch = 60;
  follow.update([121.001,25,0], 0);
  assert.deepEqual(map.center, [121.001,25]); assert.equal(map.bearing, 0); assert.equal(map.zoom,17); assert.equal(map.pitch,60);
  follow.stop(); follow.update([122,26,0], 180); assert.deepEqual(map.center, [121.001,25]);
});

test('開始及完成通知出錯會回報；回呼已啟動的新播放不被舊錯誤取消', () => {
  const h = setup(); let errors = 0;
  h.playback.play({ path, durationSeconds: 1, onStart: () => { throw new Error('開始通知失敗'); }, onError: () => errors++ });
  assert.equal(errors, 1); assert.equal(h.frames.size, 0);
  h.playback.play({ path, durationSeconds: 1, onEnd: () => { throw new Error('完成通知失敗'); }, onError: () => errors++ });
  h.frame(1000); assert.equal(errors, 2); assert.equal(h.frames.size, 0);
  let next;
  h.playback.play({ path, durationSeconds: 1, onEnd: () => {
    next = h.playback.play({ path, durationSeconds: 10 }); throw new Error('舊通知已失效');
  }, onError: () => errors++ });
  h.frame(1000); h.frame(1000); assert.equal(next.elapsedSeconds, 1); assert.equal(errors, 2);
});
