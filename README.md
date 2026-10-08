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

「需求管理」的手動新增區預設以文字顯示起終點，空草稿顯示「未設定」；按「輸入座標」展開兩個 `lng, lat` 輸入框，收合保留原文。地圖選點同步更新同一份草稿及摘要，不強制展開；手動編輯取消選點，輸入途中不驗證格式。按「新增需求」通過既有驗證後，附加一筆固定 id、穩定色盤、pending 狀態的需求並清空草稿及摘要，保留原選取。獨立「隨機需求」不更改手動草稿或展開狀態。資料只保存在記憶體，重新整理即恢復三筆預製需求。

「隨機需求」每次新增一筆：起終點分別在經度 121.5102～121.5693、緯度 25.03068～25.06026 內均勻抽樣，直線距離至少 200 公尺，最多嘗試 20 次；失敗顯示錯誤且不新增。保留手動草稿、選取、車位與鏡頭，接送中仍可新增，不自動接送。沿用相同標記、查詢佇列及路線／時間驗證；道路吸附與途中可超出矩形，接送仍須通過既有安全檢查。路線失敗保留需求，不自動重抽。抽樣函式獨立於 DOM 與服務，供後續定時生成共用。

主清單顯示未完成需求；已完成卡片依建立順序移入預設收合的「已完成（數量）」，空區塊隱藏。移動保留原卡片、選取與資料；若焦點會被收合區隱藏，改移至 summary，不自動展開。

需求起終點立即標記，送人道路路線依序查詢一次並快取。未完成需求持續顯示預覽，completed 立即移除自己的預覽並保留端點、道路座標及官方時間快取。查看、選取、更新清單、樣式重載或延遲回應都不重新顯示已完成路線，且不能再次接送；任務線獨立管理。個別查詢失敗保留需求與端點並顯示原因，未 ready 的需求不能接送。

地圖右上角的地點圖示按鈕切換 `poi_` 圖層的圖標與名稱，預設顯示；隱藏時圖示加斜線，提示與可存取名稱顯示下一步操作。切換後立即重繪，保留路名、需求與車輛，接送及跟隨中仍可用。樣式重載會沿用選擇，切換失敗顯示原因並嘗試還原。

同一工具區的指南針依實際地圖 bearing 指北；「回正北」先解除跟隨，再同步設為 0，保留當下中心、縮放與俯角，不中止接送。使用 inline SVG 與公開 `getMapView()`、`jumpTo()`、`rotate` 事件，無額外 SDK 或輪詢；初始化、樣式重載與清理一起管理監聽。已在 mapThree 1.4.3 實測這些方法及事件；其 NavigationControl 支援只顯示指南針，但預設回正北有一秒動畫，因此未採用。更換 SDK 版本時須重新確認事件相容性。[勤崴視角方法](https://kw3dmap.localking.com.tw/3dmap/api/map/methods)、[MapLibre 控制器選項](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/NavigationControlOptions/)。

獨立「模型設定」保存已套用的全域比例，輸入框是草稿；套用更新全部已登記模型後呼叫 `map.redraw()`。SDK `setScale()` 相對建立比例，因此傳入「目標比例 ÷ 模型初始比例」，重複套用不累乘；後續模型登記時繼承最後成功值。任一模型未就緒或接送中禁止套用，部分失敗顯示原因而不更新全域成功值。目前只實際使用一台車，多模型行為僅以模擬測試驗證。[比例文件](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model#setscale)、[重繪文件](https://kw3dmap.localking.com.tw/3dmap/api/map/methods#redraw)。

車輛 01 提供接送與鏡頭跟隨。標題列「跟隨」啟動鏡頭跟隨模型，收合與接送中可用；跟隨期間停用，拖曳地圖解除後可再次啟動，點擊按鈕不切換車輛區塊。指定接送使用選取的需求；自動接送從模型當下位置，以原始乘客起點的直線距離選 pending、路線 ready 且有有效預估時間的最近一筆，同距離沿用清單順序，不代表道路距離或接人時間最佳。兩者共用任務入口，每次只接一筆；切換清單不更換任務，完成或準備失敗後等待下一次操作。

接送從模型目前位置查詢接人道路，再沿快取送人路線移動。採方案 C：單一 requestAnimationFrame 時鐘累積「實際秒數 × 當下倍率」，以各段官方 durationSeconds 作平均配速，依道路累積公尺長度插值，保留折線及轉彎。獨立線性速度滑桿預設 60×，允許 1～300 整數，準備與移動中可調整；新值從下一次更新生效，不重啟、不重查路線。接人切送人保留同幀餘量並使用最新倍率。距起點 5 公尺內可略過接人；道路起點與銜接點仍最多容許 50 公尺吸附差異，不補直線。比例及選點在忙碌時停用，草稿、新增及預覽仍可使用。

實測 mapThree 1.4.3 回傳各 `leg.duration.value` 為數值（例 254、369、459），使用 Directions 格式的秒數欄位，只加總 leg，不再加 route／step 或解析 `text`。[秒數格式說明](https://developers.google.com/maps/documentation/javascript/legacy/directions)。`normalizeDirections` 保存 `durationSeconds`；任一 leg 缺少有限正秒數時保留道路預覽及快取，但禁止接送並提示原因。接人時間無效時不出發、需求回到 pending；倍率不影響 20 秒 API 逾時。

沿用 mapThree 1.4.3 的 `DirectionsService(map)`、DRIVING、第一條候選路線與 `legs[].steps[].polyline.points`；官方 `map.decodePolyline()` 解成 [經度, 緯度]，驗證連接順序且只移除相鄰重複點。20 秒查詢逾時及過期回應不修改已失效工作；失敗不以直線替代道路。參考：[路線服務](https://kw3dmap.localking.com.tw/3dmap/api/other-service/directions-service/methods)、[模型 API](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model)。

素材初始校正維持 INITIAL_ROTATION = { x: 90, y: 180, z: 0 }。控制器以公開 setCoordinates、setRotation 更新位置及有效路段方向，沿用原 Z 軸轉換，不累加旋轉；不使用 followPath、SDK 路徑佇列或私有時間欄位。模型、路線與標記使用 z=0，不代表橋梁真實高度。每次播放具獨立識別，先更新及讀回確認終點，再通知一次完成；取消與錯誤停止更新並保留乘客狀態，不算正常完成。

鏡頭設定集中在 FOLLOW_CAMERA；同一動畫幀先更新模型，再以公開 jumpTo 同步更新當下車位及方向，最後 redraw，不啟動每幀 flyTo。地圖左鍵位移 5px 解除跟隨但不中止車輛，可重新跟隨。面板保留原生捲動，窄螢幕為上方面板、下方地圖。分頁隱藏暫停模擬，回前景重設時間基準，不補算背景時間；頁面清理移除動畫及相關監聽。

時間、位置及鏡頭分別集中在 proj01-clock.js、proj01-playback.js、proj01-camera.js，目前只服務一台車。真實 mapThree 1.4.3 已驗證兩段接送到站、向東／向北朝向、折線轉彎、途中加減速、連續滑桿拖動與跟隨互斥；背景恢復、過期更新及注入錯誤由可控制時間的模擬測試驗證。多車尚未實作；環境光仍保留原材質，未新增 Three.js 依賴。

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
   座標預設收合；選點後摘要更新且維持收合。展開後輸入不完整文字，確認取消選點、不出現格式錯誤；收合及重新展開原文保留，只有新增才驗證。Tab 不可進入隱藏輸入框；接送跟隨中仍可切換、編輯，且不改原任務。
   填入草稿並選取既有需求，再按「隨機需求」，確認只增加一筆、草稿及選取保留、立即出現端點，查詢成功後呈現道路線；查詢失敗保留錯誤且不重抽。接送與跟隨中再按一次，確認原任務及鏡頭持續、沒有自動換單。窄螢幕下兩個新增按鈕不得超出面板。
8. 完成一筆接送，確認卡片移入預設收合的「已完成（1）」、自己的預覽線消失、端點與其他需求路線保留。展開並選取完成卡片仍不可接送，也不恢復路線；新增與完成另一筆保留展開狀態及建立順序。完成時若卡片有焦點，收合區內的焦點移至 summary。
9. 新需求 ready 後指定接送；途中新增另一筆，確認車位、執行對象與鏡頭不被草稿改動，兩個接送按鈕不能重接。完成後停在終點且不自動下一筆，再測自動接送。
10. 跟隨中測面板捲動與地圖拖曳解除；模型應繼續移動。查詢逾時、服務失敗及終點檢查不通過，不得假裝完成或重疊動畫。接送途中連續拖動速度滑桿，確認位置不重置、跟隨維持，比例仍停用；完成後車位在道路終點且需求只完成一次。切到背景再回前景應接續、不追補背景時間。以 `node --test tests/*.test.js` 執行測試，再執行 `npm run build`。
11. 手動旋轉地圖，確認北針同步；按指南針或聚焦後按 Enter／空白鍵，應立即回正北且保留中心、縮放與俯角。接送跟隨中按一次，確認跟隨恢復可用、車輛繼續行駛，下一幀不恢復鏡頭跟隨。選點中按指南針不得寫入草稿；在按鈕上拖曳或滾輪不得操作地圖。360px 寬度確認 POI 與指南針不重疊且位於地圖內。
