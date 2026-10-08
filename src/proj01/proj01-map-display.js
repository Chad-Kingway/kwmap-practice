export function mountPoiToggle({ map, button, reportError }) {
  let poiHidden = false;
  let styleReady = false;
  let disposed = false;
  const sync = () => {
    button.disabled = !styleReady || disposed;
    const label = poiHidden ? "顯示地點圖標" : "隱藏地點圖標";
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(poiHidden));
  };
  const apply = (hidden) => {
    if (hidden) map.offLayer("poi_");
    else map.onLayer("poi_");
    map.redraw();
  };
  const loaded = () => {
    if (disposed) return;
    styleReady = true;
    try { apply(poiHidden); }
    catch (error) {
      styleReady = false;
      reportError(new Error(`地點圖標設定失敗：${error.message || String(error)}`));
    }
    sync();
  };
  const loading = (event) => {
    if (disposed) return;
    // 已實測事件區分 style／source；來源瓦片載入不代表樣式正在重新載入。
    if (event.dataType === "style") { styleReady = false; sync(); }
  };
  const toggle = () => {
    if (disposed || !styleReady) return;
    try {
      apply(!poiHidden);
      poiHidden = !poiHidden;
    } catch (error) {
      // setter 或重繪部分完成後失敗時，盡量還原；還原失敗則停用直到樣式重載。
      let reason = `地點圖標切換失敗：${error.message || String(error)}`;
      try { apply(poiHidden); }
      catch { styleReady = false; reason += "，無法還原，請重新整理。"; }
      reportError(new Error(reason));
    }
    sync();
  };
  sync();
  // 按鈕位於 SDK 容器之外；隔離其滾輪，避免跟隨模式的 window 監聽改變視角。
  const stopWheel = (event) => event.stopPropagation();
  button.addEventListener("click", toggle);
  button.addEventListener("wheel", stopWheel, { passive: true });
  map.on("dataloading", loading);
  map.on("style.load", loaded);
  if (map.isStyleLoaded() && !styleReady) loaded();
  return () => {
    disposed = true;
    button.removeEventListener("click", toggle);
    button.removeEventListener("wheel", stopWheel);
    map.off("dataloading", loading);
    map.off("style.load", loaded);
    sync();
  };
}
