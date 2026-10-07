import test from "node:test";
import assert from "node:assert/strict";
import { geographicBearing, initialPathBearing, modelRotationFromBearing, installSdkHeadingQuaternionFix } from "../src/examples/proj01-heading.js";

test("地理方位角與 SDK 的 Z 基準分開，四個方向均正確", () => {
  const origin = [121, 0];
  for (const [destination, bearing, z] of [
    [[121, 0.001], 0, 180], [[121.001, 0], 90, 90],
    [[121, -0.001], 180, 360], [[120.999, 0], 270, 270],
  ]) {
    assert.equal(geographicBearing(origin, destination), bearing);
    assert.equal(modelRotationFromBearing(bearing), z);
    // 實測 SDK 世界 -X 是東、-Y 是北；旋轉已校正的 +Y 車頭。
    const radians = z * Math.PI / 180, direction = bearing * Math.PI / 180;
    assert(Math.abs(-Math.sin(radians) + Math.sin(direction)) < 1e-12);
    assert(Math.abs(Math.cos(radians) + Math.cos(direction)) < 1e-12);
  }
});

test("取第一段不同位置、略過重複點，不用整條起終點方向", () => {
  const a = [121, 25, 12], north = [121, 25.001, 12], east = [121.001, 25.001, 12];
  assert.equal(initialPathBearing([a, a, north, east]), 0);
  assert.notEqual(geographicBearing(a, east), 0);
  assert.throws(() => initialPathBearing([a, a]), /不同位置/);
});

test("輸出是目標角度，重複設定不累加，零度以 360 重設", () => {
  assert.equal(modelRotationFromBearing(90), modelRotationFromBearing(90));
  assert.equal(modelRotationFromBearing(180), 360);
  assert.equal(modelRotationFromBearing(-180), 360);
  assert.equal(modelRotationFromBearing(450), 90);
  assert.throws(() => modelRotationFromBearing(NaN), /有限數值/);
});

test("修正 SDK 正北零軸半轉及高度投影造成的翻轉，其他模型不受影響", () => {
  class Axis {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
    clone() { return new Axis(this.x, this.y, this.z); }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  }
  class Quaternion {
    setFromAxisAngle(axis, angle) {
      const sine = Math.sin(angle / 2);
      this.x = axis.x * sine; this.y = axis.y * sine; this.z = axis.z * sine; this.w = Math.cos(angle / 2);
      this.lastAxis = axis;
      return this;
    }
  }
  const originalMethod = Quaternion.prototype.setFromAxisAngle;
  const model = { quaternion: new Quaternion() }, other = new Quaternion();
  const zero = new Axis(0, 0, 0);
  other.setFromAxisAngle(zero, Math.PI);
  assert(Math.hypot(other.x, other.y, other.z, other.w) < 1e-12, "重現 SDK 產生非單位 quaternion 的問題");
  installSdkHeadingQuaternionFix(model);
  const q = model.quaternion;
  for (const [axis, angle, expected] of [
    [zero, Math.PI, [0, -1]], [new Axis(0, 0, 1), Math.PI / 2, [-1, 0]],
    [zero, 0, [0, 1]], [new Axis(0, 0, -1), Math.PI / 2, [1, 0]],
    [new Axis(1, 0, 0), Math.PI - 1e-6, [0, -1]],
    [new Axis(-1, 0, 0), 1e-6, [0, 1]],
  ]) {
    assert.equal(q.setFromAxisAngle(axis, angle), q);
    assert(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-12);
    // 將已校正的 +Y 車頭套入 quaternion，北／東／南／西皆須符合世界方向。
    assert(Math.abs(-2 * q.z * q.w - expected[0]) < 1e-12);
    assert(Math.abs(1 - 2 * q.z ** 2 - expected[1]) < 1e-12);
    assert.equal(q.x, 0, "固定高度的車子須保持直立，只繞 Z 軸轉向");
    if (axis.x === 0 && angle !== Math.PI) assert.equal(q.lastAxis, axis);
  }
  assert.equal(other.setFromAxisAngle, originalMethod);
  assert.equal(Quaternion.prototype.setFromAxisAngle, originalMethod);
  assert.deepEqual(zero, new Axis(0, 0, 0));
  assert.throws(() => installSdkHeadingQuaternionFix({}), /quaternion 介面/);
});
