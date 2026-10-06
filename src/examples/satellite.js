import { accessKey, accessToken } from "../config.js";
import "./satellite.css";

export async function init() {
  document.title = "衛星影像圖層";

  // 只在此範例載入官方指定的 Bootstrap 依賴，完成後才初始化地圖與 tooltip。
  await Promise.all([
    {
      tag: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/css/bootstrap.min.css",
        integrity: "sha384-4bw+/aepP/YC94hEpVNVgiZdgIC5+VKNBQNGCHeKRQN+PtmoHDEXuppvnDJzQIu9",
        crossorigin: "anonymous",
      },
    },
    {
      tag: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css",
      },
    },
    {
      tag: "script",
      attributes: {
        src: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js",
        integrity: "sha384-HwwvtgBNo3bZJJLYd8oVXjrBZt8cqVSpeBNS5n7C8IVInixGAoxmnlMuBnhbgrkm",
        crossorigin: "anonymous",
      },
    },
  ].map(({ tag, attributes }) => new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.onload = resolve;
    element.onerror = () => reject(new Error("無法載入衛星範例的 Bootstrap 外部依賴。"));
    document.head.append(element);
  })));

  const app = document.getElementById("app");
  app.innerHTML = `
    <div id="map"></div>
    <aside
      id="toolbar"
      class="d-flex flex-column align-items-center gap-3 bg-white p-2 pb-3 rounded-2 shadow"
    >
      <div class="pb-2 border-bottom border-secondary-subtle">
        <img
          src="https://kw3dmap.autoking.com.tw/kingway-logo.png"
          alt="Kingway map"
          width="44"
          height="44"
        />
      </div>
      <div>
        <input type="checkbox" class="btn-check" id="toggleBtnSatellite" autocomplete="off" />
        <label
          class="btn btn-outline-primary"
          for="toggleBtnSatellite"
          data-bs-toggle="tooltip"
          data-bs-placement="left"
          data-bs-title="顯示/隱藏衛星圖"
        >
          <i class="bi bi-gear-fill"></i>
        </label>
      </div>
    </aside>
  `;

  const map = await new mapPlus(document.getElementById("map"), {
    accessKey,
    accessToken,
    style: "https://kw3dmap.localking.com.tw/openapi/map/kwmap.etxt", // 樣式
    center: [121.53559860212545, 25.029308142529132], // 地圖中心點
    pitch: 0, // 視角傾斜角度，0～85
    bearing: 0, // 視角旋轉角度，0～360
    zoom: 16,
    maxZoom: 18,
    minZoom: 7,
  });

  map.on("style.load", () => {
    // 關閉 3D 建築，保留官方範例加入圖層的時機與參數。
    map.offLayer("base3d");
    map.addLayer(
      {
        id: "satellite",
        type: "raster",
        source: {
          type: "raster",
          tiles: [
            "https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}",
          ],
          // 圖磚像素大小，決定載入的精細度。
          tileSize: 512,
        },
        paint: {
          "raster-opacity": 1,
        },
      },
      "nav_croad11"
    );
  });

  // Bootstrap 提示訊息初始化。
  const tooltipList = app.querySelectorAll('[data-bs-toggle="tooltip"]');
  [...tooltipList].map((tooltip) => new bootstrap.Tooltip(tooltip));

  // 沿用官方 checked 屬性判斷、圖層切換與重新繪製順序。
  const toggleLayer = (checkboxElement, layerName) => {
    if (checkboxElement.getAttribute("checked")) {
      map.offLayer(layerName);
      checkboxElement.removeAttribute("checked");
    } else {
      map.onLayer(layerName);
      checkboxElement.setAttribute("checked", true);
    }
    map.redraw();
  };

  const toggleBtnSatellite = document.getElementById("toggleBtnSatellite");
  toggleBtnSatellite.setAttribute("checked", true);
  toggleBtnSatellite.addEventListener("click", () =>
    toggleLayer(toggleBtnSatellite, "satellite")
  );
}
