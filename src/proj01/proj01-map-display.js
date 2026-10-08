export function mountPoiToggle({ map, button, reportError }) {
  let poiHidden = false;
  let styleReady = false;
  let disposed = false;
  const sync = () => {
    button.disabled = !styleReady || disposed;
    button.textContent = poiHidden ? "顯示地點圖標" : "隱藏地點圖標";
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
  button.addEventListener("click", toggle);
  map.on("dataloading", loading);
  map.on("style.load", loaded);
  if (map.isStyleLoaded() && !styleReady) loaded();
  return () => {
    disposed = true;
    button.removeEventListener("click", toggle);
    map.off("dataloading", loading);
    map.off("style.load", loaded);
    sync();
  };
}
