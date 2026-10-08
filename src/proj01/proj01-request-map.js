import { normalizeDirections, validateEndpoints } from "./proj01-route.js";

export function mountRequestMap({ map, sdk, directions, requestList }) {
  const markers = new Map();
  const lineIds = new Set();
  let disposed = false;
  let cancelPending;
  const queue = [];
  const queued = new Set();
  let draining = false;
  let loading = Promise.resolve();
  const lineId = (id) => `proj01-request-route-${id}`;
  const drawRoute = (request) => {
    const route = requestList.getRouteState(request.id);
    const id = lineId(request.id);
    if (lineIds.has(id)) map.three.remove3dObjectById(id);
    lineIds.delete(id);
    if (route?.status !== "ready") return;
    lineIds.add(id);
    map.three.add3dLine({
      id, coordinates: route.coordinates.map(([lng, lat]) => [lng, lat, 0]),
      color: request.color, width: request.id === requestList.selectedRequestId ? 7 : 3,
    });
  };
  const updateSelection = () => {
    if (disposed) return;
    for (const request of requestList.requests) {
      const selected = request.id === requestList.selectedRequestId;
      for (const { icon } of markers.get(request.id) ?? []) {
        icon.classList.toggle("proj01-request-selected", selected);
        icon.classList.toggle("proj01-request-completed", request.status === "completed");
      }
      drawRoute(request);
    }
    map.redraw();
  };
  // 需求端點與任務路線分開管理；新增只附加自己的物件。
  const addMarkers = (request) => {
    const endpoints = [];
    markers.set(request.id, endpoints);
    try {
      for (const [point, endpoint] of [[request.origin, "起"], [request.destination, "迄"]]) {
        const icon = document.createElement("span");
        icon.className = "proj01-request-marker";
        icon.style.backgroundColor = request.color;
        icon.classList.toggle("proj01-request-selected", request.id === requestList.selectedRequestId);
        icon.textContent = `${request.id.slice("request-".length)} ${endpoint}`;
        const marker = new sdk.Marker({ position: [...point], altitude: 0, icon, title: `需求 ${icon.textContent}` });
        endpoints.push({ marker, icon });
      }
    } catch (error) {
      for (const { marker } of endpoints) marker.remove();
      markers.set(request.id, []);
      requestList.setRouteState(request.id, { status: "error", error: `需求標記建立失敗：${error.message}` });
    }
  };
  const unsubscribe = requestList.subscribeSelection(updateSelection);
  const unsubscribeStatus = requestList.subscribeChange(({ type, id }) => {
    if (disposed) return;
    if (type === "added") enqueue(requestList.requests.find((request) => request.id === id));
    else if (type === "status") updateSelection();
  });
  const query = (request) => new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, response) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cancelPending = null;
      if (error) reject(error);
      else resolve(response);
    };
    const timer = setTimeout(() => finish(new Error("路線查詢逾時。")), 20000);
    cancelPending = () => finish(new Error("需求地圖已釋放。"));
    try {
      validateEndpoints(request.origin, request.destination);
      const pending = directions.route({ origin: [...request.origin], destination: [...request.destination], travelMode: "DRIVING" },
        (candidates, status) => finish(null, { candidates, status }));
      Promise.resolve(pending).catch((error) => finish(error));
    } catch (error) { finish(error); }
  });
  const loadRoutes = async () => {
    draining = true;
    try {
      while (queue.length) {
        if (disposed) return;
        const request = queue.shift();
        if (!directions) {
          requestList.setRouteState(request.id, { status: "error", error: "道路服務無法使用。" });
          continue;
        }
        requestList.setRouteState(request.id, { status: "loading" });
        try {
          const { candidates, status } = await query(request);
          if (disposed) return;
          if (status !== "OK") throw new Error(`道路服務回傳：${String(status)}。`);
          if (!Array.isArray(candidates) || candidates.length === 0) {
            requestList.setRouteState(request.id, { status: "unavailable", error: "服務未提供可用路線。" });
            continue;
          }
          const route = normalizeDirections(candidates, (encoded) => map.decodePolyline(encoded));
          requestList.setRouteState(request.id, { status: "ready", ...route,
            ...(route.durationSeconds === null ? { error: "缺少有效路線時間，無法接送。" } : {}) });
          drawRoute(request);
          map.redraw();
        } catch (error) {
          if (disposed) return;
          map.three.remove3dObjectById(lineId(request.id));
          lineIds.delete(lineId(request.id));
          requestList.setRouteState(request.id, { status: "error", error: error.message || String(error) });
          map.redraw();
        }
      }
    } finally { draining = false; }
  };
  const enqueue = (request) => {
    if (disposed || !request || queued.has(request.id)) return;
    queued.add(request.id);
    addMarkers(request);
    queue.push(request);
    map.redraw();
    if (!draining) loading = loadRoutes();
  };
  for (const request of requestList.requests) enqueue(request);
  return {
    get loading() { return loading; },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unsubscribeStatus();
      cancelPending?.();
      queue.length = 0;
      queued.clear();
      for (const endpoints of markers.values()) for (const { marker } of endpoints) marker.remove();
      for (const id of lineIds) map.three.remove3dObjectById(id);
      markers.clear();
      lineIds.clear();
      map.redraw();
    },
  };
}
