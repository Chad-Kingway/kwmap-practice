// mapThree 1.4.3 已實測公開 getMapView、jumpTo 與 rotate 事件；不使用底層地圖入口。
// 內建 NavigationControl 回正北預設有動畫，因此使用同步回正北的獨立按鈕。
export function mountCompass({ map, button, needle, beforeReset, reportError }) {
  let styleReady = false;
  let disposed = false;
  const syncDirection = () => {
    if (disposed || !styleReady) return;
    try {
      const bearing = map.getMapView().bearing;
      if (!Number.isFinite(bearing)) throw new Error("無法讀取地圖方向");
      const angle = ((bearing + 180) % 360 + 360) % 360 - 180;
      needle.style.transform = `rotate(${-angle}deg)`;
      button.disabled = false;
    } catch (error) {
      button.disabled = true;
      reportError(new Error(`指南針同步失敗：${error.message || String(error)}`));
    }
  };
  const loaded = () => {
    if (disposed) return;
    styleReady = true;
    syncDirection();
  };
  const loading = (event) => {
    if (disposed || event.dataType !== "style") return;
    styleReady = false;
    button.disabled = true;
  };
  const stopPropagation = (event) => event.stopPropagation();
  const reset = (event) => {
    stopPropagation(event);
    if (disposed || button.disabled) return;
    try {
      beforeReset();
      // 僅指定 bearing，保留當下中心、縮放與俯角，且不啟動鏡頭動畫。
      map.jumpTo({ bearing: 0 });
      map.redraw();
      syncDirection();
    } catch (error) {
      reportError(new Error(`回正北失敗：${error.message || String(error)}`));
    }
  };
  button.disabled = true;
  button.addEventListener("click", reset);
  const isolatedEvents = ["pointerdown", "pointerup", "dblclick", "contextmenu", "wheel"];
  for (const event of isolatedEvents) button.addEventListener(event, stopPropagation, { passive: true });
  map.on("rotate", syncDirection);
  map.on("dataloading", loading);
  map.on("style.load", loaded);
  if (map.isStyleLoaded() && !styleReady) loaded();
  return () => {
    disposed = true;
    button.disabled = true;
    button.removeEventListener("click", reset);
    for (const event of isolatedEvents) button.removeEventListener(event, stopPropagation);
    map.off("rotate", syncDirection);
    map.off("dataloading", loading);
    map.off("style.load", loaded);
  };
}
