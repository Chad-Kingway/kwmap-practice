// 地理方位角：北為 0 度、東為 90 度，與模型 Z 軸角度分開處理。
export function geographicBearing(from, to) {
  if (from[0] === to[0] && from[1] === to[1]) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(from[1]);
  const lat2 = radians(to[1]);
  const deltaLng = radians(to[0] - from[0]);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function initialPathBearing(path) {
  const valid = path.filter((point) => Array.isArray(point) && point.length >= 2
    && point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
  for (let i = 1; i < valid.length; i++) {
    const bearing = geographicBearing(valid[i - 1], valid[i]);
    if (bearing !== null) return bearing;
  }
  throw new Error("路徑缺少有效且不同位置的線段，無法設定起始方向。");
}

export function modelRotationFromBearing(bearing) {
  if (!Number.isFinite(bearing)) throw new Error("地理前進方位角必須是有限數值。");
  // 已查驗 1.4.3：世界座標 -X 為東、-Y 為北；trackHeading 以 +Y 為車頭基準。
  // 素材建立時須校正到 +Y，之後與 SDK 相同，以逆時針 Z 旋轉朝向前進方向。
  const z = ((180 - bearing) % 360 + 360) % 360;
  // SDK setRotation 以「角度 || 目前角度」取值，傳 0 無法重設；360 是等價的目標角。
  return z === 0 ? 360 : z;
}

export function installSdkHeadingQuaternionFix(model) {
  const quaternion = model.quaternion;
  if (typeof quaternion?.setFromAxisAngle !== "function") {
    throw new Error("目前模型未提供已查驗的 quaternion 介面，無法保證自動車頭方向。");
  }
  const setFromAxisAngle = quaternion.setFromAxisAngle;
  // 已重現 1.4.3：正北零軸半轉無效；固定非零高度的投影差異還會使車子繞 X 軸翻轉。
  // SDK 以 +Y 與當下切線的叉積求軸（Y=0）。還原其水平前進方向，只保留 Z 轉向。
  // 僅處理目前模型，不修改全域 THREE；方向仍由 SDK 切線產生，不另設播放中的旋轉。
  quaternion.setFromAxisAngle = function (axis, angle) {
    const zeroAxis = axis.x === 0 && axis.y === 0 && axis.z === 0;
    if (axis.y === 0 && (axis.x !== 0 || (zeroAxis && Math.abs(angle - Math.PI) < 1e-12))) {
      const yaw = Math.atan2(axis.z * Math.sin(angle), Math.cos(angle));
      return setFromAxisAngle.call(this, axis.clone().set(0, 0, 1), yaw);
    }
    return setFromAxisAngle.call(this, axis, angle);
  };
}
