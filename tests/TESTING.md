# 測試說明

目前有兩個測試檔案。

## 執行方式

在專案根目錄執行：

```sh
node --test tests/*.test.js
```

也可以只執行其中一個檔案：

```sh
node --test tests/proj01-route.test.js
node --test tests/proj01-flow.test.js
```

## 路線資料測試

檔案：[tests/proj01-route.test.js](proj01-route.test.js)

受測程式：[src/examples/proj01-route.js](../src/examples/proj01-route.js) 的 `validateEndpoints()` 與 `normalizeDirections()`。

- 檢查起終點座標是否有效，且不能相同。
- 按順序接起路段，移除相鄰重複點，保留繞行路線。
- 拒絕接不起來、方向相反或經緯度顛倒的路段。
- 允許路段起點資料與解碼座標有小幅誤差。
- 拒絕沒有完整路段、座標無效或只有一個位置的路線。

## 查詢與播放流程測試

檔案：[tests/proj01-flow.test.js](proj01-flow.test.js)

受測程式：[src/examples/proj01.js](../src/examples/proj01.js)，搭配路線驗證與整理函式。

使用模擬的畫面控制項與 SDK，檢查以下流程：

- 沒有有效路線時，不能開始播放。
- 查詢中不重複送出；逾時後可重試。
- 新查詢成功後，舊回應不會改寫新路線狀態，也不會自動播放。
- 查無路線時，保留上一條有效路線。
- 換路線後，清除舊線與標記。
- 播放使用新路線，期間不能查詢，結束後恢復操作。

此測試不會連線到真實服務，也不檢查地圖與模型的實際顯示效果。
