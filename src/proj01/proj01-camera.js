// jumpTo 同步更新視角，不啟動 flyTo 或依賴 SDK 路徑動畫佇列。
export function createFollowCamera({ map, view }) {
  let following = false;
  return {
    get following() { return following; },
    start(position, bearing) {
      map.jumpTo({ ...view, center: position.slice(0, 2), bearing });
      following = true;
      map.redraw();
    },
    update(position, bearing) {
      if (following) map.jumpTo({ center: position.slice(0, 2), bearing });
    },
    stop() { following = false; },
  };
}
