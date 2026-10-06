import { accessKey, accessToken } from "../config.js";

export async function init() {
  document.title = "基本地圖";
  const container = document.createElement("div");
  container.id = "map";
  document.getElementById("app").replaceChildren(container);

  // 調整中心點、視角與縮放級別，可設定地圖的初始顯示方式。
  await new mapPlus(container, {
    accessKey,
    accessToken,
    style: "https://kw3dmap.localking.com.tw/openapi/map/kwmap.etxt", // 樣式
    center: [121.53559860212545, 25.029308142529132], // 地圖中心點
    pitch: 0, // 視角傾斜角度，0～85
    bearing: 0, // 視角旋轉角度，0～360
    zoom: 14, // 初始縮放級別，0～24
    maxZoom: 18, // 最大縮放級別，0～24
    minZoom: 7, // 最小縮放級別，0～24
  });
}
