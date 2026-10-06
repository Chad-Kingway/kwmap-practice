# 專案規範
- 這是 Vite + Vanilla JavaScript 的勤崴 3D Map SDK 練習專案。
- 維持 Vite + Vanilla JavaScript；除非有明確需求，不加入 React、TypeScript、SQL 或大型 framework。FastAPI 僅於明確要求導入時新增。
- 優先維持官方 example 原本行為，再適度整理；各 example 盡量彼此獨立。
- 只抽出共用設定，不過度抽象化只有一處使用的程式碼。
- 不可硬編碼、提交或輸出實際憑證；不可提交 `.env` 等含憑證檔案，也不可擅自修改其中的實際憑證。`.env.example` 僅放空值或佔位文字。
- README、docs、註解及 Git commit message 使用繁體中文。
- 每次改動完成後建立 Git commit，並簡單說明人工測試方式。
- `docs/` 保持少量文件，需要時才新增。

## 憑證與後端方向
- `ACCESS_KEY`、`ACCESS_TOKEN` 均視為 server-side secret；目標為瀏覽器前端透過 `/api/...` 呼叫 FastAPI，由 FastAPI 讀取 server-side `.env` 並呼叫外部授權服務。
- 前端只能取得 API 執行結果，不得取得憑證；不得透過 Vite `define`、`VITE_*`、API 回傳、HTML 或前端程式注入憑證。後端回應、錯誤與日誌也不得洩漏憑證。
- 現況尚未符合此目標：`vite.config.js` 以 `loadEnv` / `define` 注入憑證，`src/config.js` 匯出後，由兩個 example 在瀏覽器執行 `new mapPlus(..., { accessKey, accessToken })`。
- 若 SDK 強制要求瀏覽器持有這兩個值，這種 credential 無法只靠把 `.env` 搬到 FastAPI 就隱藏；由 API 回傳憑證也不算隱藏。
- 導入前先確認 SDK 是否支援後端授權、完整資源代理或其他符合上述限制的方式，並驗證相容性與授權條件；未確認前不得宣稱可行。短效 token、網域限制或混淆不代表憑證不會進入瀏覽器。
- 若保留 SDK 行為與憑證不進入瀏覽器無法兼得，先說明限制與替代方案，待使用者決定；不得自行降低 secret 保護要求。開發用 Vite proxy 不等於正式部署的後端保護。
