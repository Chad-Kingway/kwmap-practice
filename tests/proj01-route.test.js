import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDirections, validateEndpoints } from "../src/proj01/proj01-route.js";

const a = [121.56, 25.03];
const b = [121.561, 25.031];
const c = [121.562, 25.032];
const location = ([lng, lat]) => ({ lng, lat });
function fixture(segments) {
  const steps = segments.map((points, index) => ({
    polyline: { points: String(index) },
    start_location: location(points[0]), end_location: location(points.at(-1)),
  }));
  return { routes: [{ summary: "測試道路", legs: [{ steps }] }], decode: (encoded) => segments[Number(encoded)] };
}

test("只加總 leg 的數值秒數，缺失時間仍保留道路且不採用 route、step 或文字", () => {
  const { routes, decode } = fixture([[a, b], [b, c]]);
  const steps = routes[0].legs[0].steps;
  routes[0].duration = { value: 900 };
  steps.forEach(step => { step.duration = { value: 500 }; });
  routes[0].legs = [{ duration: { value: 300, text: "5 分鐘" }, steps: [steps[0]] },
    { duration: { value: 600, text: "10 分鐘" }, steps: [steps[1]] }];
  assert.equal(normalizeDirections(routes, decode).durationSeconds, 900);
  for (const invalid of [undefined, null, "600", 0, -1, NaN, Infinity]) {
    routes[0].legs[1].duration.value = invalid;
    const result = normalizeDirections(routes, decode);
    assert.equal(result.durationSeconds, null);
    assert.deepEqual(result.coordinates, [a, b, c]);
  }
  delete routes[0].legs[1].duration;
  assert.equal(normalizeDirections(routes, decode).durationSeconds, null);
  routes[0].legs.forEach(leg => { leg.duration = { value: Number.MAX_VALUE }; });
  assert.equal(normalizeDirections(routes, decode).durationSeconds, null);
});

test("檢查有限數值、範圍與相同起終點", () => {
  validateEndpoints(a, b);
  for (const invalid of [[NaN, 25], [Infinity, 25], [181, 25], [121, 91], [121]]) {
    assert.throws(() => validateEndpoints(invalid, b), /有限數值/);
  }
  assert.throws(() => validateEndpoints(a, [...a]), /不能相同/);
});

test("按 leg／step 順序連接，只去除相鄰重複點，保留繞行", () => {
  const { routes, decode } = fixture([[a, a, b], [b, c, b], [b, a]]);
  const steps = routes[0].legs[0].steps;
  routes[0].legs = [{ steps: steps.slice(0, 2) }, { steps: steps.slice(2) }];
  routes.push({ legs: [] });
  const result = normalizeDirections(routes, decode);
  assert.deepEqual(result.coordinates, [a, b, c, b, a]);
  assert.equal(result.candidates, 2);
  assert.equal(result.summary, "測試道路");
});

test("拒絕不連續、反向與經緯度顛倒的路段", () => {
  const disconnected = fixture([[a, b], [c, a]]);
  assert.throws(() => normalizeDirections(disconnected.routes, disconnected.decode), /不連續/);
  const reversed = fixture([[a, b]]);
  assert.throws(() => normalizeDirections(reversed.routes, () => [b, a]), /座標順序/);
  assert.throws(() => normalizeDirections(reversed.routes, () => a.map((_, index) => [a, b][index].toReversed())), /幾何座標/);
});

test("允許官方編碼小數五位量化的 metadata 誤差", () => {
  const { routes, decode } = fixture([[a, b]]);
  routes[0].legs[0].steps[0].start_location.lng += 0.000004;
  assert.deepEqual(normalizeDirections(routes, decode).coordinates, [a, b]);
});

test("拒絕只有概要線、缺失幾何、無效座標與單一位置", () => {
  assert.throws(() => normalizeDirections([], () => []), /可用路線/);
  assert.throws(() => normalizeDirections([{ overview_polyline: { points: "概要" } }], () => [a, b]), /路段資料/);
  const { routes, decode } = fixture([[a, b]]);
  assert.throws(() => normalizeDirections(routes, () => [[121, Infinity], b]), /幾何座標/);
  routes[0].legs[0].steps[0].polyline.points = "";
  assert.throws(() => normalizeDirections(routes, decode), /polyline/);
  const same = fixture([[a, a]]);
  assert.throws(() => normalizeDirections(same.routes, same.decode), /兩個不同位置/);
});
