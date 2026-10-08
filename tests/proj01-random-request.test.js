import test from "node:test";
import assert from "node:assert/strict";
import { generateRandomEndpoints } from "../src/proj01/proj01-random-request.js";
import { distanceMeters } from "../src/proj01/proj01-transport.js";

const range = { minLng: 121.5102, maxLng: 121.5693, minLat: 25.03068, maxLat: 25.06026 };
const options = { range, minDistanceMeters: 200, maxAttempts: 20 };

test("獨立均勻抽樣維持經緯度順序與範圍，使用公尺距離", () => {
  const values = [0, 0.25, 0.75, 0.999999];
  const { origin, destination } = generateRandomEndpoints({ ...options, random: () => values.shift() });
  assert.deepEqual(origin, [range.minLng, range.minLat + 0.25 * (range.maxLat - range.minLat)]);
  assert.deepEqual(destination, [range.minLng + 0.75 * (range.maxLng - range.minLng), range.minLat + 0.999999 * (range.maxLat - range.minLat)]);
  for (const [lng, lat] of [origin, destination]) {
    assert.ok(lng >= range.minLng && lng <= range.maxLng);
    assert.ok(lat >= range.minLat && lat <= range.maxLat);
  }
  assert.ok(distanceMeters(origin, destination) >= 200);
});

test("兩點不同但小於 200 公尺時重抽完整起終點", () => {
  const values = [0.5, 0.5, 0.51, 0.51, 0, 0, 0.9, 0.9];
  assert.ok(distanceMeters([121.53975, 25.04547], [121.540341, 25.0457658]) < 200);
  let calls = 0;
  const result = generateRandomEndpoints({ ...options, random: () => { calls++; return values.shift(); } });
  assert.equal(calls, 8);
  assert.deepEqual(result.origin, [range.minLng, range.minLat]);
  assert.ok(distanceMeters(result.origin, result.destination) >= 200);
});

test("使用傳入的範圍與嘗試上限，失敗後停止抽樣", () => {
  let calls = 0;
  assert.throws(() => generateRandomEndpoints({ range: { minLng: 121, maxLng: 121.0001, minLat: 25, maxLat: 25.0001 },
    minDistanceMeters: 200, maxAttempts: 3, random: () => { calls++; return calls % 2 ? 0 : 0.9; } }), /無法產生隨機需求/);
  assert.equal(calls, 12);
});
