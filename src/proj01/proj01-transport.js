import { normalizeDirections, validCoordinate } from "./proj01-route.js";

// 接人可略過的近距離；道路貼齊僅容許小幅座標校正，不補畫直線。
export const PICKUP_NEAR_METERS = 5;
// 實際預製需求 01 的道路貼齊約 36.7 公尺；上限 50 公尺，超出即拒絕出發。
export const ROAD_SNAP_METERS = 50;

export function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function pathLength(path) {
  if (!Array.isArray(path) || path.length < 2 || !path.every(validCoordinate)) throw new Error("接送路線座標無效。");
  const length = path.slice(1).reduce((sum, point, index) => sum + distanceMeters(path[index], point), 0);
  if (!(length > 0)) throw new Error("接送路線須有兩個不同位置。");
  return length;
}

function checkSnap(a, b, label) {
  const distance = distanceMeters(a, b);
  if (distance > ROAD_SNAP_METERS) throw new Error(`${label}相距 ${distance.toFixed(1)} 公尺，超過道路貼齊容許值 ${ROAD_SNAP_METERS} 公尺，無法使用此接送路線。`);
}

export function createTransport({ requestList, isAvailable, getPosition, getDuration, getDirections, decodePolyline, playSegment, showSegment, clearSegment, changed, reportError }) {
  let task = null;
  let version = 0;
  let disposed = false;
  let cancelQuery;
  const available = () => !disposed && !task && isAvailable();
  const eligible = (request) => request?.status === "pending" && requestList.getRouteState(request.id)?.status === "ready";
  const canStart = (id = requestList.selectedRequestId) => available()
    && eligible(requestList.requests.find((request) => request.id === id));
  const canStartNearest = () => available() && requestList.requests.some(eligible);
  const current = (job) => !disposed && task === job && job.id === version;
  const notify = (label) => changed(label);
  const clear = (job, label) => {
    if (!current(job)) return;
    clearSegment();
    task = null;
    notify(label);
  };
  const failure = (job, error, { stopped, attempted } = { stopped: true, attempted: false }) => {
    if (!current(job)) return;
    job.failed = true;
    // 已上車或呼叫過 SDK 動畫後，不把乘客還原為等待接送。
    if (!job.attempted && !attempted && job.phase === "assigned") requestList.setStatus(job.requestId, "pending");
    reportError(error, !stopped);
    if (stopped) clear(job, "閒置（接送中斷）");
    else notify("接送異常（等待動畫結束）");
  };
  const queryPickup = (job, origin, destination) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelQuery = null;
      if (error) reject(error); else resolve(data);
    };
    const timer = setTimeout(() => finish(new Error("接人路線查詢逾時，請重試。")), 20000);
    cancelQuery = () => finish(new Error("接送任務已失效。"));
    try {
      // 查詢參數另做副本，隔離 SDK 對陣列的處理，不改變本次位置與銜接驗證基準。
      const pending = getDirections().route({ origin: [...origin], destination: [...destination], travelMode: "DRIVING" }, (candidates, status) => {
        if (!current(job)) { finish(new Error("接送任務已失效。")); return; }
        if (status !== "OK") { finish(new Error(`接人路線查詢失敗：${String(status)}。`)); return; }
        try { finish(null, normalizeDirections(candidates, decodePolyline).coordinates); }
        catch (error) { finish(error); }
      });
      Promise.resolve(pending).catch((error) => finish(error));
    } catch (error) { finish(error); }
  });
  const runSegment = (job, index) => {
    if (!current(job) || job.failed) return;
    const segment = job.segments[index];
    const sequence = ++job.sequence;
    const valid = () => current(job) && sequence === job.sequence;
    try {
      checkSnap(getPosition().slice(0, 2), segment.path[0], "車輛與路段起點");
      showSegment(segment.path, job.color, job.id);
      if (segment.phase === "onboard") {
        job.phase = "onboard";
        requestList.setStatus(job.requestId, "onboard");
      }
      notify(segment.phase === "onboard" ? "送人中" : "前往接人");
      playSegment({ path: segment.path, duration: segment.duration,
        onStart: () => {
          if (!valid() || job.failed) return;
          job.attempted = true;
          job.phase = segment.phase;
          requestList.setStatus(job.requestId, segment.phase);
        },
        onEnd: () => {
          if (!valid()) return;
          job.sequence++;
          if (job.failed) { clear(job, "閒置（接送中斷）"); return; }
          if (index + 1 < job.segments.length) runSegment(job, index + 1);
          else {
            requestList.setStatus(job.requestId, "completed");
            clear(job, "閒置");
          }
        },
        onError: (error, details) => { if (valid()) failure(job, error, details); },
      });
    } catch (error) { failure(job, error); }
  };
  const start = async (id = requestList.selectedRequestId, { nearest = false } = {}) => {
    if (nearest ? !canStartNearest() : !canStart(id)) return;
    let job;
    try {
      const origin = getPosition().slice(0, 2);
      if (!validCoordinate(origin)) throw new Error("車輛當下座標無效。");
      let request = requestList.requests.find((item) => item.id === id);
      if (nearest) {
        let closest = Infinity;
        for (const candidate of requestList.requests) {
          if (!eligible(candidate)) continue;
          const distance = distanceMeters(origin, candidate.origin);
          // 嚴格小於保留同距離的清單先後順序；只比較原始起點直線距離。
          if (distance < closest) { request = candidate; closest = distance; }
        }
      }
      if (!eligible(request) || !available()) return;
      const duration = getDuration();
      const dropoff = requestList.getRouteState(request.id).coordinates.map((point) => [...point]);
      const dropoffLength = pathLength(dropoff);
      job = { id: ++version, requestId: request.id, origin: [...request.origin], destination: [...request.destination],
        color: request.color, dropoff, phase: "assigned", sequence: 0, attempted: false, failed: false };
      // 同步保留需求與總時間，await 期間切換選取不能更換任務。
      task = job;
      requestList.setStatus(job.requestId, "assigned");
      if (nearest) requestList.selectById(job.requestId);
      notify("準備接送");
      let pickup = null;
      if (distanceMeters(origin, job.origin) > PICKUP_NEAR_METERS && distanceMeters(origin, dropoff[0]) > PICKUP_NEAR_METERS) {
        pickup = await queryPickup(job, origin, [...job.origin]);
        if (!current(job)) return;
        checkSnap(origin, pickup[0], "車輛與接人路線起點");
        // 輸入座標可被服務吸附到道路；銜接比較兩段實際道路端點，而非原始乘客座標。
        checkSnap(pickup.at(-1), dropoff[0], "接人與送人路線接點");
      } else checkSnap(origin, dropoff[0], "車輛與送人路線起點");
      const pickupLength = pickup ? pathLength(pickup) : 0;
      const pickupDuration = duration * pickupLength / (pickupLength + dropoffLength);
      job.segments = [
        ...(pickup ? [{ phase: "pickingUp", path: pickup, duration: pickupDuration }] : []),
        { phase: "onboard", path: dropoff, duration: duration - pickupDuration },
      ];
      runSegment(job, 0);
    } catch (error) {
      if (job) failure(job, error);
      else reportError(error, false);
    }
  };
  return {
    canStart, start, canStartNearest,
    startNearest: () => start(undefined, { nearest: true }),
    get busy() { return task !== null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      version++;
      cancelQuery?.();
      clearSegment();
      task = null;
    },
  };
}
