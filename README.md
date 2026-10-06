# 勤崴 3D Map SDK 練習

使用 Vite、Vanilla JavaScript、HTML / CSS，將官方範例整理成共用入口的本機練習專案。

## 啟動

首次使用時，將 `.env.example` 複製成 `.env`，填入勤崴提供的 `ACCESS_KEY` 與 `ACCESS_TOKEN`；已有 `.env` 時請保留原內容。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址，例如 `http://localhost:5173/`，從繁體中文首頁選單點選「基本地圖」、「訊息視窗」、「衛星影像」或「test01：3D 模型實驗室」。未指定 `example` 或參數為空時，只顯示選單，不載入範例 module、SDK loader 或初始化地圖。

也可直接開啟 `/?example=basic-map`、`/?example=message-box`、`/?example=satellite` 或 `/?example=test01`。選單使用一般 `<a>` 連結，支援重新整理與瀏覽器上一頁；無效名稱顯示錯誤訊息與返回首頁連結。

`npm run build` 產生 `dist/`，可用 `npm run preview` 預覽。SDK 與地圖資料由官方網站載入，需要網路及有效憑證。

## 檔案與環境變數

- `index.html`：共用 HTML。
- `src/sdk.js`：依範例載入官方 1.4.3 SDK，等待建構函式就緒並處理載入失敗與逾時。
- `src/main.js`：集中登記範例名稱、顯示文字與載入函式，產生首頁選單並以明確 mapping 載入 example。
- `src/config.js`：共用憑證設定。
- `src/style.css`：全螢幕地圖、錯誤訊息及限定於首頁 class 的選單樣式。
- `src/examples/basic-map.js`：基本地圖，沿用共用憑證、loader 與樣式，初始中心點為 `[121.53559860212545, 25.029308142529132]`，縮放級別為 14，範圍為 7～18。
- `src/examples/message-box.js`：保留官方範例的地圖設定、訊息視窗與 POI 點擊事件。
- `src/examples/satellite.js` 與 `satellite.css`：衛星影像圖層、工具列與顯示／隱藏按鈕，使用 `/?example=satellite` 開啟。
- `src/examples/test01.js` 與 `test01.css`：3D 模型與路徑實驗室，獨立載入 mapThree 1.4.3；既有範例維持 mapPlus 1.4.3，每次頁面只載入一種 SDK。

衛星範例沿用共用的 mapPlus 1.4.3 loader，僅在載入此範例時加入官方指定的 Bootstrap 5.3.1 CSS / bundle 與 Bootstrap Icons 1.10.5 CDN。保留勤崴 logo、國土測繪中心 PHOTO2 圖磚來源及原有 integrity / crossorigin 設定，未新增 npm UI 套件。`style.load` 內仍先關閉 `base3d`，再以原本參數及 `nav_croad11` 參考圖層呼叫 `addLayer`；tooltip 與按鈕事件仍在註冊該回呼之後初始化。

沿用 `vite.config.js` 的 `loadEnv` 與 `define`，只將 `ACCESS_KEY`、`ACCESS_TOKEN` 注入前端。`.env` 不提交 Git，但這些值最終仍可被瀏覽器讀取；建置輸出也含憑證，不能當成真正的 secret 保護機制。

## test01 本機模型素材

素材放在 `public/models/`，預設模型為 `public/models/car/scene.gltf`，瀏覽器載入網址為 `/models/car/scene.gltf`。請保留 `.gltf`、`.bin` 與貼圖的原始相對路徑及檔名；目前本機模型引用同目錄的 `scene.bin`，沒有外部貼圖。此目錄已由 Git 忽略，重新 clone 後須自行補上素材，不會自動下載模型。若更換預設檔案，請同步調整 `test01.js` 的 `MODEL_URL` 與素材檢查；目前第一版檢查預設 glTF 2.0 及其外部資源。

載入完成後可調整高度、旋轉方向與整體比例，或還原模型設定與起點。初始展示比例為 10；SDK 的 `setScale` 以初始比例為基準，程式會換算相對倍率。路徑線隨高度調整；每次開始移動都從起點出發，時間以秒輸入、轉成 SDK 所需毫秒，可選擇朝向前進方向。移動期間停用模型設定與開始按鈕，仍可切換路徑線或跟隨／解除跟隨鏡頭；完成後才可再次開始。第一版沒有暫停、續播或排程。

API 依據：[實例方法](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/methods)、[3D 模型](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model)、[新增模型範例](https://kw3dmap.localking.com.tw/3dmap/examples/mapThree/add-3d-model)、[路徑移動範例](https://kw3dmap.localking.com.tw/3dmap/examples/mapThree/model-follow-path)。若官方 loader 回傳 404 或網路失敗，頁面會顯示錯誤；須待官方服務可用，才能進行真實地圖人工測試。

## 新增 example

1. 新增 `src/examples/popup.js`，提供 `export async function init() { ... }`，在 `#app` 建立該範例需要的 HTML。
2. 在 `src/main.js` 的 `examples` 加入 `popup: { label: "彈跳視窗", load: () => import("./examples/popup.js") }`，首頁也會自動加入連結。
3. 開啟 `/?example=popup`。切換使用完整頁面重新載入，目前無須額外設計 instance 清理流程。

## 人工測試

1. 開啟 `/`、`/?example=` 與 `/?example`，確認繁體中文選單與四個按鈕連結，沒有地圖；開啟開發者工具 Network，確認未請求 `src/examples/` 的 module 或 SDK loader。手機寬度下按鈕不超出畫面。
2. 從首頁點「訊息視窗」，確認網址為 `/?example=message-box`，全螢幕地圖出現「開始使用KWMAP !」；點擊 POI 仍顯示地名與地址。
3. 按瀏覽器上一頁，確認回到首頁，再點「衛星影像」，確認網址為 `/?example=satellite`；工具列 tooltip 與影像顯示／隱藏正常。再按上一頁回到首頁。
4. 從首頁點「基本地圖」，確認網址為 `/?example=basic-map`、頁面標題為「基本地圖」，且全螢幕地圖以指定中心點、俯視角度與縮放級別 14 顯示，縮放範圍為 7～18。直接貼上三個範例網址並重新整理，確認不需經過首頁也可正常執行；拖曳、縮放地圖維持正常。
5. 開啟 `/?example=unknown`，確認錯誤訊息、可用範例名稱及「返回首頁」連結，沒有自動載入地圖；點連結返回首頁。
6. 開啟 `/?example=test01`，確認只載入 mapThree 1.4.3、模型請求使用 `/models/car/scene.gltf` 與 `/models/car/scene.bin`。載入前控制停用；完成後調整高度、方向、比例並還原，確認模型與路徑線高度正確，顯示／隱藏路徑線正常。
7. 設定 3 秒移動，分別勾選與取消「朝向前進方向」；快速連點開始，確認只執行一次，模型設定與開始按鈕停用至完成。完成後可重新開始；移動中測試鏡頭跟隨與解除跟隨。輸入空值、0 秒或超出限制的比例，確認顯示錯誤且未開始移動。
8. 暫時將本機 `scene.gltf` 或 `scene.bin` 改名並重新整理，確認缺少素材提示與控制停用，測完還原檔名；用 Network 封鎖 SDK loader，確認清楚的 SDK 錯誤。手機寬度下控制面板可捲動且仍能操作地圖。
