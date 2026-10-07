// 依 1.4.3 實際回呼資料：候選路線陣列 → legs → steps → polyline.points。
export function validCoordinate(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

export function validateEndpoints(origin, destination) {
  if (!validCoordinate(origin) || !validCoordinate(destination)) {
    throw new Error("請輸入有限數值，經度須在 -180～180、緯度須在 -90～90。");
  }
  if (origin[0] === destination[0] && origin[1] === destination[1]) {
    throw new Error("起終點不能相同。");
  }
}

function near(a, b) {
  // polyline 的小數五位量化；允許接點及未量化的 step metadata 有約兩公尺誤差。
  return Math.abs(a[0] - b[0]) <= 0.00002 && Math.abs(a[1] - b[1]) <= 0.00002;
}

export function normalizeDirections(routes, decodePolyline) {
  if (!Array.isArray(routes) || routes.length === 0) throw new Error("服務未提供可用路線。");
  const route = routes[0];
  if (!Array.isArray(route?.legs) || route.legs.length === 0) throw new Error("第一條候選路線缺少路段資料。");
  const coordinates = [];
  for (const leg of route.legs) {
    if (!Array.isArray(leg?.steps) || leg.steps.length === 0) throw new Error("路段缺少完整的 steps 幾何。");
    for (const step of leg.steps) {
      const encoded = step?.polyline?.points;
      if (typeof encoded !== "string" || !encoded.length) throw new Error("路線步驟缺少編碼 polyline，無法取得完整道路。");
      const points = decodePolyline(encoded);
      if (!Array.isArray(points) || points.length < 2 || !points.every(validCoordinate)) {
        throw new Error("官方解碼未提供有效的 [經度, 緯度] 幾何座標。");
      }
      const start = [step.start_location?.lng, step.start_location?.lat];
      const end = [step.end_location?.lng, step.end_location?.lat];
      if (!validCoordinate(start) || !validCoordinate(end) || !near(points[0], start) || !near(points.at(-1), end)) {
        throw new Error("路線步驟的座標順序或起終點不符合幾何資料。");
      }
      if (coordinates.length && !near(coordinates.at(-1), points[0])) {
        throw new Error("路線步驟或 leg 接點不連續，不能以直線補接缺失的道路。");
      }
      for (const point of points) {
        const previous = coordinates.at(-1);
        // 只移除相鄰完全相同的點，保留迴轉或繞行回到同一位置的情況。
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) coordinates.push([...point]);
      }
    }
  }
  if (coordinates.length < 2) throw new Error("路線至少需要兩個不同位置。");
  return {
    coordinates,
    candidates: routes.length,
    summary: typeof route.summary === "string" ? route.summary : "汽車路線"
  };
}
