import { validateEndpoints } from "./proj01-route.js";

const COLORS = ["#175cd3", "#15803d", "#c2410c", "#7e22ce", "#be123c", "#0e7490"];
// 清單僅縮短顯示；查詢與接送保留原始座標精度。
const coordinateText = (point) => point.map((value) => Number(value.toFixed(6))).join(", ");

export function mountRequestList(container) {
  // 預製座標不預先保證道路可用性，路線載入狀態與接送狀態分開管理。
  const requests = [
    { id: "request-01", origin: [121.561, 25.0334], destination: [121.567, 25.034], color: "#175cd3", status: "pending" },
    { id: "request-02", origin: [121.543, 25.041], destination: [121.553, 25.045], color: "#15803d", status: "pending" },
    { id: "request-03", origin: [121.517, 25.047], destination: [121.532, 25.052], color: "#c2410c", status: "pending" },
  ];
  for (const request of requests) request.routeVisible = true;
  let nextNumber = requests.length + 1;
  let disposed = false;
  let selectedRequestId = null;
  const selectionListeners = new Set();
  const changeListeners = new Set();
  const statusLabels = { pending: "等待接送", assigned: "準備接送", pickingUp: "前往接人", onboard: "乘車中", completed: "已完成" };
  const routeStates = new Map();
  const routeLabels = { loading: "路線查詢中…", ready: "", unavailable: "路線不可用", error: "路線查詢失敗" };
  const itemHtml = (request) => {
    const number = request.id.slice("request-".length);
    return `<div class="proj01-request">
      <input id="proj01-select-${request.id}" type="radio" name="proj01-request" value="${request.id}" ${selectedRequestId === request.id ? "checked" : ""}>
      <div class="proj01-request-heading">
        <label for="proj01-select-${request.id}" class="proj01-request-name"><span class="proj01-request-color" style="background-color: ${request.color}" aria-hidden="true"></span><strong>需求 ${number}</strong></label>
        <span data-request-status="${request.id}" class="proj01-request-status" role="status">${statusLabels[request.status]}</span>
        <label class="proj01-request-visibility" for="proj01-line-${request.id}"><input id="proj01-line-${request.id}" type="checkbox" name="proj01-request-line" value="${request.id}" aria-label="需求 ${number} 路線" ${request.routeVisible ? "checked" : ""}>路線</label>
      </div>
      <label for="proj01-select-${request.id}" class="proj01-request-content">
        <span class="proj01-request-coordinate">起點 ${coordinateText(request.origin)}</span>
        <span class="proj01-request-coordinate">終點 ${coordinateText(request.destination)}</span>
      </label>
      <span data-request-route="${request.id}" class="proj01-request-route-status" role="status">${routeLabels[routeStates.get(request.id)?.status] ?? ""}</span>
    </div>`;
  };
  const render = () => { container.innerHTML = requests.map(itemHtml).join(""); };
  const selectById = (id) => {
    if (!requests.some((request) => request.id === id)) return;
    if (selectedRequestId === id) return;
    selectedRequestId = id;
    // 只更新 checked，不重建 radio 或移動鍵盤焦點。
    for (const request of requests) {
      const radio = container.querySelector(`input[type="radio"][value="${request.id}"]`);
      if (radio) radio.checked = request.id === id;
    }
    for (const listener of selectionListeners) listener(selectedRequestId);
  };
  const select = (event) => {
    const input = event.target;
    if (input.type !== "radio" || input.name !== "proj01-request" || !input.checked
      || !requests.some((request) => request.id === input.value)) return;
    selectById(input.value);
  };
  const setRouteVisible = (id, visible) => {
    const request = requests.find((item) => item.id === id);
    if (!request || disposed) return;
    request.routeVisible = Boolean(visible);
    const checkbox = container.querySelector(`#proj01-line-${id}`);
    if (checkbox) checkbox.checked = request.routeVisible;
    for (const listener of changeListeners) listener({ type: "visibility", id });
  };
  const changeVisibility = ({ target }) => {
    if (target.type === "checkbox" && target.name === "proj01-request-line") setRouteVisible(target.value, target.checked);
  };
  render();
  container.addEventListener("change", select);
  container.addEventListener("change", changeVisibility);
  return {
    requests,
    selectById,
    setRouteVisible,
    addRequest(origin, destination) {
      if (disposed) throw new Error("需求管理已釋放。");
      validateEndpoints(origin, destination);
      const number = nextNumber++;
      const request = { id: `request-${String(number).padStart(2, "0")}`, origin: [...origin], destination: [...destination],
        color: COLORS[(number - 1) % COLORS.length], status: "pending", routeVisible: true };
      requests.push(request);
      // 僅附加新項目，保留既有 radio、checkbox 與鍵盤焦點。
      container.insertAdjacentHTML("beforeend", itemHtml(request));
      for (const listener of changeListeners) listener({ type: "added", id: request.id });
      return request;
    },
    get selectedRequestId() { return selectedRequestId; },
    getRouteState: (id) => routeStates.get(id),
    setStatus(id, status) {
      const request = requests.find((item) => item.id === id);
      if (!request || !Object.hasOwn(statusLabels, status)) throw new Error("需求狀態無效。");
      request.status = status;
      const element = container.querySelector(`[data-request-status="${id}"]`);
      if (element) element.textContent = statusLabels[status];
      for (const listener of changeListeners) listener({ type: "status", id });
    },
    setRouteState(id, state) {
      routeStates.set(id, state);
      // 只更新路線提示，不重建 radio，保留鍵盤操作中的焦點。
      const element = container.querySelector(`[data-request-route="${id}"]`);
      if (element) {
        element.textContent = [routeLabels[state.status], state.error].filter(Boolean).join("：");
        element.title = state.error ?? "";
      }
      for (const listener of changeListeners) listener({ type: "route", id });
    },
    subscribeSelection(listener) {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    subscribeChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    render,
    dispose() {
      disposed = true;
      container.removeEventListener("change", select);
      container.removeEventListener("change", changeVisibility);
      selectionListeners.clear();
      changeListeners.clear();
    },
  };
}
