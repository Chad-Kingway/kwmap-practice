import { validCoordinate } from "./proj01-route.js";
import { distanceMeters } from "./proj01-transport.js";

export function generateRandomEndpoints({ range, minDistanceMeters, maxAttempts, random = Math.random }) {
  const { minLng, maxLng, minLat, maxLat } = range;
  if (!validCoordinate([minLng, minLat]) || !validCoordinate([maxLng, maxLat])
    || minLng >= maxLng || minLat >= maxLat || !Number.isFinite(minDistanceMeters) || minDistanceMeters <= 0
    || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("隨機需求範圍或條件無效。");
  const sample = () => {
    const lng = random(), lat = random();
    if (![lng, lat].every(value => Number.isFinite(value) && value >= 0 && value < 1)) {
      throw new Error("隨機需求亂數無效。");
    }
    return [minLng + lng * (maxLng - minLng), minLat + lat * (maxLat - minLat)];
  };
  // 每次重抽完整起終點，使用公尺距離篩選，保留原始座標精度。
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const origin = sample(), destination = sample();
    if (distanceMeters(origin, destination) >= minDistanceMeters) return { origin, destination };
  }
  throw new Error("無法產生隨機需求，請再試一次。");
}
