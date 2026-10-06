# 勤崴 3D Map SDK 練習

使用 Vite、Vanilla JavaScript、HTML / CSS，將官方範例整理成共用入口的本機練習專案。

## 啟動

首次使用時，將 `.env.example` 複製成 `.env`，填入勤崴提供的 `ACCESS_KEY` 與 `ACCESS_TOKEN`；已有 `.env` 時請保留原內容。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址，例如 `http://localhost:5173/`，從繁體中文首頁選單點選「基本地圖」、「訊息視窗」或「衛星影像」。未指定 `example` 或參數為空時，只顯示選單，不載入範例 module 或初始化地圖；共用 HTML 仍載入 SDK loader。

也可直接開啟 `/?example=basic-map`、`/?example=message-box` 或 `/?example=satellite`。選單使用一般 `<a>` 連結，支援重新整理與瀏覽器上一頁；無效名稱顯示錯誤訊息與返回首頁連結。

`npm run build` 產生 `dist/`，可用 `npm run preview` 預覽。SDK 與地圖資料由官方網站載入，需要網路及有效憑證。

## 檔案與環境變數

- `index.html`：共用 HTML 與官方 SDK loader。
- `src/main.js`：集中登記範例名稱、顯示文字與載入函式，產生首頁選單並以明確 mapping 載入 example。
- `src/config.js`：共用憑證設定。
- `src/style.css`：全螢幕地圖、錯誤訊息及限定於首頁 class 的選單樣式。
- `src/examples/basic-map.js`：基本地圖，沿用共用憑證、loader 與樣式，初始中心點為 `[121.53559860212545, 25.029308142529132]`，縮放級別為 14，範圍為 7～18。
- `src/examples/message-box.js`：保留官方範例的地圖設定、訊息視窗與 POI 點擊事件。
- `src/examples/satellite.js` 與 `satellite.css`：衛星影像圖層、工具列與顯示／隱藏按鈕，使用 `/?example=satellite` 開啟。

衛星範例沿用共用的 mapPlus 1.4.3 loader，僅在載入此範例時加入官方指定的 Bootstrap 5.3.1 CSS / bundle 與 Bootstrap Icons 1.10.5 CDN。保留勤崴 logo、國土測繪中心 PHOTO2 圖磚來源及原有 integrity / crossorigin 設定，未新增 npm UI 套件。`style.load` 內仍先關閉 `base3d`，再以原本參數及 `nav_croad11` 參考圖層呼叫 `addLayer`；tooltip 與按鈕事件仍在註冊該回呼之後初始化。

沿用 `vite.config.js` 的 `loadEnv` 與 `define`，只將 `ACCESS_KEY`、`ACCESS_TOKEN` 注入前端。`.env` 不提交 Git，但這些值最終仍可被瀏覽器讀取；建置輸出也含憑證，不能當成真正的 secret 保護機制。

## 新增 example

1. 新增 `src/examples/popup.js`，提供 `export async function init() { ... }`，在 `#app` 建立該範例需要的 HTML。
2. 在 `src/main.js` 的 `examples` 加入 `popup: { label: "彈跳視窗", load: () => import("./examples/popup.js") }`，首頁也會自動加入連結。
3. 開啟 `/?example=popup`。切換使用完整頁面重新載入，目前無須額外設計 instance 清理流程。

## 人工測試

1. 開啟 `/`、`/?example=` 與 `/?example`，確認繁體中文選單與三個按鈕連結，沒有地圖；開啟開發者工具 Network，確認未請求 `src/examples/` 的 module。手機寬度下按鈕不超出畫面。
2. 從首頁點「訊息視窗」，確認網址為 `/?example=message-box`，全螢幕地圖出現「開始使用KWMAP !」；點擊 POI 仍顯示地名與地址。
3. 按瀏覽器上一頁，確認回到首頁，再點「衛星影像」，確認網址為 `/?example=satellite`；工具列 tooltip 與影像顯示／隱藏正常。再按上一頁回到首頁。
4. 從首頁點「基本地圖」，確認網址為 `/?example=basic-map`、頁面標題為「基本地圖」，且全螢幕地圖以指定中心點、俯視角度與縮放級別 14 顯示，縮放範圍為 7～18。直接貼上三個範例網址並重新整理，確認不需經過首頁也可正常執行；拖曳、縮放地圖維持正常。
5. 開啟 `/?example=unknown`，確認錯誤訊息、可用範例名稱及「返回首頁」連結，沒有自動載入地圖；點連結返回首頁。
