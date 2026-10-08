// 時間與頁面可見性集中在此；目前只掛接一個更新者，不提前建立多車管理。
export function createSimulationClock({ getSpeedMultiplier, requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame, now = () => performance.now(), visibility = document }) {
  let frame = null, listener = null, errorListener = null, previous = null, frameTime = null;
  let version = 0, disposed = false;
  const schedule = () => {
    const run = version;
    frame = requestFrame((timestamp) => {
      if (run !== version || !listener || visibility.hidden) return;
      frame = null;
      try {
        if (!Number.isFinite(timestamp)) throw new Error("動畫時間戳無效。");
        const multiplier = getSpeedMultiplier();
        if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 300) throw new Error("速度倍率須為 1～300 的整數。");
        const elapsed = Math.max(0, timestamp - previous) / 1000;
        previous = Math.max(previous, timestamp);
        frameTime = previous;
        listener(elapsed * multiplier);
      } catch (error) {
        if (run === version) {
          const report = errorListener;
          stop();
          report?.(error);
        }
      } finally { frameTime = null; }
      if (run === version && listener && !visibility.hidden) schedule();
    });
  };
  const clearFrame = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  const visibleChanged = () => {
    version++;
    clearFrame();
    previous = visibility.hidden ? null : now();
    if (!visibility.hidden && listener) schedule();
  };
  function stop() {
    version++;
    clearFrame();
    listener = errorListener = null;
    previous = null;
    visibility.removeEventListener("visibilitychange", visibleChanged);
  }
  return {
    start(update, onError) {
      if (disposed) throw new Error("模擬時鐘已清理。");
      stop();
      listener = update;
      errorListener = onError;
      // 同一幀完成接人並開始送人時，沿用該幀基準，餘量由控制器交接。
      previous = visibility.hidden ? null : frameTime ?? now();
      visibility.addEventListener("visibilitychange", visibleChanged);
      if (!visibility.hidden) schedule();
    },
    stop,
    dispose() { stop(); disposed = true; },
  };
}
