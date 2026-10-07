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
- `src/examples/proj01.js` 與 `proj01.css`：3D 模型與路徑實驗室，獨立載入 mapThree 1.4.3；既有範例維持 mapPlus 1.4.3，每次頁面只載入一種 SDK。

衛星範例沿用共用的 mapPlus 1.4.3 loader，僅在載入此範例時加入官方指定的 Bootstrap 5.3.1 CSS / bundle 與 Bootstrap Icons 1.10.5 CDN。保留勤崴 logo、國土測繪中心 PHOTO2 圖磚來源及原有 integrity / crossorigin 設定，未新增 npm UI 套件。`style.load` 內仍先關閉 `base3d`，再以原本參數及 `nav_croad11` 參考圖層呼叫 `addLayer`；tooltip 與按鈕事件仍在註冊該回呼之後初始化。

沿用 `vite.config.js` 的 `loadEnv` 與 `define`，只將 `ACCESS_KEY`、`ACCESS_TOKEN` 注入前端。`.env` 不提交 Git，但這些值最終仍可被瀏覽器讀取；建置輸出也含憑證，不能當成真正的 secret 保護機制。

## proj01 本機模型素材

素材放在 `public/models/`，預設模型為 `public/models/car/scene.gltf`，瀏覽器載入網址為 `/models/car/scene.gltf`。請保留 `.gltf`、`.bin` 與貼圖的原始相對路徑及檔名；目前本機模型引用同目錄的 `scene.bin`，沒有外部貼圖。此目錄已由 Git 忽略，重新 clone 後須自行補上素材，不會自動下載模型。若更換預設檔案，請同步調整 `proj01.js` 的 `MODEL_URL` 與素材檢查；目前第一版檢查預設 glTF 2.0 及其外部資源。

載入完成後可調整高度與整體比例，或還原模型設定與起點。初始展示比例為 10；SDK 的 `setScale` 以初始比例為基準，程式會換算相對倍率。路徑線隨高度調整；每次開始移動都從起點出發，時間以秒輸入、轉成 SDK 所需毫秒，固定朝向當下前進方向。移動期間停用模型設定與開始按鈕，仍可切換路徑線或跟隨／解除跟隨鏡頭；完成後才可再次開始。第一版沒有暫停、續播或排程。

先輸入起終點經緯度並按「規劃汽車路線」，成功後再按「開始沿路徑移動」，不會自動播放。尚無有效路線時停用開始按鈕；查詢期間防止重複送出，20 秒逾時後可重試，過期回應不覆蓋新結果。查詢失敗或無可用路線會保留上一條成功路線；播放期間停用起終點修改與查詢。

已以目前憑證及預設座標查驗 mapThree 1.4.3：只載入 mapThree，即可使用其建構式的 `DirectionsService` 與目前地圖實例，無須另外載入 mapPlus。實際 DRIVING 查詢回呼狀態為 `OK`，第一參數是候選路線陣列；第一版固定選回傳的第一條，不宣稱為最短或最快。完整幾何取自 `legs[].steps[].polyline.points`，使用官方 `map.decodePolyline()` 解成 `[經度, 緯度]`，不使用簡化的概要線。依 leg／step 順序連接、檢查起終點 metadata 與接點，僅去除相鄰完全重複座標；小數五位量化的接點允許 0.00002 度誤差，較大斷裂直接報錯。標記及模型起點使用服務貼合道路後的座標，可能與輸入稍有不同。

畫線、移動、還原、重播及鏡頭方向共用同一份有效路線；替換成功後移除舊線與舊標記。Z 值統一使用目前模型高度，並非服務提供的道路或橋梁高度。SDK 實作使用 `CatmullRomCurve3`，明確指定受支援的 `curveOptions: { closed: false, curveType: "catmullrom", tension: 0 }`；已對實際 18 點路線採樣 2,001 點，確認曲線沿原線段而未切角。這仍是展示動畫：速度不保證均勻，轉彎可能較突然，秒數不代表真實行車時間，道路貼合程度也受服務幾何精度限制。

路線 API 參考：[服務說明](https://kw3dmap.localking.com.tw/3dmap/api/other-service/directions-service/info)、[route 方法](https://kw3dmap.localking.com.tw/3dmap/api/other-service/directions-service/methods)。資料整理在 `src/examples/proj01-route.js`；可執行 `node --test tests/*.test.js` 檢查座標驗證、路段連接、繞行保留、查詢逾時及過期回應、路線替換與播放期間控制。

API 依據：[實例方法](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/methods)、[3D 模型](https://kw3dmap.localking.com.tw/3dmap/api/mapThree/model)、[新增模型範例](https://kw3dmap.localking.com.tw/3dmap/examples/mapThree/add-3d-model)、[路徑移動範例](https://kw3dmap.localking.com.tw/3dmap/examples/mapThree/model-follow-path)。若官方 loader 回傳 404 或網路失敗，頁面會顯示錯誤；須待官方服務可用，才能進行真實地圖人工測試。

素材校正保留在 `proj01.js` 的 `INITIAL_ROTATION`，只在建立模型時套用。已檢查本機車子的前／後底盤幾何與 SDK 1.4.3 實作：原 `{ x: 90, y: 180, z: 0 }` 的車頭沿 SDK 世界座標 −Y，但 `trackHeading` 以 +Y 為基準，會反向；因此將 Y 校正為 0，保留 X=90，使車頭沿 +Y。實測世界 −X 為東、−Y 為北，Z 正向為逆時針，`proj01-heading.js` 的 `modelRotationFromBearing()` 因而將地理方位角換成 `(180 - bearing) mod 360`。SDK 的 `setRotation()` 會忽略 0 值，因此零度目標以等價的 360 度傳入，避免重設時沿用上一角度。

規劃成功、還原及重播共用 `placeAtRouteStart()`：使用驗證後、吸附道路的第一個座標及目前高度，取第一段不同位置計算地理前進方位角，立即以 `setRotation({ x: 0, y: 0, z })` 設定目標朝向，不累加旋轉，也不重複套用素材校正。移除手動方向輸入與自動朝向 checkbox，`followPath()` 固定指定 `trackHeading: true`；播放時只由 SDK 根據當下曲線切線控制旋轉，不再手動干涉。已實測規劃後朝向、17 段道路轉彎、還原及重播，確認車頭與前進方向一致。

補查正北方向時，重現 SDK 1.4.3 將 +Y 與 −Y 的零叉積軸帶入 180 度旋轉，產生無效 quaternion，車頭反向。`installSdkHeadingQuaternionFix()` 僅包裝目前模型已有的 `quaternion.setFromAxisAngle()`，將零軸半轉改用垂直 Z 軸；非零固定高度的投影微小差異還會讓 SDK 朝北時繞 X 軸翻轉，因此從 SDK 的軸角還原水平前進方向，僅保留 Z 軸轉向，讓車子保持直立。其餘旋轉交回原方法，不改動全域 THREE、其他模型或 SDK 檔案，也不在播放時額外呼叫 `setRotation()`。使用 SDK 已載入的向量與 quaternion，未新增 Three.js 套件或重複載入；此兼容處理針對已查驗的 1.4.3，升級 SDK 時須重新驗證。Three.js 參考：[Quaternion 的旋轉軸須正規化](https://threejs.org/docs/pages/Quaternion.html#setFromAxisAngle)。

環境光尚未接入：官方 mapThree 方法與模型文件未列出光源或可操作場景的介面，取得 1.4.3 loader／渲染實作的請求回傳 404；公開 `@kwmap/mapthree` 套件僅有載入器，無法據此確認光源接入及 Three.js 版本相容性。本機 glTF 使用 PBR 材質且沒有 `KHR_materials_unlit`，但尚未驗證 SDK 執行時的材質與補光效果，因此保留原材質，不新增 Three.js 依賴或無效的補光控制。待確認受支援的光源接入方式後，再加入環境光。

跟隨視角集中在 `FOLLOW_CAMERA`（pitch 65、zoom 18），使用 `rotateWithDirection: true`；proj01 初始化另設 maxPitch 85、maxZoom 24，避免預設上限限制視角。開始／重播會保留使用者的跟隨意願，先解除 SDK 鎖定，再還原道路起點與起始朝向；準備視角時使用 `jumpTo()`，避免另外啟動視角動畫。已於瀏覽器查驗 1.4.3：`followPath()` 呼叫 `onStart` 時尚未執行後續的位置更新，因此在下一個 `requestAnimationFrame` 讀取模型 `coordinates` 後重新鎖定，不使用固定延遲。使用者在等待期間解除跟隨、移動失敗或重新開始時，都會取消待鎖定工作並使舊回呼失效。

鏡頭初始 bearing 使用路徑第一個有效且不同位置的線段，播放中則依模型實際座標位移計算地理前進方位角，不使用模型 Z 值或額外加 180 度。途中啟用跟隨會對準當下模型座標。鎖定後鏡頭由 SDK 控制，介面會區分等待鎖定、已鎖定與未跟隨狀態。鏡頭 API 參考：[jumpTo](https://kw3dmap.localking.com.tw/3dmap/api/map/methods#jumpto)。

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
6. 開啟 `/?example=proj01`，確認只載入 mapThree 1.4.3、模型請求使用 `/models/car/scene.gltf` 與 `/models/car/scene.bin`。載入前控制停用；完成後先規劃預設汽車路線，確認完整道路線、起終點標記、模型移至道路起點且沒有自動播放。調整高度、比例並還原，確認模型與路徑線高度正確，「顯示規劃路線」切換正常。
7. 設定 3 秒移動，確認車頭持續朝向當下前進方向；快速連點開始，確認只執行一次，模型設定與開始按鈕停用至完成。完成後可重新開始；移動中測試鏡頭跟隨與解除跟隨。輸入空值、0 秒或超出限制的比例，確認顯示錯誤且未開始移動。
8. 暫時將本機 `scene.gltf` 或 `scene.bin` 改名並重新整理，確認缺少素材提示與控制停用，測完還原檔名；用 Network 封鎖 SDK loader，確認清楚的 SDK 錯誤。手機寬度下控制面板可捲動且仍能操作地圖。
9. 確認頁面沒有手動車頭角度輸入或「朝向前進方向」checkbox。規劃完成尚未播放時，車子應在吸附道路的起點，並朝向第一段不同位置的前進方向。測試含轉彎的路線，確認播放時每段都轉向，而非只朝整條路線的終點。還原與連續重播的起點及車頭方向應一致；換另一條起始方向不同的路線後，再測一次。查詢失敗不應改變原本車子的位置與朝向。
10. 先按跟隨再開始移動，確認鏡頭解除後自動重新鎖定，完成後直接重播仍正常；未按跟隨就開始則保持自由鏡頭。播放途中再按跟隨，確認對準當下位置而非起點；等待重新鎖定時立即解除，確認不會稍後又自動跟隨。另測試連續跟隨／解除、還原模型與重播，檢查面板狀態與按鈕一致。
11. 起終點相同、空值或超出經緯度範圍時，確認查詢未送出並顯示錯誤。規劃成功後換一組座標再查詢，確認只剩新線與兩個新標記；播放、還原與重播都使用新路線。查詢中連點不重複送出，播放時起終點與查詢停用。用 Network 封鎖路線服務或延遲超過 20 秒，確認顯示失敗／逾時並保留上一條有效路線；解除封鎖重試，舊回應不得覆蓋新結果。

proj01 版面檢查：桌面為左側 350px 面板與右側地圖，窄螢幕改成上方面板、下方地圖。面板內滾動並阻止捲動穿透，地圖區仍可正常縮放；改變視窗尺寸後確認地圖填滿分區。起終點各列保留經緯度標籤，「選取起點／終點」尚未接入而停用；查詢或播放期間，仍可在路線規劃區切換「顯示規劃路線」。地圖尺寸更新沿用官方 `trackResize: true` 選項（[初始化文件](https://kw3dmap.localking.com.tw/3dmap/api/map/info)）。
