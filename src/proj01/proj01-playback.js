import { validCoordinate } from "./proj01-route.js";
import { distanceMeters } from "./proj01-transport.js";
import { geographicBearing, modelRotationFromBearing } from "./proj01-heading.js";

function preparePath(source) {
  if (!Array.isArray(source) || source.length < 2 || !source.every(point => Array.isArray(point) && validCoordinate(point.slice(0, 2)))) throw new Error("動畫路線座標無效。");
  const points = [], cumulative = [0];
  for (const point of source) {
    const coordinate = [point[0], point[1], 0];
    if (points.length) {
      const length = distanceMeters(points.at(-1), coordinate);
      if (length === 0) continue;
      cumulative.push(cumulative.at(-1) + length);
    }
    points.push(coordinate);
  }
  const length = cumulative.at(-1);
  if (!(length > 0) || !Number.isFinite(length)) throw new Error("動畫路線須有有效且不同的位置。");
  return { points, cumulative, length };
}

function poseAt(route, progress) {
  const distance = route.length * progress;
  let lo = 0, hi = route.points.length - 1;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (route.cumulative[mid] <= distance) lo = mid; else hi = mid;
  }
  const index = Math.min(lo, route.points.length - 2);
  const a = route.points[index], b = route.points[index + 1];
  const fraction = (distance - route.cumulative[index]) / (route.cumulative[index + 1] - route.cumulative[index]);
  return { position: progress === 1 ? [...route.points.at(-1)] : [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, 0],
    bearing: geographicBearing(a, b) };
}

// 模型位置、朝向、鏡頭與重繪共用同一個時鐘；完成不依賴 SDK 回呼。
export function createPlayback({ clock, model, updateCamera = () => {}, redraw = () => {} }) {
  let active = null, version = 0, disposed = false;
  const current = run => !disposed && active === run && run.id === version;
  const cancel = () => { version++; active = null; clock.stop(); };
  const fail = (run, error) => {
    if (!current(run)) return;
    cancel();
    run.onError?.(error, { stopped: true, attempted: run.attempted });
  };
  const apply = (run) => {
    const pose = poseAt(run.route, Math.min(1, run.elapsed / run.durationSeconds));
    run.attempted = true;
    model.setCoordinates([...pose.position]);
    if (!current(run)) return;
    model.setRotation({ x: 0, y: 0, z: modelRotationFromBearing(pose.bearing) });
    if (!current(run)) return;
    const actual = model.coordinates;
    // 公開 setter 應同步生效；公分內讀回確認，不能沿用道路吸附誤差掩蓋未到站。
    if (!Array.isArray(actual) || !validCoordinate(actual.slice(0, 2)) || distanceMeters(actual, pose.position) > 0.01) throw new Error("模型位置未到達動畫要求的座標。");
    updateCamera([...actual], pose.bearing);
    if (current(run)) redraw();
  };
  const advance = (run, seconds) => {
    if (!current(run)) return;
    try {
      const remaining = Math.max(0, run.elapsed + seconds - run.durationSeconds);
      run.elapsed = Math.min(run.durationSeconds, run.elapsed + seconds);
      apply(run);
      if (!current(run) || run.elapsed < run.durationSeconds) return;
      active = null;
      clock.stop();
      // 呼叫前已確認終點；新路段可同步接手餘量，不重複計入下一幀。
      run.onEnd?.({ remainingSeconds: remaining });
    } catch (error) {
      if (current(run)) fail(run, error);
      else if (!disposed && run.id === version && active === null) {
        // 完成通知本身失敗仍須回報，但不能取消已由回呼啟動的新路段。
        cancel();
        run.onError?.(error, { stopped: true, attempted: run.attempted });
      }
    }
  };
  return {
    play({ path, durationSeconds, initialSeconds = 0, onStart, onEnd, onError }) {
      if (disposed) throw new Error("動畫控制器已清理。");
      cancel();
      const run = { id: version, elapsed: 0, durationSeconds, onEnd, onError, attempted: false };
      active = run;
      try {
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(initialSeconds) || initialSeconds < 0) throw new Error("路線動畫時間無效。");
        run.route = preparePath(path);
        apply(run);
        if (current(run)) onStart?.();
        if (current(run)) {
          clock.start(seconds => advance(run, seconds), error => fail(run, error));
          if (initialSeconds > 0) advance(run, initialSeconds);
        }
      } catch (error) { fail(run, error); }
      return { id: run.id, get elapsedSeconds() { return run.elapsed; }, cancel: () => { if (current(run)) cancel(); } };
    },
    get busy() { return active !== null; },
    cancel,
    dispose() { cancel(); disposed = true; clock.dispose(); },
  };
}
