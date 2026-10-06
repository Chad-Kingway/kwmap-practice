# 勤崴 3D Map SDK 練習

使用 Vite、Vanilla JavaScript、HTML / CSS，將官方範例整理成共用入口的本機練習專案。

## 啟動

首次使用時，將 `.env.example` 複製成 `.env`，填入勤崴提供的 `ACCESS_KEY` 與 `ACCESS_TOKEN`；已有 `.env` 時請保留原內容。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址，例如 `http://localhost:5173/?example=message-box`。未指定 `example` 時，預設載入 `message-box`。

`npm run build` 產生 `dist/`，可用 `npm run preview` 預覽。SDK 與地圖資料由官方網站載入，需要網路及有效憑證。

## 檔案與環境變數

- `index.html`：共用 HTML 與官方 SDK loader。
- `src/main.js`：讀取 query parameter，以明確 mapping 載入 example。
- `src/config.js`：共用憑證設定。
- `src/style.css`：全螢幕地圖及錯誤訊息樣式。
- `src/examples/message-box.js`：保留官方範例的地圖設定、訊息視窗與 POI 點擊事件。

沿用 `vite.config.js` 的 `loadEnv` 與 `define`，只將 `ACCESS_KEY`、`ACCESS_TOKEN` 注入前端。`.env` 不提交 Git，但這些值最終仍可被瀏覽器讀取；建置輸出也含憑證，不能當成真正的 secret 保護機制。

## 新增 example

1. 新增 `src/examples/popup.js`，提供 `export async function init() { ... }`，在 `#app` 建立該範例需要的 HTML。
2. 在 `src/main.js` 的 `examples` 加入 `"popup": () => import("./examples/popup.js")`。
3. 開啟 `/?example=popup`。切換使用完整頁面重新載入，目前無須額外設計 instance 清理流程。

## 人工測試

1. 開啟 `/` 與 `/?example=message-box`，確認地圖為全螢幕，中心在臺北 101 附近，出現「開始使用KWMAP !」及原有動畫。
2. 點擊有名稱與地址的 POI，確認訊息視窗顯示地名及地址；點擊空白區域不新增訊息視窗。
3. 拖曳、縮放地圖，確認原有操作正常。
4. 開啟 `/?example=unknown`，確認顯示找不到範例及可用範例名稱。
