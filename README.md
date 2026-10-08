# 勤崴 3D Map SDK 練習

使用 Vite、Vanilla JavaScript、HTML / CSS，將官方範例整理成共用入口的本機練習專案。

## 啟動

首次使用時，將 `.env.example` 複製成 `.env`，填入勤崴提供的 `ACCESS_KEY` 與 `ACCESS_TOKEN`；已有 `.env` 時請保留原內容。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址，例如 `http://localhost:5173/`，從繁體中文首頁選單點選「基本地圖」、「訊息視窗」、「衛星影像」或「proj01：3D 模型實驗室」。未指定 `example` 或參數為空時，只顯示選單，不載入範例 module、SDK loader 或初始化地圖。

也可直接開啟 `/?example=basic-map`、`/?example=message-box`、`/?example=satellite` 或 `/?example=proj01`。選單使用一般 `<a>` 連結，支援重新整理與瀏覽器上一頁；無效名稱顯示錯誤訊息與返回首頁連結。

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
- `src/proj01/proj01.js` 與 `proj01.css`：3D 模型與路徑實驗室，獨立載入 mapThree 1.4.3；既有範例維持 mapPlus 1.4.3，每次頁面只載入一種 SDK。

衛星範例沿用共用的 mapPlus 1.4.3 loader，僅在載入此範例時加入官方指定的 Bootstrap 5.3.1 CSS / bundle 與 Bootstrap Icons 1.10.5 CDN。保留勤崴 logo、國土測繪中心 PHOTO2 圖磚來源及原有 integrity / crossorigin 設定，未新增 npm UI 套件。`style.load` 內仍先關閉 `base3d`，再以原本參數及 `nav_croad11` 參考圖層呼叫 `addLayer`；tooltip 與按鈕事件仍在註冊該回呼之後初始化。

沿用 `vite.config.js` 的 `loadEnv` 與 `define`，只將 `ACCESS_KEY`、`ACCESS_TOKEN` 注入前端。`.env` 不提交 Git，但這些值最終仍可被瀏覽器讀取；建置輸出也含憑證，不能當成真正的 secret 保護機制。

## proj01 本機模型素材

素材放在 `public/models/`，預設模型為 `public/models/car/scene.gltf`，瀏覽器載入網址為 `/models/car/scene.gltf`。請保留 `.gltf`、`.bin` 與貼圖的原始相對路徑及檔名；目前本機模型引用同目錄的 `scene.bin`，沒有外部貼圖。此目錄已由 Git 忽略，重新 clone 後須自行補上素材，不會自動下載模型。若更換預設檔案，請同步調整 `proj01.js` 的 `MODEL_URL` 與素材檢查；目前第一版檢查預設 glTF 2.0 及其外部資源。

## proj01 需求與接送

「需求管理」內的起終點是新增需求草稿，格式為 `lng, lat`；可手動輸入或在地圖選點，選點只填草稿。按「新增需求」通過座標與不同起終點驗證後，附加一筆固定 id、穩定色盤、pending 狀態的需求並清空草稿，保留原選取。資料只保存在記憶體，重新整理即恢復三筆預製需求。

需求起終點立即標記，送人道路路線依序查詢一次並快取。每筆「路線」checkbox 僅控制自己的送人預覽，端點仍保留；重新勾選立即以快取重繪，不重查、不改接送狀態，也不控制任務線。個別查詢失敗會保留需求與端點並顯示原因，未 ready 的需求不能接送。車輛沒有手動路線、起點還原或重播功能。

獨立「模型設定」保存已套用的全域比例，輸入框是草稿；套用更新全部已登記模型後呼叫 `map.redraw()`。SDK `setScale()` 相對建立比例，因此傳入「目標比例 ÷ 模型初始比例」，重複套用不累乘；後續模型登記時繼承最後成功值。任一模型未就緒或接送中禁止套用，部分失敗顯示原因而不更新全域成功值。目前只實際使用一台車，多模型行為僅以模擬測試驗證。[比例文件](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model#setscale)、[重繪文件](https://kw3dmap.localking.com.tw/3dmap/api/map/methods#redraw)。

車輛 01 保留接送總展示秒數與鏡頭跟隨。指定接送使用選取的需求；自動接送從模型當下位置，以原始乘客起點的直線距離選 pending 且路線 ready 的最近一筆，同距離沿用清單順序，不代表道路距離或接人時間最佳。兩者共用任務入口，每次只接一筆；切換清單不更換任務，完成或準備失敗後等待下一次操作。

接送從模型目前位置查詢接人道路，再沿快取送人路線移動，以有效 `onEnd` 接續兩段，按路長分配總展示時間。距起點 5 公尺內可略過接人；實際道路起點與銜接點最多容許 50 公尺吸附差異，不補直線。接送期間停用比例、時間與選點，但草稿手動輸入、新增及每筆預覽開關仍可使用。完成清除任務線，車輛停在實際道路終點。

沿用 mapThree 1.4.3 的 `DirectionsService(map)`、DRIVING、第一條候選路線與 `legs[].steps[].polyline.points`；官方 `map.decodePolyline()` 解成 [經度, 緯度]，驗證連接順序且只移除相鄰重複點。20 秒查詢逾時及過期回應不修改已失效工作；失敗不以直線替代道路。參考：[路線服務](https://kw3dmap.localking.com.tw/3dmap/api/other-service/directions-service/methods)、[模型 API](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model)。

素材初始校正保留 `INITIAL_ROTATION = { x: 90, y: 180, z: 0 }`，只在建立時套用。路段開始使用共同 Z 軸方向轉換，播放固定 `trackHeading: true`，不另手動旋轉；`proj01-heading.js` 保留目前模型 quaternion 的 1.4.3 相容處理。模型、路線與標記均使用 z=0，不代表道路或橋梁真實高度；零張力 catmullrom 曲線沿道路線段，秒數僅為展示動畫時間。

鏡頭設定集中在 `FOLLOW_CAMERA`，路段開始解除鎖定、準備起始視角，在 `onStart` 後下一繪製幀依當下模型位置重新鎖定。跟隨使用 `rotateWithDirection: true`；地圖左鍵位移 5px 解除跟隨但不中止車輛，首次拖曳可能只解除，需再次拖曳才平移。面板以 passive 局部 wheel 阻止事件冒泡，保留原生捲動；窄螢幕為上方面板、下方地圖。

待解限制：實際播放曾觸發終點座標檢查未通過，且既有起步朝向仍有落差；不放寬檢查或更換素材校正宣稱修正。動畫啟動後出錯保留乘客狀態，等待有效結束回呼才解除忙碌；未確認公開停止方法，沒有回呼時需重新整理。環境光尚未找到可靠公開接入方式，保留原材質，未新增 Three.js 依賴。

## 新增 example

1. 新增 `src/examples/popup.js`，提供 `export async function init() { ... }`，在 `#app` 建立該範例需要的 HTML。
2. 在 `src/main.js` 的 `examples` 加入 `popup: { label: "彈跳視窗", load: () => import("./examples/popup.js") }`，首頁也會自動加入連結。
3. 開啟 `/?example=popup`。切換使用完整頁面重新載入，目前無須額外設計 instance 清理流程。

## 人工測試

1. 開啟 `/`、`/?example=` 與 `/?example`，確認繁體中文選單與四個按鈕連結，沒有地圖；開啟開發者工具 Network，確認未請求 `src/examples/` 或 `src/proj01/` 的 module 或 SDK loader。手機寬度下按鈕不超出畫面。
2. 從首頁點「訊息視窗」，確認網址為 `/?example=message-box`，全螢幕地圖出現「開始使用KWMAP !」；點擊 POI 仍顯示地名與地址。
3. 按瀏覽器上一頁，確認回到首頁，再點「衛星影像」，確認網址為 `/?example=satellite`；工具列 tooltip 與影像顯示／隱藏正常。再按上一頁回到首頁。
4. 從首頁點「基本地圖」，確認網址為 `/?example=basic-map`、頁面標題為「基本地圖」，且全螢幕地圖以指定中心點、俯視角度與縮放級別 14 顯示，縮放範圍為 7～18。直接貼上三個範例網址並重新整理，確認不需經過首頁也可正常執行；拖曳、縮放地圖維持正常。
5. 開啟 `/?example=unknown`，確認錯誤訊息、可用範例名稱及「返回首頁」連結，沒有自動載入地圖；點連結返回首頁。
6. 開啟 `/?example=proj01`，確認模型使用 `/models/car/scene.gltf`、SDK 為 mapThree 1.4.3；缺少素材或服務失敗有清楚提示。桌面左側面板、窄螢幕上下分區，收合車輛不影響需求。
7. 手動輸入或地圖選點新增需求，確認不移動車子、保留選取、草稿清空；同按鈕與 Escape 取消，拖曳／右中鍵／面板操作不誤選。無效或相同起終點不能新增。
8. 切換各筆「路線」，確認只隱藏自己的道路線且端點保留，重新勾選立即呈現；查詢中取消勾選，完成仍隱藏。新增、選取及狀態更新不重置 checkbox，鍵盤 Space 操作不改 radio 選取。
9. 新需求 ready 後指定接送；途中新增另一筆，確認車位、執行對象與鏡頭不被草稿改動，兩個接送按鈕不能重接。完成後停在終點且不自動下一筆，再測自動接送。
10. 跟隨中測面板捲動與地圖拖曳解除；模型應繼續移動。查詢逾時、服務失敗及終點檢查不通過，不得假裝完成或重疊動畫。以 `node --test tests/*.test.js` 執行流程測試，再執行 `npm run build`。
