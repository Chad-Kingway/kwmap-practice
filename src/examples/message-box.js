import { accessKey, accessToken } from "../config.js";

export async function init() {
  document.title = "訊息視窗";
  const container = document.createElement("div");
  container.id = "map";
  document.getElementById("app").replaceChildren(container);

  const map = await new mapPlus(container, {
    accessKey,
    accessToken,
    style: "https://kw3dmap.localking.com.tw/openapi/map/kwmap.etxt", // 樣式
    center: [121.5648431044541, 25.03407570226979], // 地圖中心點
    pitch: 0, // 視角傾斜角度，0～85
    bearing: 0, // 視角旋轉角度，0～360
    zoom: 15.5, // 縮放級別
    maxZoom: 18, // 最大縮放級別
    minZoom: 7, // 最小縮放級別
  });

  map.on("style.load", () => {
    // 調整 position 可移動訊息視窗；調整 content 可變更內容。
    new mapPlus.InfoWindow({
      position: [121.5648431044541, 25.03407570226979],
      content: "開始使用KWMAP !",
      animation: mapPlus.Animation.GROW,
    }).open();

    // 點擊 POI 可顯示彈跳視窗。
    map.on("click", ({ point }) => {
      const features = map.queryRenderedFeatures(point);
      if (features.length === 0) return;

      const [{
        properties: { name, alladdr },
        geometry: { coordinates },
      }] = features;
      if (!name || !alladdr) return;

      new mapPlus.InfoWindow({
        position: coordinates,
        content: "地名：" + name + "<br>地址：" + alladdr,
        animation: mapPlus.Animation.GROW,
      }).open();
    });
  });
}
